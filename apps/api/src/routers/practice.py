"""Adaptive practice API: today's feed and the learner's mastery state."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.users import APITokenUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import enforce_org_mfa, is_org_member, require_org_admin
from src.security.rbac import AccessAction, check_resource_access
from src.services.practice import bank, state
from src.services.practice.schemas import BankTasksUpdate

router = APIRouter()


async def _resolve_course(db: AsyncSession, course_uuid: str) -> Course:
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db.execute(statement)).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


async def _require_member(
    db: AsyncSession, current_user: PublicUser | APITokenUser, course: Course
) -> int:
    user_id = resolve_acting_user_id(current_user)
    if not await is_org_member(user_id, course.org_id, db):
        raise HTTPException(
            status_code=403, detail="User is not a member of this organization"
        )
    await enforce_org_mfa(user_id, course.org_id, db)
    return user_id


async def _can_update(
    request: Request,
    db: AsyncSession,
    current_user: PublicUser | APITokenUser,
    course: Course,
) -> bool:
    decision = await check_resource_access(
        request,
        db,
        current_user,
        course.course_uuid,
        AccessAction.UPDATE,
        raise_on_deny=False,
    )
    return bool(decision.allowed)


@router.get(
    "/today",
    summary="Today's adaptive practice feed",
    description=(
        "Pick the next tasks for a learner from one course. The feed mixes weak "
        "topics, due reviews and a small stretch above the current level, and "
        "returns the reason for every pick. Task tests and solutions are never "
        "included."
    ),
    responses={
        200: {"description": "Feed items with mastery, reason and expected success."},
        401: {"description": "Authentication required"},
        403: {"description": "Not a member of this organization or no course access"},
        404: {"description": "Course not found"},
    },
)
async def api_practice_today(
    request: Request,
    course_uuid: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(10, ge=1, le=30),
    strict_prereq: bool = Query(True),
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    course = await _resolve_course(db_session, course_uuid)
    user_id = await _require_member(db_session, current_user, course)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    include_unpublished = await _can_update(
        request, db_session, current_user, course
    )
    return await state.build_today(
        db_session,
        course=course,
        user_id=user_id,
        org_id=course.org_id,
        limit=limit,
        include_unpublished=include_unpublished,
        strict_prereq=strict_prereq,
    )


@router.get(
    "/state",
    summary="Learner mastery state for a course",
    description=(
        "Projected mastery per topic, review dates, attempt counts, active days "
        "and the current streak."
    ),
    responses={
        200: {"description": "Mastery state and summary."},
        401: {"description": "Authentication required"},
        403: {"description": "Not a member of this organization or no course access"},
        404: {"description": "Course not found"},
    },
)
async def api_practice_state(
    request: Request,
    course_uuid: str = Query(..., min_length=1, max_length=100),
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    course = await _resolve_course(db_session, course_uuid)
    user_id = await _require_member(db_session, current_user, course)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    return await state.get_state(
        db_session,
        course=course,
        user_id=user_id,
        org_id=course.org_id,
    )


@router.get(
    "/bank",
    summary="Organization-wide task bank",
    description=(
        "Staff view of every task in the organization with course, topic, level, "
        "type and publication state. Supports filters and pagination. Test cases "
        "and solutions are never included."
    ),
    responses={
        200: {"description": "Task bank page with facets."},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization admins and maintainers"},
    },
)
async def api_practice_bank(
    org_id: int = Query(..., ge=1),
    course_uuid: str | None = Query(None, max_length=100),
    level: int | None = Query(None, ge=1, le=3),
    assignment_type: str | None = Query(None, max_length=32),
    topic_key: str | None = Query(None, max_length=128),
    q: str | None = Query(None, max_length=200),
    only_unleveled: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)
    return await bank.list_bank(
        db_session,
        org_id=org_id,
        course_uuid=course_uuid,
        level=level,
        assignment_type=assignment_type,
        topic_key=topic_key,
        query=q,
        only_unleveled=only_unleveled,
        page=page,
        limit=limit,
    )


@router.put(
    "/bank/tasks",
    summary="Update task metadata from the bank",
    description=(
        "Set topic, level or estimated minutes on up to 500 tasks. Only tasks "
        "of the given organization are touched."
    ),
    responses={
        200: {"description": "How many tasks were updated."},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization admins and maintainers"},
    },
)
async def api_update_practice_bank(
    body: BankTasksUpdate,
    org_id: int = Query(..., ge=1),
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)
    return await bank.update_bank_tasks(
        db_session,
        org_id=org_id,
        updates=[item.model_dump() for item in body.tasks],
    )
