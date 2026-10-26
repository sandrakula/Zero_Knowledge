"""Problem library: CRUD plus the ZIP importer.

The importer is deliberately boring and strict:

* the archive is read fully into memory under a hard size cap;
* every member path is normalized and rejected on traversal, absolute paths,
  drive letters, NULs and symlinks;
* each ``problem.json`` / ``tests.json`` is validated before any row is
  written;
* problems are keyed by ``(org, source_name, source_id)`` when a source id
  exists, otherwise by content checksum. Re-importing identical content is a
  no-op, a changed pack updates untouched rows only, and a row a teacher edited
  by hand is reported as a conflict rather than overwritten.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.problems import (
    Problem,
    ProblemCreate,
    ProblemImportResponse,
    ProblemImportResultItem,
    ProblemListResponse,
    ProblemRead,
    ProblemUpdate,
)
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.org_auth import require_org_role_permission

# Archive limits. The request-body middleware caps raw uploads at 25 MB by
# default; these are the per-entry/total bounds inside that envelope.
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 1000
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_STATEMENT_CHARS = 200_000
MAX_TESTS = 200
MAX_TEST_CHARS = 64 * 1024
MAX_TITLE_CHARS = 500
MAX_TOPICS = 50

ALLOWED_SUFFIXES = (".json", ".md", ".txt")

_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_HTML_TAG_RE = re.compile(
    r"<\s*(script|iframe|object|embed|style|link|meta|form|base)\b", re.IGNORECASE
)


def _now() -> str:
    # The rest of the codebase stores naive UTC strings; keep that convention.
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def _require_session_user(current_user: PublicUser | AnonymousUser | APITokenUser) -> PublicUser:
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot manage the problem library",
        )
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


async def _authorize(
    org_id: int,
    action: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> PublicUser:
    """Library access reuses the ``assignments`` permission bucket.

    Problems exist to feed assignments, so a role that may author assignments
    may also curate the bank; a role without it gets 403. Pinning to the org
    keeps a member of one tenant from touching another tenant's library.

    Read endpoints deliberately require the *update* action, not ``read``.
    Learners have ``assignments.action_read`` so they can open assignments,
    and the library payload contains hidden tests and their expected stdout.
    Requiring the authoring action keeps that answer key staff-only.
    """
    user = _require_session_user(current_user)
    await require_org_role_permission(
        user.id, org_id, db_session, "assignments", f"action_{action}"
    )
    return user


async def _get_org_or_404(org_id: int, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


# ---------------------------------------------------------------------------
# Validation shared by CRUD and import
# ---------------------------------------------------------------------------


def _clean_text(value: Optional[str], field: str, max_chars: int = MAX_STATEMENT_CHARS) -> str:
    text = (value or "").strip()
    if len(text) > max_chars:
        raise HTTPException(
            status_code=422,
            detail=f"{field} is too long (max {max_chars} characters)",
        )
    if _HTML_TAG_RE.search(text):
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be Markdown, not HTML",
        )
    return text


def normalize_tests(raw: Any) -> List[Dict[str, Any]]:
    """Validate and normalize a test list into the assignment contents shape.

    Accepts either a bare list or ``{"tests": [...]}`` so a hand-written pack
    and an exported assignment task can both be imported unchanged.
    """
    if isinstance(raw, dict):
        raw = raw.get("tests")
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="tests must be a list")
    if len(raw) > MAX_TESTS:
        raise HTTPException(
            status_code=422, detail=f"too many tests (max {MAX_TESTS})"
        )
    if not raw:
        raise HTTPException(status_code=422, detail="at least one test is required")

    seen: set[str] = set()
    tests: List[Dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=422, detail=f"test #{index + 1} must be an object"
            )
        test_id = str(item.get("id") or f"t{index + 1}").strip()[:100]
        if not test_id or test_id in seen:
            raise HTTPException(
                status_code=422, detail=f"duplicate or empty test id: {test_id!r}"
            )
        seen.add(test_id)

        stdin = item.get("stdin", "")
        expected = item.get("expected_stdout", item.get("expectedStdout", ""))
        if not isinstance(stdin, str) or not isinstance(expected, str):
            raise HTTPException(
                status_code=422,
                detail=f"test {test_id}: stdin and expected_stdout must be strings",
            )
        if len(stdin) > MAX_TEST_CHARS or len(expected) > MAX_TEST_CHARS:
            raise HTTPException(
                status_code=422,
                detail=f"test {test_id}: input/output exceeds {MAX_TEST_CHARS} characters",
            )

        weight_raw = item.get("weight", 1)
        try:
            weight = int(weight_raw)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=422, detail=f"test {test_id}: weight must be an integer"
            )
        if weight <= 0:
            raise HTTPException(
                status_code=422, detail=f"test {test_id}: weight must be positive"
            )

        tests.append(
            {
                "id": test_id,
                "label": str(item.get("label") or f"Test {index + 1}")[:200],
                "stdin": stdin,
                "expected_stdout": expected,
                "hidden": bool(item.get("hidden", False)),
                "weight": weight,
            }
        )
    return tests


def _clean_difficulty(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    value = str(raw).strip().lower()
    if not value:
        return None
    if value not in ("easy", "medium", "hard"):
        raise HTTPException(
            status_code=422, detail="difficulty must be one of: easy, medium, hard"
        )
    return value


def _clean_topics(raw: Any) -> List[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="topics must be a list")
    topics: List[str] = []
    seen: set[str] = set()
    for item in raw:
        topic = str(item).strip()[:100]
        if topic and topic.lower() not in seen:
            seen.add(topic.lower())
            topics.append(topic)
    if len(topics) > MAX_TOPICS:
        raise HTTPException(
            status_code=422, detail=f"too many topics (max {MAX_TOPICS})"
        )
    return topics


def _clean_languages(raw: Any) -> List[int]:
    if raw is None:
        return [71, 54]
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=422, detail="languages must be a non-empty list")
    languages: List[int] = []
    for item in raw:
        try:
            languages.append(int(item))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="languages must contain integers")
    return languages


def _optional_int(value: Any, field: str, minimum: int = 0) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be an integer")
    if parsed < minimum:
        raise HTTPException(
            status_code=422, detail=f"{field} must be >= {minimum}"
        )
    return parsed


def _clean_source_url(value: Any) -> Optional[str]:
    url = (str(value) if value is not None else "").strip()[:2000] or None
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=422, detail="source_url must start with http:// or https://"
        )
    return url


def _clean_source(source: Any) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if source is None:
        return None, None, None
    if not isinstance(source, dict):
        raise HTTPException(status_code=422, detail="source must be an object")
    name = (source.get("name") or "").strip()[:200] or None
    url = _clean_source_url(source.get("url"))
    source_id = str(source.get("problem_id") or source.get("id") or "").strip()[:200] or None
    return name, url, source_id


def _validate_title(value: str) -> str:
    title = (value or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")
    if len(title) > MAX_TITLE_CHARS:
        raise HTTPException(
            status_code=422, detail=f"title is too long (max {MAX_TITLE_CHARS})"
        )
    return title


def _canonical_checksum(payload: Dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _checksum_for(
    *,
    title: str,
    statement_md: str,
    input_format: str,
    output_format: str,
    constraints: str,
    difficulty: Optional[str],
    topics: List[str],
    languages: List[int],
    tests: List[Dict[str, Any]],
    time_limit_ms: Optional[int],
    memory_limit_kb: Optional[int],
    source_name: Optional[str],
    source_url: Optional[str],
    source_id: Optional[str],
) -> str:
    return _canonical_checksum(
        {
            "title": title,
            "statement_md": statement_md,
            "input_format": input_format,
            "output_format": output_format,
            "constraints": constraints,
            "difficulty": difficulty,
            "topics": topics,
            "languages": languages,
            "tests": tests,
            "time_limit_ms": time_limit_ms,
            "memory_limit_kb": memory_limit_kb,
            "source_name": source_name,
            "source_url": source_url,
            "source_id": source_id,
        }
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def list_problems(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    search: Optional[str] = None,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    include_archived: bool = False,
    page: int = 1,
    limit: int = 50,
) -> ProblemListResponse:
    await _authorize(org_id, "update", current_user, db_session)
    await _get_org_or_404(org_id, db_session)

    page = max(1, int(page))
    limit = max(1, min(int(limit), 100))

    conditions = [Problem.org_id == org_id]
    if not include_archived:
        conditions.append(Problem.archived == False)
    if search and search.strip():
        needle = f"%{search.strip()}%"
        conditions.append(
            or_(
                Problem.title.ilike(needle),
                Problem.source_id.ilike(needle),
                Problem.source_name.ilike(needle),
            )
        )
    if difficulty and difficulty.strip():
        conditions.append(Problem.difficulty == difficulty.strip())
    if topic and topic.strip():
        # JSON containment is Postgres-only; the tests run on SQLite. Topic
        # filtering is a dashboard affordance over an org's library (hundreds
        # of rows), so filter in Python and paginate the filtered list to keep
        # `total` consistent with what the caller can actually page through.
        all_rows = (
            await db_session.execute(
                select(Problem).where(*conditions).order_by(Problem.id.desc())
            )
        ).scalars().all()
        needle = topic.strip().lower()
        rows = [
            p for p in all_rows
            if needle in [str(t).lower() for t in (p.topics or [])]
        ]
        total = len(rows)
        start = (page - 1) * limit
        rows = rows[start:start + limit]
    else:
        count_statement = select(func.count(Problem.id)).where(*conditions)
        total = (await db_session.execute(count_statement)).scalar_one()

        statement = (
            select(Problem)
            .where(*conditions)
            .order_by(Problem.id.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        rows = (await db_session.execute(statement)).scalars().all()

    return ProblemListResponse(
        problems=[ProblemRead.model_validate(p) for p in rows],
        total=total,
        page=page,
        limit=limit,
    )


async def _get_problem_or_404(
    problem_uuid: str, db_session: AsyncSession
) -> Problem:
    problem = (
        await db_session.execute(
            select(Problem).where(Problem.problem_uuid == problem_uuid)
        )
    ).scalars().first()
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    return problem


async def get_problem(
    problem_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> ProblemRead:
    problem = await _get_problem_or_404(problem_uuid, db_session)
    # Hidden tests are part of the payload; see ``_authorize``.
    await _authorize(problem.org_id, "update", current_user, db_session)
    return ProblemRead.model_validate(problem)


async def create_problem(
    org_id: int,
    problem_object: ProblemCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> ProblemRead:
    user = await _authorize(org_id, "create", current_user, db_session)
    await _get_org_or_404(org_id, db_session)

    title = _validate_title(problem_object.title)
    statement_md = _clean_text(problem_object.statement_md, "statement_md")
    input_format = _clean_text(problem_object.input_format, "input_format", 50_000)
    output_format = _clean_text(problem_object.output_format, "output_format", 50_000)
    constraints = _clean_text(problem_object.constraints, "constraints", 50_000)
    topics = _clean_topics(problem_object.topics)
    languages = _clean_languages(problem_object.languages)
    difficulty = _clean_difficulty(problem_object.difficulty)
    tests = normalize_tests(problem_object.tests)
    time_limit_ms = _optional_int(problem_object.time_limit_ms, "time_limit_ms")
    memory_limit_kb = _optional_int(problem_object.memory_limit_kb, "memory_limit_kb")
    source_name = (problem_object.source_name or "").strip()[:200] or None
    source_url = _clean_source_url(problem_object.source_url)
    source_id = (problem_object.source_id or "").strip()[:200] or None
    if source_id and not source_name:
        raise HTTPException(
            status_code=422,
            detail="source_name is required when a source_id is provided",
        )

    problem = Problem(
        problem_uuid=f"problem_{uuid4()}",
        org_id=org_id,
        created_by_id=user.id,
        title=title,
        statement_md=statement_md,
        input_format=input_format,
        output_format=output_format,
        constraints=constraints,
        difficulty=difficulty,
        topics=topics,
        languages=languages,
        tests=tests,
        time_limit_ms=time_limit_ms,
        memory_limit_kb=memory_limit_kb,
        source_name=source_name,
        source_url=source_url,
        source_id=source_id,
        # A manually authored problem is authoritative. Without this, a later
        # import that happens to share its source id would overwrite it.
        is_edited=True,
        checksum=_checksum_for(
            title=title,
            statement_md=statement_md,
            input_format=input_format,
            output_format=output_format,
            constraints=constraints,
            difficulty=difficulty,
            topics=topics,
            languages=languages,
            tests=tests,
            time_limit_ms=time_limit_ms,
            memory_limit_kb=memory_limit_kb,
            source_name=source_name,
            source_url=source_url,
            source_id=source_id,
        ),
        creation_date=_now(),
        update_date=_now(),
    )
    db_session.add(problem)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        raise HTTPException(
            status_code=409,
            detail="A problem with this source id already exists in this organization",
        )
    await db_session.refresh(problem)
    return ProblemRead.model_validate(problem)


async def update_problem(
    problem_uuid: str,
    problem_object: ProblemUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> ProblemRead:
    problem = await _get_problem_or_404(problem_uuid, db_session)
    await _authorize(problem.org_id, "update", current_user, db_session)

    data = problem_object.model_dump(exclude_unset=True)

    if "title" in data:
        problem.title = _validate_title(data["title"])
    if "statement_md" in data:
        problem.statement_md = _clean_text(data["statement_md"], "statement_md")
    if "input_format" in data:
        problem.input_format = _clean_text(data["input_format"], "input_format", 50_000)
    if "output_format" in data:
        problem.output_format = _clean_text(data["output_format"], "output_format", 50_000)
    if "constraints" in data:
        problem.constraints = _clean_text(data["constraints"], "constraints", 50_000)
    if "difficulty" in data:
        problem.difficulty = _clean_difficulty(data["difficulty"])
    if "topics" in data:
        problem.topics = _clean_topics(data["topics"])
    if "languages" in data:
        problem.languages = _clean_languages(data["languages"])
    if "tests" in data:
        problem.tests = normalize_tests(data["tests"])
    if "time_limit_ms" in data:
        problem.time_limit_ms = _optional_int(data["time_limit_ms"], "time_limit_ms")
    if "memory_limit_kb" in data:
        problem.memory_limit_kb = _optional_int(data["memory_limit_kb"], "memory_limit_kb")
    if "source_name" in data:
        problem.source_name = (data["source_name"] or "").strip()[:200] or None
    if "source_url" in data:
        problem.source_url = _clean_source_url(data["source_url"])
    if "source_id" in data:
        problem.source_id = (data["source_id"] or "").strip()[:200] or None
    if problem.source_id and not problem.source_name:
        raise HTTPException(
            status_code=422,
            detail="source_name is required when a source_id is provided",
        )
    if "archived" in data:
        problem.archived = bool(data["archived"])

    problem.is_edited = True
    problem.checksum = _checksum_for(
        title=problem.title,
        statement_md=problem.statement_md,
        input_format=problem.input_format,
        output_format=problem.output_format,
        constraints=problem.constraints,
        difficulty=problem.difficulty,
        topics=problem.topics or [],
        languages=problem.languages or [],
        tests=problem.tests or [],
        time_limit_ms=problem.time_limit_ms,
        memory_limit_kb=problem.memory_limit_kb,
        source_name=problem.source_name,
        source_url=problem.source_url,
        source_id=problem.source_id,
    )
    problem.update_date = _now()

    db_session.add(problem)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Another problem already uses this source id",
        )
    await db_session.refresh(problem)
    return ProblemRead.model_validate(problem)


async def delete_problem(
    problem_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> dict:
    """Soft-delete: assignments keep their snapshots and history.

    Gated on ``update`` rather than ``delete``: archiving is reversible and
    instructors (who may edit assignments but cannot hard-delete resources)
    must be able to retire a problem from the picker.
    """
    problem = await _get_problem_or_404(problem_uuid, db_session)
    await _authorize(problem.org_id, "update", current_user, db_session)
    problem.archived = True
    problem.update_date = _now()
    db_session.add(problem)
    await db_session.commit()
    return {"message": "Problem archived", "problem_uuid": problem.problem_uuid}


# ---------------------------------------------------------------------------
# ZIP import
# ---------------------------------------------------------------------------


def _safe_member_name(info: zipfile.ZipInfo) -> str:
    name = info.filename
    if not name or "\x00" in name:
        raise HTTPException(status_code=400, detail="archive contains an empty/NUL filename")
    if "\\" in name:
        raise HTTPException(status_code=400, detail=f"unsafe path in archive: {name!r}")
    if name.startswith("/") or _DRIVE_RE.match(name):
        raise HTTPException(status_code=400, detail=f"absolute path in archive: {name!r}")
    parts = [part for part in name.split("/") if part]
    if any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail=f"path traversal in archive: {name!r}")
    # Symlinks carry S_IFLNK in the external attributes on Unix-created zips.
    mode = (info.external_attr >> 16) & 0o170000
    if mode == 0o120000:
        raise HTTPException(status_code=400, detail=f"symlink in archive: {name!r}")
    return name


def _read_archive(data: bytes) -> Dict[str, bytes]:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"archive is too large (max {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB)",
        )
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ARCHIVE_ENTRIES:
                raise HTTPException(
                    status_code=413,
                    detail=f"archive has too many entries (max {MAX_ARCHIVE_ENTRIES})",
                )
            total = sum(i.file_size for i in infos)
            if total > MAX_UNCOMPRESSED_BYTES:
                raise HTTPException(status_code=413, detail="archive expands beyond the size cap")

            files: Dict[str, bytes] = {}
            actual_total = 0
            for info in infos:
                if info.is_dir():
                    continue
                name = _safe_member_name(info)
                if not name.lower().endswith(ALLOWED_SUFFIXES):
                    raise HTTPException(
                        status_code=400,
                        detail=f"unsupported file in archive: {name!r}",
                    )
                # Do not trust the declared size: read one byte past the cap
                # and reject, so a forged central directory cannot turn this
                # into a decompression bomb.
                with zf.open(info) as member:
                    content = member.read(MAX_FILE_BYTES + 1)
                if len(content) > MAX_FILE_BYTES:
                    raise HTTPException(
                        status_code=413, detail=f"file too large in archive: {name!r}"
                    )
                actual_total += len(content)
                if actual_total > MAX_UNCOMPRESSED_BYTES:
                    raise HTTPException(
                        status_code=413, detail="archive expands beyond the size cap"
                    )
                files[name] = content
            return files
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="not a valid ZIP archive")


def _decode(files: Dict[str, bytes], name: str) -> str:
    if name not in files:
        raise HTTPException(status_code=422, detail=f"missing file in archive: {name}")
    try:
        return files[name].decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail=f"{name} is not valid UTF-8")


def _load_json(files: Dict[str, bytes], name: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(_decode(files, name))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"{name}: invalid JSON ({exc.msg})")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail=f"{name} must contain a JSON object")
    return parsed


def _load_manifest(files: Dict[str, bytes]) -> List[Dict[str, Any]]:
    manifest = _load_json(files, "manifest.json")
    if manifest.get("format") != "learnhouse-problem-pack":
        raise HTTPException(
            status_code=422,
            detail="manifest.json: format must be 'learnhouse-problem-pack'",
        )
    if manifest.get("version") != 1:
        raise HTTPException(status_code=422, detail="manifest.json: unsupported version")
    problems = manifest.get("problems")
    if not isinstance(problems, list) or not problems:
        raise HTTPException(status_code=422, detail="manifest.json: problems must be a non-empty list")
    seen_dirs: set[str] = set()
    seen_external_ids: set[str] = set()
    for index, item in enumerate(problems):
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail=f"manifest problems[{index}] must be an object")
        directory = str(item.get("dir") or "").strip().strip("/")
        if not directory or ".." in directory.split("/"):
            raise HTTPException(status_code=422, detail=f"manifest problems[{index}]: invalid dir")
        if directory in seen_dirs:
            raise HTTPException(
                status_code=422,
                detail=f"manifest problems[{index}]: duplicate dir {directory!r}",
            )
        seen_dirs.add(directory)
        external_id = str(item.get("external_id") or "").strip()
        if external_id:
            if external_id in seen_external_ids:
                raise HTTPException(
                    status_code=422,
                    detail=f"manifest problems[{index}]: duplicate external_id {external_id!r}",
                )
            seen_external_ids.add(external_id)
    return problems


def _parse_problem_dir(files: Dict[str, bytes], directory: str) -> Dict[str, Any]:
    meta = _load_json(files, f"{directory}/problem.json")

    title = _validate_title(str(meta.get("title") or ""))
    statement_file = str(meta.get("statement_file") or "statement.md").strip()
    if "/" in statement_file or "\\" in statement_file:
        raise HTTPException(status_code=422, detail=f"{directory}: statement_file must be a bare filename")
    statement_md = _clean_text(
        _decode(files, f"{directory}/{statement_file}"), f"{directory}/{statement_file}"
    )

    tests_file = str(meta.get("tests_file") or "tests.json").strip()
    if "/" in tests_file or "\\" in tests_file:
        raise HTTPException(status_code=422, detail=f"{directory}: tests_file must be a bare filename")
    tests = normalize_tests(_load_json(files, f"{directory}/{tests_file}"))

    source_name, source_url, source_id = _clean_source(meta.get("source"))
    limits = meta.get("limits") or {}
    if not isinstance(limits, dict):
        raise HTTPException(status_code=422, detail=f"{directory}: limits must be an object")

    external_id = str(meta.get("external_id") or "").strip() or None
    if source_id and not source_name:
        raise HTTPException(
            status_code=422, detail=f"{directory}: source.name is required with source.problem_id"
        )

    input_format = _clean_text(meta.get("input_format"), "input_format", 50_000)
    output_format = _clean_text(meta.get("output_format"), "output_format", 50_000)
    constraints = _clean_text(meta.get("constraints"), "constraints", 50_000)
    difficulty = _clean_difficulty(meta.get("difficulty"))
    topics = _clean_topics(meta.get("topics"))
    languages = _clean_languages(meta.get("languages"))
    time_limit_ms = _optional_int(limits.get("time_ms"), "limits.time_ms")
    memory_limit_kb = _optional_int(limits.get("memory_kb"), "limits.memory_kb")

    return {
        "title": title,
        "statement_md": statement_md,
        "input_format": input_format,
        "output_format": output_format,
        "constraints": constraints,
        "difficulty": difficulty,
        "topics": topics,
        "languages": languages,
        "tests": tests,
        "time_limit_ms": time_limit_ms,
        "memory_limit_kb": memory_limit_kb,
        "source_name": source_name,
        "source_url": source_url,
        "source_id": source_id,
        "external_id": external_id,
        "checksum": _checksum_for(
            title=title,
            statement_md=statement_md,
            input_format=input_format,
            output_format=output_format,
            constraints=constraints,
            difficulty=difficulty,
            topics=topics,
            languages=languages,
            tests=tests,
            time_limit_ms=time_limit_ms,
            memory_limit_kb=memory_limit_kb,
            source_name=source_name,
            source_url=source_url,
            source_id=source_id,
        ),
    }


async def _find_existing(
    org_id: int, parsed: Dict[str, Any], db_session: AsyncSession
) -> Optional[Problem]:
    if parsed["source_name"] and parsed["source_id"]:
        # A sourced problem is identified by its source, never by content
        # alone: two different sources can legitimately publish the same
        # statement, and matching by checksum would silently rewrite the
        # first problem's attribution.
        return (
            await db_session.execute(
                select(Problem).where(
                    Problem.org_id == org_id,
                    Problem.source_name == parsed["source_name"],
                    Problem.source_id == parsed["source_id"],
                )
            )
        ).scalars().first()
    return (
        await db_session.execute(
            select(Problem).where(
                Problem.org_id == org_id, Problem.checksum == parsed["checksum"]
            )
        )
    ).scalars().first()


def _apply_parsed(problem: Problem, parsed: Dict[str, Any]) -> None:
    problem.title = parsed["title"]
    problem.statement_md = parsed["statement_md"]
    problem.input_format = parsed["input_format"]
    problem.output_format = parsed["output_format"]
    problem.constraints = parsed["constraints"]
    problem.difficulty = parsed["difficulty"]
    problem.topics = parsed["topics"]
    problem.languages = parsed["languages"]
    problem.tests = parsed["tests"]
    problem.time_limit_ms = parsed["time_limit_ms"]
    problem.memory_limit_kb = parsed["memory_limit_kb"]
    problem.source_name = parsed["source_name"]
    problem.source_url = parsed["source_url"]
    problem.source_id = parsed["source_id"]
    problem.checksum = parsed["checksum"]
    problem.update_date = _now()


async def import_problems(
    org_id: int,
    upload: UploadFile,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    dry_run: bool = False,
) -> ProblemImportResponse:
    user = await _authorize(org_id, "create", current_user, db_session)
    await _get_org_or_404(org_id, db_session)

    data = await upload.read()
    files = _read_archive(data)
    entries = _load_manifest(files)

    results: List[ProblemImportResultItem] = []
    created = updated = skipped = conflicts = failed = 0

    for entry in entries:
        directory = str(entry.get("dir")).strip().strip("/")
        parsed: Optional[Dict[str, Any]] = None
        manifest_external_id = entry.get("external_id")
        external_id = (
            str(manifest_external_id).strip() or None
            if manifest_external_id is not None
            else None
        )
        try:
            parsed = _parse_problem_dir(files, directory)
            external_id = parsed.get("external_id") or external_id
            existing = await _find_existing(org_id, parsed, db_session)

            if existing is not None and existing.checksum == parsed["checksum"]:
                skipped += 1
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=parsed["title"],
                        status="skipped",
                        problem_uuid=existing.problem_uuid,
                    )
                )
                continue

            if existing is not None and existing.is_edited:
                conflicts += 1
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=parsed["title"],
                        status="conflict",
                        problem_uuid=existing.problem_uuid,
                        error="Problem was edited manually; re-import did not overwrite it",
                    )
                )
                continue

            if existing is not None and existing.archived:
                conflicts += 1
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=parsed["title"],
                        status="conflict",
                        problem_uuid=existing.problem_uuid,
                        error="Problem is archived; unarchive it before importing a new version",
                    )
                )
                continue

            if dry_run:
                if existing is None:
                    created += 1
                    status = "created"
                else:
                    updated += 1
                    status = "updated"
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=parsed["title"],
                        status=status,
                        problem_uuid=existing.problem_uuid if existing else None,
                    )
                )
                continue

            if existing is None:
                problem = Problem(
                    problem_uuid=f"problem_{uuid4()}",
                    org_id=org_id,
                    created_by_id=user.id,
                    creation_date=_now(),
                    update_date=_now(),
                    **_problem_payload(parsed),
                )
                db_session.add(problem)
                await db_session.commit()
                await db_session.refresh(problem)
                created += 1
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=problem.title,
                        status="created",
                        problem_uuid=problem.problem_uuid,
                    )
                )
            else:
                _apply_parsed(existing, parsed)
                db_session.add(existing)
                await db_session.commit()
                updated += 1
                results.append(
                    ProblemImportResultItem(
                        external_id=external_id,
                        title=existing.title,
                        status="updated",
                        problem_uuid=existing.problem_uuid,
                    )
                )
        except HTTPException as exc:
            failed += 1
            detail = exc.detail if isinstance(exc.detail, str) else "validation error"
            if not dry_run:
                await db_session.rollback()
            results.append(
                ProblemImportResultItem(
                    external_id=external_id,
                    title=(parsed or {}).get("title"),
                    status="failed",
                    error=f"{directory}: {detail}",
                )
            )
        except IntegrityError:
            failed += 1
            await db_session.rollback()
            results.append(
                ProblemImportResultItem(
                    external_id=external_id,
                    title=(parsed or {}).get("title"),
                    status="failed",
                    error=f"{directory}: duplicate source id",
                )
            )
        except Exception as exc:  # noqa: BLE001  # pragma: no cover - defensive
            failed += 1
            await db_session.rollback()
            results.append(
                ProblemImportResultItem(
                    external_id=external_id,
                    title=(parsed or {}).get("title"),
                    status="failed",
                    error=f"{directory}: {type(exc).__name__}",
                )
            )

    return ProblemImportResponse(
        dry_run=dry_run,
        created=created,
        updated=updated,
        skipped=skipped,
        conflicts=conflicts,
        failed=failed,
        results=results,
    )


def _problem_payload(parsed: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": parsed["title"],
        "statement_md": parsed["statement_md"],
        "input_format": parsed["input_format"],
        "output_format": parsed["output_format"],
        "constraints": parsed["constraints"],
        "difficulty": parsed["difficulty"],
        "topics": parsed["topics"],
        "languages": parsed["languages"],
        "tests": parsed["tests"],
        "time_limit_ms": parsed["time_limit_ms"],
        "memory_limit_kb": parsed["memory_limit_kb"],
        "source_name": parsed["source_name"],
        "source_url": parsed["source_url"],
        "source_id": parsed["source_id"],
        "checksum": parsed["checksum"],
    }
