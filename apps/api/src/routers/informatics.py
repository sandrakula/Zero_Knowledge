"""Informatics judge integration endpoints.

Account binding (link / status / unlink) and proxy submission: a learner writes
code here, we submit it to Informatics under their bound account, and return the
Informatics verdict (status + tests passed + score).
"""

from __future__ import annotations

from typing import Union

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import APITokenUser, PublicUser
from src.security.auth import get_authenticated_user
from src.services.informatics import links, progress, statistics

router = APIRouter()


class LinkRequest(BaseModel):
    session_cookie: str = Field(max_length=512)


class SubmitRequest(BaseModel):
    problem_id: int
    language_id: int = Field(ge=1, le=1000)
    source_code: str = Field(max_length=64 * 1024)


def _require_learner(current_user: Union[PublicUser, APITokenUser]) -> PublicUser:
    if isinstance(current_user, APITokenUser):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="API tokens cannot use Informatics submission")
    return current_user


@router.get("/link", summary="Get Informatics binding status")
async def get_link_status(
    request: Request,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    return await links.get_link_status(int(user.id), db_session)


@router.post("/link", summary="Link an Informatics account")
async def link_account(
    request: Request,
    body: LinkRequest,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    return await links.link_account(user, body.session_cookie, db_session)


@router.delete("/link", summary="Unlink the Informatics account")
async def unlink_account(
    request: Request,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    await links.unlink_account(int(user.id), db_session)
    return {"linked": False}


@router.post("/submit", summary="Submit code to Informatics and return the verdict")
async def submit_to_informatics(
    request: Request,
    body: SubmitRequest,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    return await links.submit_and_grade(
        user, body.problem_id, body.language_id, body.source_code, db_session
    )


@router.get("/statistics", summary="Progress statistics (leaderboard + by category)")
async def get_statistics(
    request: Request,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await statistics.get_statistics(db_session)


@router.get("/my-dashboard", summary="The current learner's personal statistics")
async def get_my_dashboard(
    request: Request,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    return await statistics.get_my_dashboard(int(user.id), db_session)


class AttendanceRequest(BaseModel):
    pass


@router.post("/attendance", summary="Record the current user's attendance for today")
async def record_attendance(
    request: Request,
    body: AttendanceRequest,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _require_learner(current_user)
    return await progress.record_attendance(int(user.id), db_session)


class DeadlineRequest(BaseModel):
    category: str = Field(max_length=64)
    deadline: Optional[str] = None
    note: str = Field(default="")


@router.get("/deadlines", summary="List category deadlines")
async def list_deadlines(
    request: Request,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await progress.list_deadlines(db_session)


@router.post("/deadlines", summary="Set a category deadline")
async def set_deadline(
    request: Request,
    body: DeadlineRequest,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await progress.set_deadline(body.category, body.deadline, body.note, db_session)


class CompletionRequest(BaseModel):
    user_id: int
    category: str = Field(max_length=64)
    validation_status: Optional[str] = None
    checked_by: Optional[str] = None
    dosdacha: bool = False


@router.post("/completion", summary="Set a student's category validation (checked by, досдача)")
async def set_completion(
    request: Request,
    body: CompletionRequest,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await progress.set_completion(
        body.user_id, body.category, body.validation_status, body.checked_by, body.dosdacha, db_session
    )
