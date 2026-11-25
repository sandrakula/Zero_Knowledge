"""Submission use cases: create, read, history, retry, cancel and worker steps.

The HTTP layer never talks to Informatics. It creates a QUEUED row; the worker
claims it, submits, polls and finalizes. Every transition appends an event.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.informatics import (
    ACTIVE_SUBMISSION_STATUSES,
    InformaticsProblem,
    InformaticsSubmission,
    InformaticsSubmissionEvent,
    SubmissionStatus,
)
from src.services.informatics.ingest import get_account
from src.services.informatics.languages import get_language, is_supported_by_problem
from src.services.informatics.verdicts import is_solved, map_verdict, verdict_label

MAX_SOURCE_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 32 * 1024
MAX_ATTEMPTS = 5
POLL_MAX_SECONDS = 600


class SubmissionError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "INFORMATICS_ERROR",
        submission_uuid: str = "",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.submission_uuid = submission_uuid


def _now() -> str:
    return datetime.now().isoformat()


def _after(seconds: int) -> str:
    return (datetime.now() + timedelta(seconds=seconds)).isoformat()


def _uuid() -> str:
    return f"informatics_{uuid.uuid4()}"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _truncate(value: str | None, limit: int = MAX_OUTPUT_BYTES) -> str:
    text = value or ""
    return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


async def record_event(
    db: AsyncSession,
    submission_id: int,
    phase: str,
    message: str = "",
    *,
    level: str = "info",
    http_status: int = 0,
    payload: dict | None = None,
) -> None:
    db.add(
        InformaticsSubmissionEvent(
            submission_id=submission_id,
            at=_now(),
            phase=phase[:48],
            level=level[:16],
            message=_truncate(message),
            http_status=int(http_status or 0),
            payload=payload,
        )
    )


async def _events(db: AsyncSession, submission_id: int, limit: int = 100) -> list[dict]:
    rows = (
        await db.execute(
            select(InformaticsSubmissionEvent)
            .where(InformaticsSubmissionEvent.submission_id == submission_id)
            .order_by(InformaticsSubmissionEvent.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        {
            "at": row.at,
            "phase": row.phase,
            "level": row.level,
            "message": row.message,
            "http_status": row.http_status,
            "payload": row.payload,
        }
        for row in reversed(rows)
    ]


def serialize(row: InformaticsSubmission, events: list[dict] | None = None) -> dict:
    data = {
        "submission_uuid": row.submission_uuid,
        "user_id": row.user_id,
        "problem_id": row.problem_id,
        "status": row.status,
        "verdict": row.verdict or None,
        "verdict_label": verdict_label(row.verdict) if row.verdict else None,
        "ejudge_status": row.ejudge_status,
        "run_id": row.run_id,
        "language_our_id": row.language_our_id,
        "language_informatics_id": row.language_informatics_id,
        "attempt_no": row.attempt_no,
        "tests_passed": row.tests_passed or row.tests,
        "tests_total": row.tests_total,
        "score": row.score,
        "max_score": row.max_score,
        "time_ms": row.time_ms,
        "memory_kb": row.memory_kb,
        "compile_output": _truncate(row.compile_output),
        "stderr": _truncate(row.stderr),
        "message": _truncate(row.message),
        "last_error": _truncate(row.last_error),
        "raw_verdict": row.raw_verdict,
        "credited": bool(row.credited),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "finished_at": row.finished_at,
    }
    if events is not None:
        data["events"] = events
    return data


async def _active(
    db: AsyncSession, user_id: int, problem_id: int
) -> InformaticsSubmission | None:
    return (
        await db.execute(
            select(InformaticsSubmission)
            .where(
                InformaticsSubmission.user_id == user_id,
                InformaticsSubmission.problem_id == problem_id,
                InformaticsSubmission.status.in_(ACTIVE_SUBMISSION_STATUSES),  # type: ignore[attr-defined]
            )
            .order_by(InformaticsSubmission.created_at.desc())
            .limit(1)
        )
    ).scalars().first()


async def _max_attempt(db: AsyncSession, user_id: int, problem_id: int) -> int:
    value = (
        await db.execute(
            select(func.max(InformaticsSubmission.attempt_no)).where(
                InformaticsSubmission.user_id == user_id,
                InformaticsSubmission.problem_id == problem_id,
            )
        )
    ).scalar_one_or_none()
    return int(value or 0)


async def create_submission(
    db: AsyncSession,
    *,
    user_id: int,
    problem_id: int,
    language_id: int,
    source_code: str,
    assignment_task_uuid: str = "",
    assignment_uuid: str = "",
    activity_uuid: str = "",
    org_id: int | None = None,
    client_request_id: str = "",
) -> dict:
    account = await get_account(db, user_id)
    if account is None or not account.password_encrypted:
        raise SubmissionError(
            "Connect your Informatics account first",
            status_code=409,
            code="INFORMATICS_NOT_LINKED",
        )

    language = get_language(language_id)
    if language is None:
        raise SubmissionError(
            "Unsupported language",
            status_code=422,
            code="UNSUPPORTED_LANGUAGE",
        )

    source = source_code or ""
    if not source.strip():
        raise SubmissionError("Source code is empty", status_code=400, code="EMPTY_SOURCE")
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise SubmissionError(
            "Source code is too large",
            status_code=413,
            code="SOURCE_TOO_LARGE",
        )

    # Validate against the cached problem catalog when we already have it. If
    # the cache is cold, the worker fetches the problem and fails with the same
    # clear message; this keeps POST /submissions network-free.
    problem = await db.get(InformaticsProblem, problem_id)
    if problem and problem.languages:
        if not is_supported_by_problem(language_id, problem.languages):
            raise SubmissionError(
                "This problem does not support the selected language",
                status_code=422,
                code="LANGUAGE_NOT_SUPPORTED",
            )

    client_request_id = (client_request_id or "").strip()[:64]
    if client_request_id:
        existing = (
            await db.execute(
                select(InformaticsSubmission).where(
                    InformaticsSubmission.user_id == user_id,
                    InformaticsSubmission.client_request_id == client_request_id,
                )
            )
        ).scalars().first()
        if existing is not None:
            return serialize(existing, await _events(db, int(existing.id)))

    active = await _active(db, user_id, problem_id)
    if active is not None:
        raise SubmissionError(
            "A submission for this problem is already running",
            status_code=409,
            code="ACTIVE_SUBMISSION_EXISTS",
            submission_uuid=active.submission_uuid,
        )

    now = _now()
    row = InformaticsSubmission(
        submission_uuid=_uuid(),
        client_request_id=client_request_id,
        user_id=user_id,
        problem_id=int(problem_id),
        assignment_task_uuid=(assignment_task_uuid or "")[:64],
        assignment_uuid=(assignment_uuid or "")[:64],
        activity_uuid=(activity_uuid or "")[:64],
        org_id=org_id,
        language_our_id=language.our_id,
        language_informatics_id=language.informatics_id,
        source_sha256=_sha256(source),
        source_code=source,
        attempt_no=await _max_attempt(db, user_id, problem_id) + 1,
        status=SubmissionStatus.QUEUED.value,
        attempt_count=0,
        source="server",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await record_event(db, int(row.id), "queued", "Submission queued")
    await db.commit()
    await db.refresh(row)
    return serialize(row, await _events(db, int(row.id)))


async def get_submission(
    db: AsyncSession,
    user_id: int,
    submission_uuid: str,
    *,
    is_staff: bool = False,
) -> dict:
    row = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if row is None:
        raise SubmissionError("Submission not found", status_code=404, code="NOT_FOUND")
    if int(row.user_id) != int(user_id) and not is_staff:
        raise SubmissionError("Forbidden", status_code=403, code="FORBIDDEN")
    return serialize(row, await _events(db, int(row.id)))


async def list_submissions(
    db: AsyncSession,
    user_id: int,
    *,
    problem_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    cursor: int | None = None,
) -> list[dict]:
    statement = select(InformaticsSubmission).where(
        InformaticsSubmission.user_id == user_id
    )
    if problem_id is not None:
        statement = statement.where(InformaticsSubmission.problem_id == problem_id)
    if status:
        statement = statement.where(InformaticsSubmission.status == status)
    if cursor is not None:
        statement = statement.where(InformaticsSubmission.id < cursor)
    rows = (
        await db.execute(
            statement.order_by(InformaticsSubmission.id.desc()).limit(max(1, min(limit, 200)))
        )
    ).scalars().all()
    return [serialize(row) for row in rows]


async def retry_submission(
    db: AsyncSession, user_id: int, submission_uuid: str
) -> dict:
    original = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if original is None:
        raise SubmissionError("Submission not found", status_code=404, code="NOT_FOUND")
    if int(original.user_id) != int(user_id):
        raise SubmissionError("Forbidden", status_code=403, code="FORBIDDEN")

    active = await _active(db, user_id, original.problem_id)
    if active is not None:
        raise SubmissionError(
            "A submission for this problem is already running",
            status_code=409,
            code="ACTIVE_SUBMISSION_EXISTS",
            submission_uuid=active.submission_uuid,
        )

    now = _now()
    row = InformaticsSubmission(
        submission_uuid=_uuid(),
        client_request_id="",
        user_id=user_id,
        problem_id=original.problem_id,
        assignment_task_uuid=original.assignment_task_uuid,
        assignment_uuid=original.assignment_uuid,
        activity_uuid=original.activity_uuid,
        org_id=original.org_id,
        language_our_id=original.language_our_id,
        language_informatics_id=original.language_informatics_id,
        source_sha256=original.source_sha256,
        source_code=original.source_code,
        attempt_no=await _max_attempt(db, user_id, original.problem_id) + 1,
        status=SubmissionStatus.QUEUED.value,
        attempt_count=0,
        source="server",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await record_event(
        db, int(row.id), "queued", f"Retry of {submission_uuid}"
    )
    await db.commit()
    await db.refresh(row)
    return serialize(row, await _events(db, int(row.id)))


async def cancel_submission(
    db: AsyncSession, user_id: int, submission_uuid: str
) -> dict:
    row = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if row is None:
        raise SubmissionError("Submission not found", status_code=404, code="NOT_FOUND")
    if int(row.user_id) != int(user_id):
        raise SubmissionError("Forbidden", status_code=403, code="FORBIDDEN")
    if row.status not in (SubmissionStatus.QUEUED.value, SubmissionStatus.RETRY_WAIT.value):
        raise SubmissionError(
            "Only queued submissions can be cancelled",
            status_code=409,
            code="NOT_CANCELLABLE",
        )
    row.status = SubmissionStatus.CANCELED.value
    row.finished_at = _now()
    row.updated_at = _now()
    db.add(row)
    await record_event(db, int(row.id), "canceled", "Cancelled by the user")
    await db.commit()
    await db.refresh(row)
    return serialize(row, await _events(db, int(row.id)))


# ── Worker transitions ───────────────────────────────────────────────────────


async def recover_expired_leases(db: AsyncSession) -> int:
    """Return SUBMITTING rows whose worker died to the retry queue."""
    now = _now()
    rows = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.status == SubmissionStatus.SUBMITTING.value,
                InformaticsSubmission.lease_expires_at != "",
                InformaticsSubmission.lease_expires_at <= now,
            )
        )
    ).scalars().all()
    for row in rows:
        row.status = SubmissionStatus.RETRY_WAIT.value
        row.next_poll_at = now
        row.lease_owner = ""
        row.lease_expires_at = ""
        row.last_error = "Worker lease expired"
        row.updated_at = now
        db.add(row)
        await record_event(
            db,
            int(row.id),
            "recovered",
            "Worker lease expired; returned to the retry queue",
            level="warning",
        )
    if rows:
        await db.commit()
    return len(rows)


async def claim_next(
    db: AsyncSession, worker_id: str, *, lease_seconds: int = 120
) -> InformaticsSubmission | None:
    now = _now()
    statement = (
        select(InformaticsSubmission)
        .where(
            InformaticsSubmission.status.in_(
                (SubmissionStatus.QUEUED.value, SubmissionStatus.RETRY_WAIT.value)
            ),
            (InformaticsSubmission.next_poll_at == "")
            | (InformaticsSubmission.next_poll_at <= now),
        )
        .order_by(InformaticsSubmission.created_at.asc())
        .limit(1)
    )
    row = (await db.execute(statement)).scalars().first()
    if row is None:
        return None
    # Atomic claim: two workers can select the same row, but only one UPDATE
    # matches the old status and wins. The loser rolls back and tries again.
    result = await db.execute(
        update(InformaticsSubmission)
        .where(
            InformaticsSubmission.id == row.id,
            InformaticsSubmission.status.in_(
                (SubmissionStatus.QUEUED.value, SubmissionStatus.RETRY_WAIT.value)
            ),
        )
        .values(
            status=SubmissionStatus.SUBMITTING.value,
            lease_owner=worker_id[:128],
            lease_expires_at=_after(lease_seconds),
            attempt_count=InformaticsSubmission.attempt_count + 1,
            updated_at=now,
        )
    )
    if result.rowcount != 1:
        await db.rollback()
        return None
    await db.commit()
    await db.refresh(row)
    return row


async def claim_running(
    db: AsyncSession, worker_id: str, *, lease_seconds: int = 120
) -> InformaticsSubmission | None:
    now = _now()
    statement = (
        select(InformaticsSubmission)
        .where(
            InformaticsSubmission.status == SubmissionStatus.RUNNING.value,
            (InformaticsSubmission.next_poll_at == "")
            | (InformaticsSubmission.next_poll_at <= now),
            (InformaticsSubmission.lease_expires_at == "")
            | (InformaticsSubmission.lease_expires_at <= now)
            | (InformaticsSubmission.lease_owner == worker_id),
        )
        .order_by(InformaticsSubmission.next_poll_at.asc())
        .limit(1)
    )
    row = (await db.execute(statement)).scalars().first()
    if row is None:
        return None
    row.lease_owner = worker_id[:128]
    row.lease_expires_at = _after(lease_seconds)
    row.updated_at = now
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def mark_running(
    db: AsyncSession,
    row: InformaticsSubmission,
    run_id: int,
    *,
    poll_delay: int = 1,
    worker_id: str = "",
) -> None:
    row.status = SubmissionStatus.RUNNING.value
    row.run_id = int(run_id)
    row.next_poll_at = _after(poll_delay)
    row.lease_owner = worker_id[:128]
    row.lease_expires_at = _after(poll_delay + 30)
    row.updated_at = _now()
    db.add(row)
    await record_event(db, int(row.id), "submitting", f"run_id={run_id}")
    await db.commit()


async def schedule_poll(
    db: AsyncSession,
    row: InformaticsSubmission,
    delay_seconds: int,
    *,
    worker_id: str = "",
) -> None:
    delay = max(1, delay_seconds)
    row.status = SubmissionStatus.RUNNING.value
    row.next_poll_at = _after(delay)
    row.lease_owner = worker_id[:128]
    row.lease_expires_at = _after(delay + 30)
    row.updated_at = _now()
    db.add(row)
    await db.commit()


def _poll_delay(attempt_count: int) -> int:
    # 1, 2, 3, 5, 5, 10... seconds
    sequence = (1, 2, 3, 5, 5, 10)
    index = max(0, min(int(attempt_count or 1) - 1, len(sequence) - 1))
    return sequence[index]


async def finalize(
    db: AsyncSession,
    row: InformaticsSubmission,
    run: dict[str, Any],
) -> tuple[InformaticsSubmission, bool]:
    ejudge_status = run.get("ejudge_status")
    try:
        ejudge_status_int = int(ejudge_status) if ejudge_status is not None else None
    except (TypeError, ValueError):
        ejudge_status_int = None
    verdict = map_verdict(ejudge_status_int)
    solved = is_solved(ejudge_status_int)

    try:
        tests = int(run.get("ejudge_test_num") or 0)
    except (TypeError, ValueError):
        tests = 0
    try:
        score = int(run.get("ejudge_score") or 0)
    except (TypeError, ValueError):
        score = 0

    now = _now()
    row.status = SubmissionStatus.FINAL.value
    row.verdict = verdict.value
    row.ejudge_status = ejudge_status_int
    row.tests_passed = tests
    row.tests_total = tests
    row.tests = tests
    row.score = score
    row.max_score = 100 if solved or score else 0
    row.solved = solved
    row.raw_verdict = run
    row.finished_at = now
    row.next_poll_at = ""
    row.lease_owner = ""
    row.lease_expires_at = ""
    row.updated_at = now
    db.add(row)
    await record_event(
        db,
        int(row.id),
        "verdict",
        f"{verdict.value} (ejudge_status={ejudge_status_int})",
        payload={"run": run},
    )
    await db.commit()
    await db.refresh(row)
    return row, solved


async def fail_or_retry(
    db: AsyncSession, row: InformaticsSubmission, error: str, *, retryable: bool = True
) -> None:
    row.last_error = _truncate(error)
    row.updated_at = _now()
    attempts = int(row.attempt_count or 0)
    if not retryable or attempts >= MAX_ATTEMPTS:
        row.status = SubmissionStatus.FAILED.value
        row.finished_at = _now()
        row.next_poll_at = ""
        row.lease_owner = ""
        row.lease_expires_at = ""
        level = "error"
    else:
        row.status = SubmissionStatus.RETRY_WAIT.value
        row.next_poll_at = _after(min(60, 2 ** min(attempts, 5)))
        row.lease_owner = ""
        row.lease_expires_at = ""
        level = "warning"
    db.add(row)
    await record_event(db, int(row.id), "error", error, level=level)
    await db.commit()
