"""Informatics account binding, token management and verdict storage."""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
)
from src.db.informatics import (
    InformaticsAccount,
    InformaticsSubmission,
    SubmissionStatus,
)
from src.db.user_organizations import UserOrganization
from src.services.informatics.verdicts import map_verdict

TOKEN_PREFIX = "zi_"
SOLVED_STATUSES = {0, 8}

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now().isoformat()


def _json_value(value: Any) -> dict:
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value or {}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_ingest_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


async def get_account(db: AsyncSession, user_id: int) -> Optional[InformaticsAccount]:
    return (
        await db.execute(
            select(InformaticsAccount).where(InformaticsAccount.user_id == user_id)
        )
    ).scalars().first()


async def get_account_by_token(
    db: AsyncSession, token: str
) -> Optional[InformaticsAccount]:
    token = (token or "").strip()
    if not token.startswith(TOKEN_PREFIX):
        return None
    return (
        await db.execute(
            select(InformaticsAccount).where(
                InformaticsAccount.ingest_token_hash == hash_token(token)
            )
        )
    ).scalars().first()


async def ensure_account(db: AsyncSession, user_id: int) -> InformaticsAccount:
    account = await get_account(db, user_id)
    if account is None:
        now = _now()
        account = InformaticsAccount(
            user_id=user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(account)
        await db.flush()
    return account


async def set_username(
    db: AsyncSession,
    user_id: int,
    username: str,
    informatics_user_id: int = 0,
) -> InformaticsAccount:
    account = await ensure_account(db, user_id)
    account.username = (username or "").strip()[:200]
    account.informatics_user_id = int(informatics_user_id or 0)
    account.updated_at = _now()
    await db.commit()
    await db.refresh(account)
    return account


async def rotate_token(db: AsyncSession, user_id: int) -> tuple[InformaticsAccount, str]:
    account = await ensure_account(db, user_id)
    token = new_ingest_token()
    account.ingest_token_hash = hash_token(token)
    account.token_created_at = _now()
    account.updated_at = account.token_created_at
    await db.commit()
    await db.refresh(account)
    return account, token


async def revoke(db: AsyncSession, user_id: int) -> None:
    account = await get_account(db, user_id)
    if account is not None:
        await db.delete(account)
        await db.commit()


async def touch_account(db: AsyncSession, account: InformaticsAccount) -> str:
    """Record that the userscript is running, without a verdict.

    The course gate uses this as proof of installation: a token alone can be
    generated from the account page, but only the script calls this endpoint.
    """
    now = _now()
    account.last_seen_at = now
    account.updated_at = now
    await db.commit()
    return now


async def _matching_tasks(
    db: AsyncSession, user_id: int, problem_id: int
) -> list[AssignmentTask]:
    """Return tasks whose snapshot is this informatics problem."""
    org_ids = list(
        (
            await db.execute(
                select(UserOrganization.org_id).where(UserOrganization.user_id == user_id)
            )
        ).scalars().all()
    )
    if not org_ids:
        return []

    tasks = list(
        (
            await db.execute(
                select(AssignmentTask).where(
                    AssignmentTask.org_id.in_(org_ids),
                    AssignmentTask.assignment_type == AssignmentTaskTypeEnum.CODE,
                )
            )
        ).scalars().all()
    )
    matches: list[AssignmentTask] = []
    for task in tasks:
        meta = _json_value(task.contents).get("_meta") or {}
        if str(meta.get("problem_id")) == str(problem_id):
            matches.append(task)
    return matches


async def record_submission(
    db: AsyncSession,
    account: InformaticsAccount,
    *,
    problem_id: int,
    run_id: int,
    ejudge_status: int,
    tests: int,
    score: int,
    source: str = "userscript",
) -> dict:
    """Upsert one run. Idempotent by ``(user_id, run_id)``.

    ``solved`` is derived from the verdict, never trusted from the client.
    """
    solved = int(ejudge_status) in SOLVED_STATUSES
    verdict = map_verdict(int(ejudge_status)).value
    test_count = max(0, int(tests or 0))
    score_value = max(0, int(score or 0))
    now = _now()

    existing = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.user_id == account.user_id,
                InformaticsSubmission.run_id == run_id,
            )
        )
    ).scalars().first()

    duplicate = existing is not None
    if existing is None:
        row = InformaticsSubmission(
            submission_uuid=f"userscript_{account.user_id}_{int(run_id)}",
            user_id=account.user_id,
            problem_id=int(problem_id),
            run_id=int(run_id),
            ejudge_status=int(ejudge_status),
            tests=test_count,
            tests_passed=test_count,
            tests_total=test_count,
            score=score_value,
            max_score=100 if solved else 0,
            solved=solved,
            status=SubmissionStatus.FINAL.value,
            verdict=verdict,
            attempt_no=1,
            source=(source or "userscript")[:32],
            created_at=now,
            updated_at=now,
            finished_at=now,
        )
        db.add(row)
    else:
        row = existing
        row.problem_id = int(problem_id)
        row.ejudge_status = int(ejudge_status)
        row.tests = test_count
        row.tests_passed = test_count
        row.tests_total = test_count
        row.score = score_value
        row.max_score = 100 if solved else 0
        row.solved = solved
        row.status = SubmissionStatus.FINAL.value
        row.verdict = verdict
        row.finished_at = now
        row.updated_at = now

    account.last_seen_at = now
    account.updated_at = now
    await db.flush()

    matched_tasks = await _matching_tasks(db, account.user_id, int(problem_id))
    if matched_tasks:
        first = matched_tasks[0]
        row.assignment_task_uuid = first.assignment_task_uuid
        row.org_id = first.org_id
        assignment = (
            await db.execute(
                select(Assignment).where(Assignment.id == first.assignment_id)
            )
        ).scalars().first()
        if assignment is not None:
            row.assignment_uuid = assignment.assignment_uuid
        db.add(row)
    await db.commit()

    task_uuids = [task.assignment_task_uuid for task in matched_tasks]

    # The userscript path is a real verdict too: credit the task exactly once,
    # using the same idempotent helper as the server-side worker.
    if solved and matched_tasks:
        try:
            from src.services.informatics.credit import credit_accepted_submission

            await credit_accepted_submission(db, row)
        except Exception:
            logger.exception(
                "Informatics task credit failed for userscript run %s", run_id
            )

    return {
        "ok": True,
        "duplicate": duplicate,
        "solved": solved,
        "problem_id": int(problem_id),
        "run_id": int(run_id),
        "task_uuids": task_uuids,
    }


async def list_results(
    db: AsyncSession, user_id: int, limit: int = 50
) -> list[InformaticsSubmission]:
    return list(
        (
            await db.execute(
                select(InformaticsSubmission)
                .where(InformaticsSubmission.user_id == user_id)
                .order_by(InformaticsSubmission.created_at.desc())
                .limit(max(1, min(limit, 200)))
            )
        ).scalars().all()
    )


async def solved_count(db: AsyncSession, user_id: int) -> int:
    return int(
        (
            await db.execute(
                select(func.count(func.distinct(InformaticsSubmission.problem_id))).where(
                    InformaticsSubmission.user_id == user_id,
                    InformaticsSubmission.solved.is_(True),
                )
            )
        ).scalar_one()
    )


async def results_for_assignment(
    db: AsyncSession, user_id: int, assignment_uuid: str
) -> dict:
    """Map task UUIDs in one assignment to the user's latest Informatics verdict."""
    assignment = (
        await db.execute(
            select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
        )
    ).scalars().first()
    if assignment is None:
        return {}

    tasks = list(
        (
            await db.execute(
                select(AssignmentTask).where(
                    AssignmentTask.assignment_id == assignment.id
                )
            )
        ).scalars().all()
    )
    by_problem: dict[int, list[str]] = {}
    for task in tasks:
        meta = _json_value(task.contents).get("_meta") or {}
        raw_pid = meta.get("problem_id")
        try:
            pid = int(raw_pid)
        except (TypeError, ValueError):
            continue
        by_problem.setdefault(pid, []).append(task.assignment_task_uuid)

    if not by_problem:
        return {}

    rows = list(
        (
            await db.execute(
                select(InformaticsSubmission)
                .where(
                    InformaticsSubmission.user_id == user_id,
                    InformaticsSubmission.problem_id.in_(list(by_problem.keys())),
                )
                .order_by(InformaticsSubmission.updated_at.desc())
            )
        ).scalars().all()
    )
    latest: dict[int, InformaticsSubmission] = {}
    for row in rows:
        latest.setdefault(row.problem_id, row)

    result: dict[str, dict] = {}
    for pid, task_uuids in by_problem.items():
        row = latest.get(pid)
        if row is None:
            continue
        for task_uuid in task_uuids:
            result[task_uuid] = {
                "problem_id": pid,
                "run_id": row.run_id,
                "ejudge_status": row.ejudge_status,
                "solved": row.solved,
                "tests": row.tests,
                "score": row.score,
                "updated_at": row.updated_at,
            }
    return result


async def results_for_problems(
    db: AsyncSession, user_id: int, problem_ids: list[int]
) -> list[dict]:
    if not problem_ids:
        return []
    rows = list(
        (
            await db.execute(
                select(InformaticsSubmission)
                .where(
                    InformaticsSubmission.user_id == user_id,
                    InformaticsSubmission.problem_id.in_(problem_ids),
                )
                .order_by(InformaticsSubmission.updated_at.desc())
            )
        ).scalars().all()
    )
    # Latest row per problem wins.
    seen: set[int] = set()
    latest: list[dict] = []
    for row in rows:
        if row.problem_id in seen:
            continue
        seen.add(row.problem_id)
        latest.append(
            {
                "problem_id": row.problem_id,
                "run_id": row.run_id,
                "ejudge_status": row.ejudge_status,
                "tests": row.tests,
                "score": row.score,
                "solved": row.solved,
                "updated_at": row.updated_at,
            }
        )
    return latest
