"""Informatics account binding, automatic verdict logging and server-side submissions.

Two paths coexist:

* the browser userscript posts verdicts to ``/informatics/ingest`` (no password,
  no cookie), and
* the official server-side path links an account, queues a submission and lets
  the background worker talk to informatics.msk.ru.

API tokens cannot manage an Informatics account or submit code.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Union

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.courses import Course
from src.db.informatics import (
    InformaticsProblem,
    InformaticsSubmission,
    SubmissionStatus,
)
from src.db.users import APITokenUser, PublicUser, SuperadminAPITokenUser
from src.security.auth import get_authenticated_user
from src.security.org_auth import is_org_admin
from src.security.rbac import authorization_verify_based_on_roles
from src.security.superadmin import is_user_superadmin
from src.services.informatics import ingest, links, requirements, submissions
from src.services.informatics.client import BASE_URL, InformaticsClient
from src.services.informatics.languages import supported_our_ids
from src.services.security.rate_limiting import check_rate_limit

router = APIRouter()

INGEST_MAX_PER_HOUR = 240
SUBMISSION_MAX_PER_HOUR = 30


class UsernameBody(BaseModel):
    username: str = Field(default="", max_length=200)
    informatics_user_id: int = Field(default=0, ge=0)


class LinkBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)
    email: str = Field(default="", max_length=320)


class SessionLinkBody(BaseModel):
    moodle_session: str = Field(min_length=8, max_length=4096)
    email: str = Field(default="", max_length=320)


class SubmissionCreateBody(BaseModel):
    problem_id: int = Field(ge=1, le=100_000_000)
    language_id: int = Field(ge=1, le=1_000_000)
    source_code: str = Field(default="", max_length=70_000)
    assignment_task_uuid: str = Field(default="", max_length=64)
    assignment_uuid: str = Field(default="", max_length=64)
    activity_uuid: str = Field(default="", max_length=64)
    client_request_id: str = Field(default="", max_length=64)


class IngestBody(BaseModel):
    problem_id: int = Field(ge=1, le=100_000_000)
    run_id: int = Field(ge=0, le=2_000_000_000)
    ejudge_status: int = Field(ge=0, le=1000)
    tests: int = Field(default=0, ge=0, le=10_000)
    score: int = Field(default=0, ge=0, le=10_000)
    source: str = Field(default="userscript", max_length=32)


def _require_user(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser],
) -> PublicUser:
    if not isinstance(current_user, PublicUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot manage the Informatics account",
        )
    return current_user


def _now() -> str:
    return datetime.now().isoformat()


# ── Account (userscript) ─────────────────────────────────────────────────────


@router.get(
    "/me",
    summary="Get the Informatics connection for the current user",
)
async def get_me(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    account = await ingest.get_account(db_session, int(user.id))
    solved = await ingest.solved_count(db_session, int(user.id))
    if account is None:
        return {
            "linked": False,
            "username": "",
            "informatics_user_id": 0,
            "token_created_at": "",
            "last_seen_at": "",
            "solved_count": solved,
        }
    return {
        "linked": bool(account.ingest_token_hash),
        "username": account.username,
        "informatics_user_id": account.informatics_user_id,
        "token_created_at": account.token_created_at,
        "last_seen_at": account.last_seen_at,
        "solved_count": solved,
    }


@router.patch(
    "/me",
    summary="Store the public Informatics username for this user",
)
async def update_me(
    body: UsernameBody,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    account = await ingest.set_username(
        db_session, int(user.id), body.username, body.informatics_user_id
    )
    return {
        "linked": bool(account.ingest_token_hash),
        "username": account.username,
        "informatics_user_id": account.informatics_user_id,
        "token_created_at": account.token_created_at,
        "last_seen_at": account.last_seen_at,
    }


@router.post(
    "/token",
    summary="Generate or rotate the personal ingest token",
    description=(
        "Returns the new token exactly once. The previous token stops working. "
        "The token is only used by the browser userscript to post verdicts."
    ),
)
async def create_token(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    account, token = await ingest.rotate_token(db_session, int(user.id))
    return {
        "token": token,
        "token_created_at": account.token_created_at,
    }


@router.delete(
    "/link",
    summary="Disconnect Informatics and revoke the ingest token",
)
async def unlink(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    await ingest.revoke(db_session, int(user.id))
    return {"linked": False}


# ── Account (server-side link) ───────────────────────────────────────────────


@router.get("/link", summary="Get the server-side Informatics link")
async def get_link(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    account = await ingest.get_account(db_session, int(user.id))
    return links.link_to_dict(account)


@router.post("/link", summary="Link an Informatics account with credentials")
async def create_link(
    body: LinkBody,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    try:
        account = await links.link_account(
            db_session, int(user.id), body.username, body.password, body.email
        )
    except links.LinkError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return links.link_to_dict(account)


@router.post(
    "/link/session",
    summary="Link a Google-only account with a MoodleSession cookie",
    description=(
        "For Informatics accounts created through Google there is no local "
        "password. The learner signs in on informatics.msk.ru, copies the "
        "MoodleSession cookie and posts it here. The cookie is validated, "
        "encrypted and never returned."
    ),
)
async def create_session_link(
    body: SessionLinkBody,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    try:
        account = await links.link_session(
            db_session, int(user.id), body.moodle_session, body.email
        )
    except links.LinkError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return links.link_to_dict(account)


@router.delete(
    "/link/server",
    summary="Forget the stored password and session cookie",
)
async def unlink_server(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    await links.unlink_server_account(db_session, int(user.id))
    account = await ingest.get_account(db_session, int(user.id))
    return links.link_to_dict(account)


@router.post("/link/verify", summary="Re-check the stored Informatics session")
async def verify_link(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    try:
        account = await links.verify_account(db_session, int(user.id))
    except links.LinkError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return links.link_to_dict(account)


# ── Verdict ingest (userscript) ──────────────────────────────────────────────


@router.post(
    "/ingest",
    summary="Record an Informatics verdict from the userscript",
    description=(
        "Authenticated by the personal X-Ingest-Token header, not a JWT. "
        "Idempotent by (user, run id); solved is derived from ejudge_status."
    ),
)
async def ingest_verdict(
    body: IngestBody,
    x_ingest_token: Optional[str] = Header(default=None, alias="X-Ingest-Token"),
    db_session: AsyncSession = Depends(get_db_session),
):
    if not x_ingest_token:
        raise HTTPException(status_code=401, detail="Missing ingest token")
    account = await ingest.get_account_by_token(db_session, x_ingest_token)
    if account is None:
        raise HTTPException(status_code=401, detail="Invalid ingest token")

    allowed, _count, retry_after = check_rate_limit(
        key=f"informatics_ingest:{account.user_id}",
        max_attempts=INGEST_MAX_PER_HOUR,
        window_seconds=3600,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many verdicts; try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    result = await ingest.record_submission(
        db_session,
        account,
        problem_id=body.problem_id,
        run_id=body.run_id,
        ejudge_status=body.ejudge_status,
        tests=body.tests,
        score=body.score,
        source=body.source,
    )
    return result


@router.post(
    "/ping",
    summary="Mark the userscript as installed for this token",
    description=(
        "Called by the userscript from informatics.msk.ru. Authenticated by the "
        "personal X-Ingest-Token, like ingest. Records liveness only, no verdict."
    ),
)
async def ping(
    x_ingest_token: Optional[str] = Header(default=None, alias="X-Ingest-Token"),
    db_session: AsyncSession = Depends(get_db_session),
):
    if not x_ingest_token:
        raise HTTPException(status_code=401, detail="Missing ingest token")
    account = await ingest.get_account_by_token(db_session, x_ingest_token)
    if account is None:
        raise HTTPException(status_code=401, detail="Invalid ingest token")
    seen = await ingest.touch_account(db_session, account)
    return {"ok": True, "last_seen_at": seen}


@router.get(
    "/requirement",
    summary="Whether a course requires the Informatics userscript",
)
async def get_requirement(
    course_uuid: str = Query(min_length=1, max_length=200),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return await requirements.get_requirement(db_session, int(user.id), course)


# ── Server-side submissions ──────────────────────────────────────────────────


@router.post(
    "/submissions",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a code submission for Informatics",
)
async def create_submission(
    body: SubmissionCreateBody,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    allowed, _count, retry_after = check_rate_limit(
        key=f"informatics_submit:{user.id}",
        max_attempts=SUBMISSION_MAX_PER_HOUR,
        window_seconds=3600,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many submissions; try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        result = await submissions.create_submission(
            db_session,
            user_id=int(user.id),
            problem_id=body.problem_id,
            language_id=body.language_id,
            source_code=body.source_code,
            assignment_task_uuid=body.assignment_task_uuid,
            assignment_uuid=body.assignment_uuid,
            activity_uuid=body.activity_uuid,
            client_request_id=body.client_request_id,
        )
    except submissions.SubmissionError as exc:
        detail = {"code": exc.code, "message": exc.message}
        if exc.submission_uuid:
            detail["submission_uuid"] = exc.submission_uuid
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc
    return result


@router.get("/submissions", summary="List the current user's attempts")
async def list_submissions(
    request: Request,
    problem_id: Optional[int] = Query(default=None, ge=1),
    submission_status: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[int] = Query(default=None, ge=1),
    user_id: Optional[int] = Query(default=None, ge=1),
    org_id: Optional[int] = Query(default=None, ge=1),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    target = int(user.id)
    if user_id is not None and int(user_id) != target:
        allowed = await is_user_superadmin(target, db_session)
        if not allowed and org_id is not None:
            allowed = await is_org_admin(target, int(org_id), db_session)
        if not allowed:
            raise HTTPException(status_code=403, detail="Forbidden")
        target = int(user_id)
    return await submissions.list_submissions(
        db_session,
        target,
        problem_id=problem_id,
        status=submission_status,
        limit=limit,
        cursor=cursor,
    )


async def _is_staff_for_row(
    request: Request, user: PublicUser, row: InformaticsSubmission, db
) -> bool:
    if await is_user_superadmin(int(user.id), db):
        return True
    if row.assignment_uuid:
        assignment = (
            await db.execute(
                select(Assignment).where(
                    Assignment.assignment_uuid == row.assignment_uuid
                )
            )
        ).scalars().first()
        if assignment is not None:
            course = (
                await db.execute(
                    select(Course).where(Course.id == assignment.course_id)
                )
            ).scalars().first()
            if course is not None:
                try:
                    return bool(
                        await authorization_verify_based_on_roles(
                            request,
                            int(user.id),
                            "update",
                            course.course_uuid,
                            db,
                        )
                    )
                except HTTPException:
                    return False
    if row.org_id:
        return await is_org_admin(int(user.id), int(row.org_id), db)
    return False


@router.get("/submissions/{submission_uuid}", summary="Get one submission and its events")
async def get_submission(
    submission_uuid: str,
    request: Request,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    row = (
        await db_session.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    staff = int(row.user_id) != int(user.id) and await _is_staff_for_row(
        request, user, row, db_session
    )
    try:
        return await submissions.get_submission(
            db_session,
            int(user.id),
            submission_uuid,
            is_staff=staff,
        )
    except submissions.SubmissionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/submissions/task/{assignment_task_uuid}",
    summary="Staff view of every attempt for one assignment task",
)
async def list_task_submissions(
    assignment_task_uuid: str,
    request: Request,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    task = (
        await db_session.execute(
            select(AssignmentTask).where(
                AssignmentTask.assignment_task_uuid == assignment_task_uuid
            )
        )
    ).scalars().first()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    assignment = (
        await db_session.execute(
            select(Assignment).where(Assignment.id == task.assignment_id)
        )
    ).scalars().first()
    course = (
        await db_session.execute(
            select(Course).where(Course.id == assignment.course_id)
        )
    ).scalars().first() if assignment is not None else None
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        allowed = bool(
            await authorization_verify_based_on_roles(
                request, int(user.id), "update", course.course_uuid, db_session
            )
        )
    except HTTPException:
        allowed = False
    if not allowed:
        raise HTTPException(status_code=403, detail="Forbidden")

    rows = (
        await db_session.execute(
            select(InformaticsSubmission)
            .where(InformaticsSubmission.assignment_task_uuid == assignment_task_uuid)
            .order_by(InformaticsSubmission.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    return [submissions.serialize(row) for row in rows]


@router.post(
    "/submissions/{submission_uuid}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Retry an attempt as a new submission",
)
async def retry_submission(
    submission_uuid: str,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    try:
        return await submissions.retry_submission(
            db_session, int(user.id), submission_uuid
        )
    except submissions.SubmissionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/submissions/{submission_uuid}/cancel",
    summary="Cancel a queued attempt",
)
async def cancel_submission(
    submission_uuid: str,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    try:
        return await submissions.cancel_submission(
            db_session, int(user.id), submission_uuid
        )
    except submissions.SubmissionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


# ── Problem catalog ─────────────────────────────────────────────────────────


async def _refresh_problem(db, problem_id: int) -> dict:
    async with InformaticsClient() as client:
        data = await client.get_problem(problem_id)
    row = await db.get(InformaticsProblem, problem_id)
    if row is None:
        row = InformaticsProblem(problem_id=problem_id)
    row.title = data.get("title") or ""
    row.statement_md = data.get("statement_md") or ""
    row.languages = data.get("languages") or []
    row.time_limit_ms = int(data.get("time_limit_ms") or 0)
    row.memory_limit_kb = int(data.get("memory_limit_kb") or 0)
    row.raw = data.get("raw") or {}
    row.fetched_at = _now()
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {
        "problem_id": row.problem_id,
        "title": row.title,
        "languages": row.languages or [],
        "supported_language_ids": supported_our_ids(row.languages or []),
        "time_limit_ms": row.time_limit_ms,
        "memory_limit_kb": row.memory_limit_kb,
        "fetched_at": row.fetched_at,
    }


@router.get("/problems/{problem_id}", summary="Informatics problem metadata")
async def get_problem(
    problem_id: int,
    refresh: bool = Query(default=False),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    _require_user(current_user)
    row = await db_session.get(InformaticsProblem, problem_id)
    if refresh or row is None:
        try:
            return await _refresh_problem(db_session, problem_id)
        except Exception as exc:
            raise HTTPException(
                status_code=503, detail=f"Could not load the problem: {exc}"
            ) from exc
    return {
        "problem_id": row.problem_id,
        "title": row.title,
        "languages": row.languages or [],
        "supported_language_ids": supported_our_ids(row.languages or []),
        "time_limit_ms": row.time_limit_ms,
        "memory_limit_kb": row.memory_limit_kb,
        "fetched_at": row.fetched_at,
    }


@router.get("/problems/{problem_id}/languages", summary="Problem language list")
async def get_problem_languages(
    problem_id: int,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    _require_user(current_user)
    row = await db_session.get(InformaticsProblem, problem_id)
    if row is None:
        try:
            data = await _refresh_problem(db_session, problem_id)
            return {
                "languages": data["languages"],
                "supported_language_ids": data["supported_language_ids"],
            }
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "languages": row.languages or [],
        "supported_language_ids": supported_our_ids(row.languages or []),
    }


@router.post(
    "/problems/{problem_id}/refresh",
    summary="Refresh the cached problem metadata",
)
async def refresh_problem(
    problem_id: int,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    _require_user(current_user)
    try:
        return await _refresh_problem(db_session, problem_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ── Health / admin ──────────────────────────────────────────────────────────


@router.get(
    "/results",
    summary="List the current user's recent Informatics verdicts",
)
async def list_results(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    rows = await ingest.list_results(db_session, int(user.id), limit=limit)
    return [
        {
            "problem_id": row.problem_id,
            "run_id": row.run_id,
            "ejudge_status": row.ejudge_status,
            "tests": row.tests,
            "score": row.score,
            "solved": row.solved,
            "source": row.source,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


@router.get(
    "/results/assignment/{assignment_uuid}",
    summary="Informatics verdicts for the tasks of one assignment",
)
async def results_for_assignment(
    assignment_uuid: str,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    return await ingest.results_for_assignment(
        db_session, int(user.id), assignment_uuid
    )


@router.get(
    "/results/by-problem",
    summary="Solved state for a set of problem ids",
)
async def results_by_problem(
    problem_ids: str = Query(default="", max_length=2000),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    ids: list[int] = []
    for part in problem_ids.split(","):
        part = part.strip()
        if part.isdigit():
            ids.append(int(part))
    return await ingest.results_for_problems(db_session, int(user.id), ids[:200])


@router.get("/statistics", summary="Informatics statistics from the LMS database")
async def statistics(
    org_id: Optional[int] = Query(default=None, ge=1),
    user_id: Optional[int] = Query(default=None, ge=1),
    period: str = Query(default="all", pattern="^(week|month|all)$"),
    course_uuid: Optional[str] = Query(default=None, max_length=200),
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    target_user = int(user.id)
    staff = False
    if user_id is not None and int(user_id) != target_user:
        staff = await is_user_superadmin(target_user, db_session)
        if not staff and org_id is not None:
            staff = await is_org_admin(target_user, int(org_id), db_session)
        if not staff:
            raise HTTPException(status_code=403, detail="Forbidden")
        target_user = int(user_id)
    elif org_id is not None:
        staff = await is_user_superadmin(target_user, db_session) or await is_org_admin(
            target_user, int(org_id), db_session
        )
        if not staff:
            raise HTTPException(status_code=403, detail="Forbidden")

    conditions = [InformaticsSubmission.org_id == org_id] if org_id is not None and staff else []
    if not (org_id is not None and staff and user_id is None):
        conditions.append(InformaticsSubmission.user_id == target_user)
    if period in ("week", "month"):
        days = 7 if period == "week" else 30
        conditions.append(
            InformaticsSubmission.created_at
            >= (datetime.now() - timedelta(days=days)).isoformat()
        )
    if course_uuid:
        course = (
            await db_session.execute(
                select(Course).where(Course.course_uuid == course_uuid)
            )
        ).scalars().first()
        if course is not None:
            assignment_uuids = select(Assignment.assignment_uuid).where(
                Assignment.course_id == course.id
            )
            conditions.append(
                InformaticsSubmission.assignment_uuid.in_(assignment_uuids)
            )

    def apply(statement):
        return statement.where(*conditions) if conditions else statement

    total = int(
        (
            await db_session.execute(
                apply(select(func.count()).select_from(InformaticsSubmission))
            )
        ).scalar_one()
    )
    solved = int(
        (
            await db_session.execute(
                apply(
                    select(
                        func.count(
                            func.distinct(InformaticsSubmission.problem_id)
                        )
                    ).select_from(InformaticsSubmission).where(
                        InformaticsSubmission.solved.is_(True)
                    )
                )
            )
        ).scalar_one()
    )
    accepted = int(
        (
            await db_session.execute(
                apply(
                    select(func.count())
                    .select_from(InformaticsSubmission)
                    .where(InformaticsSubmission.verdict == "ACCEPTED")
                )
            )
        ).scalar_one()
    )
    final = int(
        (
            await db_session.execute(
                apply(
                    select(func.count())
                    .select_from(InformaticsSubmission)
                    .where(InformaticsSubmission.status == SubmissionStatus.FINAL.value)
                )
            )
        ).scalar_one()
    )
    avg_score = (
        await db_session.execute(
            apply(
                select(func.avg(InformaticsSubmission.score)).where(
                    InformaticsSubmission.status == SubmissionStatus.FINAL.value
                )
            )
        )
    ).scalar_one_or_none()
    last_activity = (
        await db_session.execute(apply(select(func.max(InformaticsSubmission.updated_at))))
    ).scalar_one_or_none()

    verdict_rows = (
        await db_session.execute(
            apply(
                select(InformaticsSubmission.verdict, func.count())
                .group_by(InformaticsSubmission.verdict)
            )
        )
    ).all()
    language_rows = (
        await db_session.execute(
            apply(
                select(InformaticsSubmission.language_our_id, func.count())
                .group_by(InformaticsSubmission.language_our_id)
            )
        )
    ).all()

    return {
        "user_id": target_user if user_id is not None or not staff else None,
        "org_id": org_id,
        "period": period,
        "course_uuid": course_uuid,
        "total_attempts": total,
        "solved_problems": solved,
        "accepted_attempts": accepted,
        "final_attempts": final,
        "average_score": round(float(avg_score), 2) if avg_score is not None else None,
        "last_activity": last_activity or "",
        "by_verdict": {
            (verdict or "UNKNOWN"): int(count) for verdict, count in verdict_rows
        },
        "by_language": {
            str(language_id): int(count) for language_id, count in language_rows
        },
    }


@router.get("/health", summary="Informatics queue health (admin only)")
async def health(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, SuperadminAPITokenUser):
        allowed = True
    elif isinstance(current_user, PublicUser):
        allowed = await is_user_superadmin(int(current_user.id), db_session)
    else:
        allowed = False
    if not allowed:
        raise HTTPException(status_code=403, detail="Forbidden")
    queue_depth = int(
        (
            await db_session.execute(
                select(func.count())
                .select_from(InformaticsSubmission)
                .where(
                    InformaticsSubmission.status.in_(
                        (
                            SubmissionStatus.QUEUED.value,
                            SubmissionStatus.RETRY_WAIT.value,
                        )
                    )
                )
            )
        ).scalar_one()
    )
    running = int(
        (
            await db_session.execute(
                select(func.count())
                .select_from(InformaticsSubmission)
                .where(InformaticsSubmission.status == SubmissionStatus.RUNNING.value)
            )
        ).scalar_one()
    )
    oldest = (
        await db_session.execute(
            select(func.min(InformaticsSubmission.created_at)).where(
                InformaticsSubmission.status == SubmissionStatus.QUEUED.value
            )
        )
    ).scalar_one_or_none()
    oldest_age = 0
    if oldest:
        try:
            oldest_age = max(
                0,
                int(
                    (datetime.now() - datetime.fromisoformat(oldest)).total_seconds()
                ),
            )
        except ValueError:
            oldest_age = 0
    since = (datetime.now() - timedelta(hours=24)).isoformat()
    failed_24h = int(
        (
            await db_session.execute(
                select(func.count())
                .select_from(InformaticsSubmission)
                .where(
                    InformaticsSubmission.status == SubmissionStatus.FAILED.value,
                    InformaticsSubmission.updated_at >= since,
                )
            )
        ).scalar_one()
    )
    last_error = (
        await db_session.execute(
            select(InformaticsSubmission.last_error)
            .where(InformaticsSubmission.last_error != "")
            .order_by(InformaticsSubmission.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    informatics_ok = True
    import os

    if os.environ.get("TESTING") != "true":
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                response = await client.get(BASE_URL)
                informatics_ok = response.status_code < 500
        except Exception:
            informatics_ok = False

    return {
        "ok": informatics_ok and running < 1000,
        "queue_depth": queue_depth,
        "oldest_queued_age_s": oldest_age,
        "running": running,
        "failed_24h": failed_24h,
        "informatics_ok": informatics_ok,
        "workers": 1,
        "last_error": last_error or None,
    }


@router.post("/admin/requeue/{submission_uuid}", summary="Requeue a submission")
async def admin_requeue(
    submission_uuid: str,
    request: Request,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    row = (
        await db_session.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not await _is_staff_for_row(request, user, row, db_session):
        raise HTTPException(status_code=403, detail="Forbidden")
    if row.status in (
        SubmissionStatus.QUEUED.value,
        SubmissionStatus.SUBMITTING.value,
        SubmissionStatus.RUNNING.value,
    ):
        raise HTTPException(status_code=409, detail="Submission is already active")
    row.status = SubmissionStatus.QUEUED.value
    row.next_poll_at = ""
    row.lease_owner = ""
    row.lease_expires_at = ""
    row.attempt_count = 0
    row.last_error = ""
    row.finished_at = ""
    row.updated_at = _now()
    db_session.add(row)
    await submissions.record_event(
        db_session, int(row.id), "requeued", "Requeued by staff"
    )
    await db_session.commit()
    return {"submission_uuid": row.submission_uuid, "status": row.status}


@router.post("/admin/reconcile/{submission_uuid}", summary="Poll a run again")
async def admin_reconcile(
    submission_uuid: str,
    request: Request,
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser] = Depends(
        get_authenticated_user
    ),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_user(current_user)
    row = (
        await db_session.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.submission_uuid == submission_uuid
            )
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not await _is_staff_for_row(request, user, row, db_session):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not row.run_id:
        raise HTTPException(status_code=409, detail="Submission has no run id")
    row.status = SubmissionStatus.RUNNING.value
    row.next_poll_at = ""
    row.lease_owner = ""
    row.lease_expires_at = ""
    row.updated_at = _now()
    db_session.add(row)
    await submissions.record_event(
        db_session, int(row.id), "reconcile", "Polling requested by staff"
    )
    await db_session.commit()
    return {"submission_uuid": row.submission_uuid, "status": row.status}
