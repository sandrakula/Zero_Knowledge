"""Course curriculum authoring API: sections, modules, levels, prerequisites."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.users import APITokenUser, PublicUser
from src.security.auth import get_current_user
from src.security.rbac import AccessAction, check_resource_access
from src.services.practice.curriculum import (
    apply_course_curriculum,
    get_course_curriculum,
)
from src.services.practice.schemas import CurriculumUpdate

router = APIRouter()


async def _resolve_course(db_session: AsyncSession, course_uuid: str) -> Course:
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get(
    "/{course_uuid}/curriculum",
    summary="Read a course curriculum",
    description=(
        "Sections, modules, levels, prerequisite edges and the task bank of a "
        "course. Staff-only: the bank includes drafts, so it is not a learner "
        "endpoint. Task payloads never include tests or solutions."
    ),
    responses={
        200: {"description": "Curriculum topics, tasks and level statistics."},
        401: {"description": "Authentication required"},
        403: {"description": "No update access to this course"},
        404: {"description": "Course not found"},
    },
)
async def api_get_course_curriculum(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    course = await _resolve_course(db_session, course_uuid)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    return await get_course_curriculum(db_session, course)


@router.put(
    "/{course_uuid}/curriculum",
    summary="Update a course curriculum",
    description=(
        "Merge sections, modules, levels, prerequisites and per-task topic/level "
        "metadata. The prerequisite graph is validated for unknown references, "
        "duplicate topic keys and cycles before anything is written."
    ),
    responses={
        200: {"description": "The updated curriculum."},
        400: {"description": "Invalid curriculum update"},
        401: {"description": "Authentication required"},
        403: {"description": "No update access to this course"},
        404: {"description": "Course not found"},
    },
)
async def api_update_course_curriculum(
    request: Request,
    course_uuid: str,
    update: CurriculumUpdate,
    current_user: PublicUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    course = await _resolve_course(db_session, course_uuid)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    return await apply_course_curriculum(db_session, course, update)
