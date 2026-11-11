"""Read and write learner explanations for CODE tasks."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
)
from src.db.courses.courses import Course
from src.db.courses.task_explanations import TaskExplanation
from src.db.organization_config import OrganizationConfig
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
from src.security.rbac import AccessAction
from src.services.ai.explanations import assess_explanation
from src.services.ai.llm import resolve_model_for_org
from src.services.courses.activities.assignments import authorize_assignment_access
from src.services.security.rate_limiting import enforce_ai_rate_limit

logger = logging.getLogger(__name__)

MIN_EXPLANATION_CHARS = 20
MAX_EXPLANATION_CHARS = 5000
MAX_SOURCE_CODE_CHARS = 20000
VALID_INPUT_MODES = {"text", "voice"}


def _block_api_tokens(current_user: PublicUser | AnonymousUser | APITokenUser) -> None:
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot submit task explanations. Only user authentication is allowed.",
        )


async def _context(
    assignment_uuid: str, assignment_task_uuid: str, db_session: AsyncSession
) -> tuple[AssignmentTask, Assignment, Course]:
    task = (
        await db_session.execute(
            select(AssignmentTask).where(
                AssignmentTask.assignment_task_uuid == assignment_task_uuid
            )
        )
    ).scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Assignment Task not found")
    assignment = (
        await db_session.execute(
            select(Assignment).where(
                Assignment.assignment_uuid == assignment_uuid,
                Assignment.id == task.assignment_id,
            )
        )
    ).scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    course = (
        await db_session.execute(select(Course).where(Course.id == assignment.course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return task, assignment, course


def _read(row: TaskExplanation | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "explanation_uuid": row.explanation_uuid,
        "explanation_text": row.explanation_text,
        "input_mode": row.input_mode,
        "source_code": row.source_code,
        "language_id": row.language_id,
        "ai_score": row.ai_score,
        "ai_level": row.ai_level,
        "ai_feedback": row.ai_feedback,
        "ai_strengths": row.ai_strengths or [],
        "ai_gaps": row.ai_gaps or [],
        "ai_model": row.ai_model,
        "status": row.status,
        "attempt_count": row.attempt_count,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def _stored_source_code(
    db_session: AsyncSession, task_id: int, user_id: int
) -> tuple[str, int | None]:
    submission = (
        await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.assignment_task_id == task_id,
                AssignmentTaskSubmission.user_id == user_id,
            )
        )
    ).scalars().first()
    data = (submission.task_submission if submission else None) or {}
    return str(data.get("source_code") or ""), data.get("language_id")


def _require_ai_enabled(org_config: OrganizationConfig | None, org_id: int) -> None:
    from src.security.features_utils.resolve import resolve_feature

    if not org_config or not org_config.config:
        return
    try:
        enabled = resolve_feature("ai", org_config.config, org_id)["enabled"]
    except Exception:
        logger.warning("Could not resolve the AI feature for org %s", org_id, exc_info=True)
        return
    if not enabled:
        raise HTTPException(
            status_code=403, detail="AI features are disabled for this organization"
        )


async def submit_task_explanation(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    *,
    explanation: str,
    input_mode: str,
    source_code: str,
    language_id: int | None,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> dict[str, Any]:
    _block_api_tokens(current_user)
    user_id = int(current_user.id or 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    task, assignment, course = await _context(
        assignment_uuid, assignment_task_uuid, db_session
    )
    await authorize_assignment_access(
        request,
        db_session,
        current_user,
        course.course_uuid,
        AccessAction.READ,
        activity_id=assignment.activity_id,
    )
    if task.assignment_type != AssignmentTaskTypeEnum.CODE:
        raise HTTPException(
            status_code=400, detail="Explanations are only available for CODE tasks"
        )

    text = (explanation or "").strip()
    if len(text) < MIN_EXPLANATION_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Explanation must contain at least {MIN_EXPLANATION_CHARS} characters",
        )
    if len(text) > MAX_EXPLANATION_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Explanation must not exceed {MAX_EXPLANATION_CHARS} characters",
        )
    mode = input_mode if input_mode in VALID_INPUT_MODES else "text"

    code = (source_code or "").strip()[:MAX_SOURCE_CODE_CHARS]
    resolved_language_id = language_id
    if not code:
        code, stored_language_id = await _stored_source_code(
            db_session, int(task.id or 0), user_id
        )
        code = code[:MAX_SOURCE_CODE_CHARS]
        resolved_language_id = resolved_language_id or stored_language_id
    if not code:
        raise HTTPException(
            status_code=400, detail="No source code to explain for this task yet"
        )

    org_config = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == course.org_id)
        )
    ).scalars().first()
    _require_ai_enabled(org_config, course.org_id)

    enforce_ai_rate_limit(user_id, course.org_id)
    await reserve_ai_credit(course.org_id, db_session, amount=1)
    try:
        model_name = await resolve_model_for_org(
            course.org_id, db_session, purpose="chat"
        )
        assessment = await assess_explanation(
            task_title=task.title,
            task_description=task.description,
            task_hint=task.hint,
            contents=task.contents or {},
            source_code=code,
            explanation=text,
            model_name=model_name,
        )
    except HTTPException:
        refund_ai_credit(course.org_id, 1)
        raise
    except Exception:
        refund_ai_credit(course.org_id, 1)
        logger.exception("Explanation assessment failed for task %s", task.id)
        raise HTTPException(
            status_code=503, detail="AI assessment is temporarily unavailable"
        )

    now = str(datetime.now())
    row = (
        await db_session.execute(
            select(TaskExplanation).where(
                TaskExplanation.assignment_task_id == task.id,
                TaskExplanation.user_id == user_id,
            )
        )
    ).scalars().first()
    if row is None:
        row = TaskExplanation(
            explanation_uuid=f"taskexplanation_{uuid4()}",
            org_id=course.org_id,
            course_id=assignment.course_id,
            assignment_id=assignment.id,
            assignment_task_id=int(task.id or 0),
            user_id=user_id,
            created_at=now,
            attempt_count=1,
        )
    else:
        row.attempt_count = int(row.attempt_count or 0) + 1
    row.explanation_text = text
    row.input_mode = mode
    row.source_code = code
    row.language_id = resolved_language_id
    row.ai_score = assessment["score"]
    row.ai_level = assessment["level"]
    row.ai_feedback = assessment["feedback"]
    row.ai_strengths = assessment["strengths"]
    row.ai_gaps = assessment["gaps"]
    row.ai_model = model_name
    row.status = "GRADED"
    row.updated_at = now
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    result = _read(row)
    assert result is not None
    return result


async def read_my_task_explanation(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> dict[str, Any] | None:
    _block_api_tokens(current_user)
    user_id = int(current_user.id or 0)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    task, assignment, course = await _context(
        assignment_uuid, assignment_task_uuid, db_session
    )
    await authorize_assignment_access(
        request,
        db_session,
        current_user,
        course.course_uuid,
        AccessAction.READ,
        activity_id=assignment.activity_id,
    )
    row = (
        await db_session.execute(
            select(TaskExplanation).where(
                TaskExplanation.assignment_task_id == task.id,
                TaskExplanation.user_id == user_id,
            )
        )
    ).scalars().first()
    return _read(row)


async def read_task_explanation_for_user(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> dict[str, Any] | None:
    task, _assignment, course = await _context(
        assignment_uuid, assignment_task_uuid, db_session
    )
    await authorize_assignment_access(
        request,
        db_session,
        current_user,
        course.course_uuid,
        AccessAction.UPDATE,
        token_action="read",
    )
    row = (
        await db_session.execute(
            select(TaskExplanation).where(
                TaskExplanation.assignment_task_id == task.id,
                TaskExplanation.user_id == user_id,
            )
        )
    ).scalars().first()
    return _read(row)


async def explanation_text_for_user(
    db_session: AsyncSession, task_id: int, user_id: int
) -> str | None:
    row = (
        await db_session.execute(
            select(TaskExplanation).where(
                TaskExplanation.assignment_task_id == task_id,
                TaskExplanation.user_id == user_id,
            )
        )
    ).scalars().first()
    return row.explanation_text if row else None
