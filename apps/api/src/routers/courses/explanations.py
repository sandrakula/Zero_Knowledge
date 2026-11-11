"""Learner explanations for CODE tasks and their AI assessment."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.courses.activities.explanations import (
    read_my_task_explanation,
    read_task_explanation_for_user,
    submit_task_explanation,
)

router = APIRouter()


class TaskExplanationSubmit(BaseModel):
    explanation: str = Field(min_length=1, max_length=5000)
    input_mode: Literal["text", "voice"] = "text"
    source_code: str = Field(default="", max_length=20000)
    language_id: int | None = None


@router.post(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/explanation",
    summary="Assess a learner's explanation of their CODE solution",
    description="Stores the learner's written or dictated explanation, asks the configured AI model to grade understanding of the submitted code, and returns a 0-100 score with feedback.",
    responses={
        200: {"description": "Explanation stored and assessed."},
        400: {"description": "Not a CODE task, or the explanation/code is too short."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks access, AI is disabled, or credits are exhausted"},
        404: {"description": "Assignment or task not found"},
        503: {"description": "The AI provider is unavailable"},
    },
)
async def api_submit_task_explanation(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    body: TaskExplanationSubmit,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await submit_task_explanation(
        request,
        assignment_uuid,
        assignment_task_uuid,
        explanation=body.explanation,
        input_mode=body.input_mode,
        source_code=body.source_code,
        language_id=body.language_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.get(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/explanation/me",
    summary="Read the current learner's explanation",
    description="The signing-in learner's latest explanation and AI assessment for one CODE task, or null when none exists.",
    responses={
        200: {"description": "Explanation or null."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Assignment or task not found"},
    },
)
async def api_read_my_task_explanation(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await read_my_task_explanation(
        request,
        assignment_uuid,
        assignment_task_uuid,
        current_user,
        db_session,
    )


@router.get(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/explanation",
    summary="Read a learner's explanation (instructor)",
    description="Instructor view of one learner's explanation and AI assessment for a CODE task.",
    responses={
        200: {"description": "Explanation or null."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to grade this assignment"},
        404: {"description": "Assignment or task not found"},
    },
)
async def api_read_task_explanation_for_user(
    request: Request,
    assignment_uuid: str,
    assignment_task_uuid: str,
    user_id: int = Query(...),
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await read_task_explanation_for_user(
        request,
        assignment_uuid,
        assignment_task_uuid,
        user_id,
        current_user,
        db_session,
    )
