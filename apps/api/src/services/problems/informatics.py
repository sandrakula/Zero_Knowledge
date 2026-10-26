"""Informatics problem importer.

informatics.msk.ru exposes an undocumented JSON endpoint for a single problem:

    GET https://informatics.msk.ru/py/problem/<id>/json

It returns the statement HTML, sample tests and limits. It does **not** expose
the judge's hidden tests, so an imported problem is a normal library problem
whose public examples are its only tests. Grading is still server-side; if the
teacher wants hidden tests they add them in the library editor.

The importer deliberately converts one id at a time and reuses the regular ZIP
import path, so validation, duplicate handling, manual-edit conflicts and the
attempt/answer-key rules are identical to a hand-prepared pack.
"""

from __future__ import annotations

import html
import io
import json
import re
from html.parser import HTMLParser
from typing import Any, Dict, List

import httpx
from fastapi import HTTPException, UploadFile
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.problems import ProblemImportResponse
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.services.problems.problems import _authorize, import_problems
from src.services.security.rate_limiting import check_rate_limit

INFORMATICS_BASE = "https://informatics.msk.ru"
INFORMATICS_PROBLEM_URL = INFORMATICS_BASE + "/py/problem/{problem_id}/json"
INFORMATICS_TIMEOUT = 15.0
MAX_INFORMATICS_RESPONSE_BYTES = 2 * 1024 * 1024


class _TextExtractor(HTMLParser):
    """Turn a fragment of the statement HTML into readable plain text."""

    _BLOCKS = {
        "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
        "pre", "blockquote", "section",
    }
    _SKIP = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip += 1
        elif not self._skip and tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip:
            self._skip -= 1
        elif not self._skip and tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)

    def text(self) -> str:
        value = html.unescape("".join(self.parts))
        value = re.sub(r"[ \t]+\n", "\n", value)
        value = re.sub(r"\n{3,}", "\n\n", value)
        return value.strip()


class _PreExtractor(HTMLParser):
    """Collect the contents of every ``<pre class="content">`` in order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pre: List[str] = []
        self._in_pre = False
        self._buf: List[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "pre":
            self._in_pre = True
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "pre" and self._in_pre:
            self.pre.append("".join(self._buf).strip("\r\n"))
            self._in_pre = False

    def handle_data(self, data: str) -> None:
        if self._in_pre:
            self._buf.append(data)


def _paragraph_text(fragment: str) -> str:
    parser = _TextExtractor()
    parser.feed(fragment or "")
    parser.close()
    return parser.text()


def _statement_sections(content: str) -> tuple[str, str, str]:
    text = _paragraph_text(content)
    input_marker = "Входные данные"
    output_marker = "Выходные данные"
    input_at = text.find(input_marker)
    output_at = text.find(output_marker)

    statement = text
    input_format = ""
    output_format = ""
    if input_at >= 0:
        statement = text[:input_at].strip()
        if output_at > input_at:
            input_format = text[input_at + len(input_marker):output_at].strip()
            output_format = text[output_at + len(output_marker):].strip()
        else:
            input_format = text[input_at + len(input_marker):].strip()
    return statement, input_format, output_format


def _sample_tests(sample_html: str) -> List[Dict[str, Any]]:
    parser = _PreExtractor()
    parser.feed(sample_html or "")
    parser.close()
    values = parser.pre
    tests: List[Dict[str, Any]] = []
    for index in range(0, len(values) - 1, 2):
        stdin = values[index]
        expected = values[index + 1]
        tests.append(
            {
                "id": f"sample_{index // 2 + 1}",
                "label": f"Example {index // 2 + 1}",
                "stdin": stdin,
                "expected_stdout": expected,
                "hidden": False,
                "weight": 1,
            }
        )
    return tests


def _judge0_languages(raw_languages: Any) -> List[int]:
    # The IDs in this payload are Informatics' own; map by name to the Judge0
    # ids the editor uses and keep a safe fallback.
    names = " ".join(
        str(item.get("name") or "")
        for item in (raw_languages or [])
        if isinstance(item, dict)
    ).lower()
    languages: List[int] = []
    if "python" in names:
        languages.append(71)
    if "c++" in names or "g++" in names:
        languages.append(54)
    if "java" in names:
        languages.append(62)
    return languages or [71, 54]


def _pack_from_payload(problem_id: int, payload: Dict[str, Any]) -> bytes:
    title = str(payload.get("name") or "").strip() or f"Задача {problem_id}"

    statement, input_format, output_format = _statement_sections(
        str(payload.get("content") or "")
    )
    tests = _sample_tests(str(payload.get("sample_tests_html") or ""))
    if not tests:
        raise HTTPException(
            status_code=422,
            detail=(
                "Informatics problem has no public sample tests; add tests in the "
                "library editor before assigning it"
            ),
        )

    timelimit = payload.get("timelimit")
    memorylimit = payload.get("memorylimit")
    try:
        time_ms = int(float(timelimit) * 1000) if timelimit is not None else None
    except (TypeError, ValueError):
        time_ms = None
    try:
        memory_kb = int(memorylimit) // 1024 if memorylimit is not None else None
    except (TypeError, ValueError):
        memory_kb = None

    meta = {
        "external_id": f"informatics-{problem_id}",
        "title": title,
        "statement_file": "statement.md",
        "input_format": input_format,
        "output_format": output_format,
        "constraints": "",
        "topics": [],
        "languages": _judge0_languages(payload.get("languages")),
        "limits": {
            **({"time_ms": time_ms} if time_ms else {}),
            **({"memory_kb": memory_kb} if memory_kb else {}),
        },
        "source": {
            "name": "Informatics",
            "url": f"{INFORMATICS_BASE}/py/problem/{problem_id}",
            "problem_id": str(problem_id),
        },
        "tests_file": "tests.json",
    }
    manifest = {
        "format": "learnhouse-problem-pack",
        "version": 1,
        "problems": [
            {
                "external_id": f"informatics-{problem_id}",
                "dir": f"problems/{problem_id}",
            }
        ],
    }
    directory = f"problems/{problem_id}"
    buffer = io.BytesIO()
    import zipfile

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr(f"{directory}/problem.json", json.dumps(meta, ensure_ascii=False))
        archive.writestr(f"{directory}/statement.md", statement)
        archive.writestr(f"{directory}/tests.json", json.dumps({"tests": tests}, ensure_ascii=False))
    return buffer.getvalue()


async def _fetch_informatics_json(problem_id: int) -> Dict[str, Any]:
    url = INFORMATICS_PROBLEM_URL.format(problem_id=problem_id)
    try:
        async with httpx.AsyncClient(timeout=INFORMATICS_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "LearnHouse problem importer",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Informatics request failed: {type(exc).__name__}"
        )
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Informatics problem not found")
    if response.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"Informatics returned HTTP {response.status_code}"
        )
    if len(response.content) > MAX_INFORMATICS_RESPONSE_BYTES:
        raise HTTPException(status_code=413, detail="Informatics response is too large")
    try:
        payload = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Informatics returned invalid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Informatics returned an unexpected payload")
    return payload


async def import_informatics_problem(
    org_id: int,
    problem_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    dry_run: bool = False,
) -> ProblemImportResponse:
    """Fetch one Informatics problem and run it through the normal importer."""
    user = await _authorize(org_id, "create", current_user, db_session)
    is_allowed, _count, retry_after = check_rate_limit(
        key=f"informatics_import:{user.id}",
        max_attempts=10,
        window_seconds=60,
    )
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many Informatics imports; try again shortly",
            headers={"Retry-After": str(retry_after)},
        )
    payload = await _fetch_informatics_json(problem_id)
    pack = _pack_from_payload(problem_id, payload)
    upload = UploadFile(filename=f"informatics-{problem_id}.zip", file=io.BytesIO(pack))
    return await import_problems(
        org_id, upload, current_user, db_session, dry_run=dry_run
    )
