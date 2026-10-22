"""Roadmap import/generation, the roadmap assistant, and lesson feedback."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.roadmaps import (
    FeedbackStatus,
    LessonFeedback,
    LessonFeedbackRead,
    LessonFeedbackUpsert,
    RoadmapImportJob,
    RoadmapItemState,
    RoadmapJobStatus,
)
from src.db.users import APITokenUser, PublicUser, User
from src.core.events.database import get_db_session
from src.security.auth import (
    get_authenticated_user,
    resolve_acting_user_id,
)
from src.security.features_utils.usage import (
    check_limits_with_usage,
    refund_ai_credit,
    reserve_ai_credit,
)
from src.security.org_auth import (
    enforce_org_mfa,
    is_org_member,
    require_org_create_permission,
)
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.llm import resolve_model_for_org
from src.services.ai.rag.access import can_read_activity
from src.services.roadmap.assistant import (
    apply_operation,
    ask_roadmap_assistant,
)
from src.services.roadmap.generation import run_import_job
from src.services.roadmap.importer import import_roadmap
from src.services.roadmap.schema import (
    AppliedOperation,
    ApplyRoadmapOperationsRequest,
    ApplyRoadmapOperationsResponse,
    ImportRoadmapRequest,
    RoadmapAssistantRequest,
    RoadmapAssistantResponse,
    RoadmapImportResponse,
)
from src.services.roadmap.tasks import valid_tasks

logger = logging.getLogger(__name__)

router = APIRouter()

_background_tasks: set[asyncio.Task] = set()


class FeedbackUpdateRequest(BaseModel):
    content: Optional[str] = Field(default=None, max_length=5000)
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    status: Optional[FeedbackStatus] = None


def _launch_job(job_uuid: str) -> None:
    task = asyncio.create_task(run_import_job(job_uuid))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _require_human(user: PublicUser) -> None:
    if isinstance(user, APITokenUser):
        raise HTTPException(
            status_code=403, detail="API tokens cannot post lesson feedback"
        )


async def _load_org(org_id: int, db: AsyncSession) -> Organization:
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _require_member(user: PublicUser, org_id: int, db: AsyncSession) -> None:
    if not await is_org_member(user.id, org_id, db):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    await enforce_org_mfa(user.id, org_id, db)


async def _load_course_for_update(
    request: Request,
    course_uuid: str,
    user: PublicUser,
    db: AsyncSession,
) -> Course:
    course = (
        await db.execute(select(Course).where(Course.course_uuid == course_uuid))
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await _require_member(user, course.org_id, db)
    await check_resource_access(
        request, db, user, course.course_uuid, AccessAction.UPDATE
    )
    return course


async def _load_course_for_read(
    request: Request,
    course_uuid: str,
    user: PublicUser,
    db: AsyncSession,
) -> Course:
    course = (
        await db.execute(select(Course).where(Course.course_uuid == course_uuid))
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(
        request, db, user, course.course_uuid, AccessAction.READ
    )
    return course


@router.post(
    "/import",
    response_model=RoadmapImportResponse,
    summary="Import a roadmap (creates or merges a course) and generate missing content",
    responses={
        200: {"description": "Course structure created/merged.", "model": RoadmapImportResponse},
        400: {"description": "Invalid roadmap"},
        403: {"description": "Not a member, no create/update permission, or plan limit"},
    },
)
async def import_roadmap_endpoint(
    request: Request,
    body: ImportRoadmapRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> RoadmapImportResponse:
    org = await _load_org(body.org_id, db)
    await _require_member(current_user, org.id, db)

    if not body.plan.chapters or not any(
        chapter.lessons for chapter in body.plan.chapters
    ):
        raise HTTPException(status_code=400, detail="Roadmap has no chapters/lessons")

    lesson_count = sum(len(chapter.lessons) for chapter in body.plan.chapters)
    if lesson_count > 60:
        raise HTTPException(
            status_code=400, detail="A roadmap can contain at most 60 lessons per import"
        )

    rejected: List[str] = []
    for chapter in body.plan.chapters:
        for lesson in chapter.lessons:
            if lesson.tasks:
                _accepted, lesson_rejected = valid_tasks(lesson.tasks)
                rejected.extend(
                    f"{lesson.title}: {reason}" for reason in lesson_rejected
                )
    if rejected:
        raise HTTPException(
            status_code=400,
            detail="Invalid tasks: " + "; ".join(rejected[:10]),
        )

    if body.course_uuid:
        course = await _load_course_for_update(
            request, body.course_uuid, current_user, db
        )
    else:
        await require_org_create_permission(current_user, org.id, db, "courses")

    assignment_estimate = sum(
        1
        for chapter in body.plan.chapters
        for lesson in chapter.lessons
        if lesson.tasks or body.generate_missing
    )
    if assignment_estimate:
        await check_limits_with_usage("assignments", org.id, db)

    try:
        course, pending, created, updated, skipped = await import_roadmap(
            request=request,
            spec=body.plan,
            org_id=org.id,
            course_uuid=body.course_uuid,
            current_user=current_user,
            db=db,
            generate_missing=body.generate_missing,
            publish=body.publish,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    job = None
    if pending:
        now = str(datetime.now())
        job = RoadmapImportJob(
            job_uuid=f"roadmapjob_{uuid4()}",
            org_id=org.id,
            course_id=course.id,
            user_id=resolve_acting_user_id(current_user),
            status=RoadmapJobStatus.PENDING,
            plan=body.plan.model_dump(mode="json"),
            items=pending,
            total=len(pending),
            completed=0,
            failed=0,
            creation_date=now,
            update_date=now,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        _launch_job(job.job_uuid)

    return RoadmapImportResponse(
        course_uuid=course.course_uuid,
        course_id=course.id,
        job_uuid=job.job_uuid if job else None,
        job_status=job.status.value if job else None,
        created=created,
        updated=updated,
        skipped=skipped,
    )


@router.get(
    "/jobs/{job_uuid}",
    summary="Roadmap import job status",
)
async def get_job(
    request: Request,
    job_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
):
    job = (
        await db.execute(
            select(RoadmapImportJob).where(RoadmapImportJob.job_uuid == job_uuid)
        )
    ).scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    course = await db.get(Course, job.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await _load_course_for_update(request, course.course_uuid, current_user, db)
    return {
        "job_uuid": job.job_uuid,
        "course_uuid": course.course_uuid,
        "status": job.status.value,
        "total": job.total,
        "completed": job.completed,
        "failed": job.failed,
        "error": job.error,
        "items": job.items,
        "creation_date": job.creation_date,
        "update_date": job.update_date,
    }


@router.post(
    "/jobs/{job_uuid}/retry",
    summary="Retry failed roadmap generation items",
)
async def retry_job(
    request: Request,
    job_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
):
    job = (
        await db.execute(
            select(RoadmapImportJob).where(RoadmapImportJob.job_uuid == job_uuid)
        )
    ).scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    course = await db.get(Course, job.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await _load_course_for_update(request, course.course_uuid, current_user, db)
    if job.status == RoadmapJobStatus.RUNNING:
        raise HTTPException(status_code=409, detail="Job is already running")

    items = []
    for item in job.items or []:
        if item.get("state") == RoadmapItemState.FAILED.value:
            item = {key: value for key, value in item.items() if key != "error"}
            item["state"] = RoadmapItemState.PENDING.value
        items.append(item)
    job.items = items
    job.status = RoadmapJobStatus.PENDING
    job.error = None
    job.failed = 0
    job.update_date = str(datetime.now())
    db.add(job)
    await db.commit()
    _launch_job(job.job_uuid)
    return {"job_uuid": job.job_uuid, "status": job.status.value, "items": job.items}


@router.post(
    "/{course_uuid}/assistant",
    response_model=RoadmapAssistantResponse,
    summary="Ask the roadmap assistant (knows the current lesson/task)",
)
async def assistant(
    request: Request,
    course_uuid: str,
    body: RoadmapAssistantRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> RoadmapAssistantResponse:
    course = await _load_course_for_read(request, course_uuid, current_user, db)
    await _require_member(current_user, course.org_id, db)
    from src.services.security.rate_limiting import enforce_ai_rate_limit

    enforce_ai_rate_limit(resolve_acting_user_id(current_user), course.org_id)
    await reserve_ai_credit(course.org_id, db, amount=1)
    try:
        return await ask_roadmap_assistant(
            request=request,
            course=course,
            body=body,
            current_user=current_user,
            db=db,
        )
    except HTTPException:
        refund_ai_credit(course.org_id, 1)
        raise
    except Exception:
        refund_ai_credit(course.org_id, 1)
        logger.exception("Roadmap assistant failed")
        raise HTTPException(
            status_code=502, detail="The assistant could not answer. Please try again."
        )


@router.post(
    "/{course_uuid}/operations",
    response_model=ApplyRoadmapOperationsResponse,
    summary="Apply assistant-proposed roadmap changes",
)
async def apply_operations(
    request: Request,
    course_uuid: str,
    body: ApplyRoadmapOperationsRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> ApplyRoadmapOperationsResponse:
    course = await _load_course_for_update(request, course_uuid, current_user, db)
    from src.services.security.rate_limiting import enforce_ai_rate_limit

    enforce_ai_rate_limit(resolve_acting_user_id(current_user), course.org_id)
    if not body.operations:
        return ApplyRoadmapOperationsResponse(applied=[])
    try:
        model_name = await resolve_model_for_org(
            course.org_id, db, purpose="planning"
        )
    except Exception:
        model_name = None

    applied: List[AppliedOperation] = []
    generating = {"generate_lesson", "generate_tasks"}
    for operation in body.operations:
        needs_ai = operation.action in generating or (
            operation.action == "add_lesson" and not operation.material
        )
        if needs_ai and not model_name:
            applied.append(
                AppliedOperation(
                    action=operation.action,
                    status="failed",
                    detail="AI is not configured",
                )
            )
            continue
        if needs_ai:
            try:
                await reserve_ai_credit(course.org_id, db, amount=1)
            except HTTPException:
                applied.append(
                    AppliedOperation(
                        action=operation.action,
                        status="failed",
                        detail="AI credits unavailable",
                    )
                )
                continue
        result = await apply_operation(
            request=request,
            course=course,
            operation=operation,
            current_user=current_user,
            db=db,
            model_name=model_name,
        )
        if needs_ai and result.status == "failed":
            refund_ai_credit(course.org_id, 1)
        applied.append(result)
    return ApplyRoadmapOperationsResponse(applied=applied)


# ---------------------------------------------------------------------------
# Lesson feedback
# ---------------------------------------------------------------------------


async def _activity_and_course(
    request: Request,
    activity_uuid: str,
    user: PublicUser,
    db: AsyncSession,
) -> tuple[Activity, Course]:
    activity = (
        await db.execute(
            select(Activity).where(Activity.activity_uuid == activity_uuid)
        )
    ).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    course = await db.get(Course, activity.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not await can_read_activity(request, user, course, activity.id, db):
        raise HTTPException(status_code=403, detail="You cannot access this lesson")
    return activity, course


async def _chapter_name(chapter_id: Optional[int], db: AsyncSession) -> Optional[str]:
    if chapter_id is None:
        return None
    from src.db.courses.chapters import Chapter

    chapter = await db.get(Chapter, chapter_id)
    return chapter.name if chapter else None


def _feedback_read(
    row: LessonFeedback,
    *,
    activity: Optional[Activity] = None,
    course: Optional[Course] = None,
    username: Optional[str] = None,
    chapter_name: Optional[str] = None,
) -> LessonFeedbackRead:
    return LessonFeedbackRead(
        id=row.id,
        feedback_uuid=row.feedback_uuid,
        org_id=row.org_id,
        course_id=row.course_id,
        chapter_id=row.chapter_id,
        activity_id=row.activity_id,
        activity_uuid=activity.activity_uuid if activity else None,
        activity_name=activity.name if activity else None,
        chapter_name=chapter_name,
        user_id=row.user_id,
        username=username,
        rating=row.rating,
        content=row.content,
        status=row.status,
        creation_date=row.creation_date,
        update_date=row.update_date,
    )


@router.put(
    "/activities/{activity_uuid}/feedback",
    response_model=LessonFeedbackRead,
    summary="Create or update the caller's feedback for a lesson",
)
async def upsert_feedback(
    request: Request,
    activity_uuid: str,
    body: LessonFeedbackUpsert,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> LessonFeedbackRead:
    if not body.content.strip() and body.rating is None:
        raise HTTPException(status_code=400, detail="Add a comment or a rating")
    if len(body.content) > 5000:
        raise HTTPException(status_code=400, detail="Comment is too long")
    _require_human(current_user)

    activity, course = await _activity_and_course(
        request, activity_uuid, current_user, db
    )
    row = (
        await db.execute(
            select(LessonFeedback).where(
                LessonFeedback.activity_id == activity.id,
                LessonFeedback.user_id == current_user.id,
            )
        )
    ).scalars().first()
    now = str(datetime.now())

    if row is None:
        from src.db.courses.chapter_activities import ChapterActivity

        chapter_id = (
            await db.execute(
                select(ChapterActivity.chapter_id).where(
                    ChapterActivity.activity_id == activity.id
                )
            )
        ).scalars().first()
        row = LessonFeedback(
            feedback_uuid=f"feedback_{uuid4()}",
            org_id=course.org_id,
            course_id=course.id,
            chapter_id=chapter_id,
            activity_id=activity.id,
            user_id=current_user.id,
            rating=body.rating,
            content=body.content.strip(),
            status=FeedbackStatus.OPEN,
            creation_date=now,
            update_date=now,
        )
        db.add(row)
    else:
        row.rating = body.rating
        row.content = body.content.strip()
        row.status = FeedbackStatus.OPEN
        row.update_date = now
        db.add(row)
    await db.commit()
    await db.refresh(row)
    chapter_name = await _chapter_name(row.chapter_id, db)
    return _feedback_read(
        row,
        activity=activity,
        course=course,
        username=current_user.username,
        chapter_name=chapter_name,
    )


@router.get(
    "/activities/{activity_uuid}/feedback",
    response_model=Optional[LessonFeedbackRead],
    summary="Get the caller's feedback for a lesson",
)
async def get_own_feedback(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> Optional[LessonFeedbackRead]:
    activity, course = await _activity_and_course(
        request, activity_uuid, current_user, db
    )
    _require_human(current_user)
    row = (
        await db.execute(
            select(LessonFeedback).where(
                LessonFeedback.activity_id == activity.id,
                LessonFeedback.user_id == current_user.id,
            )
        )
    ).scalars().first()
    if not row:
        return None
    return _feedback_read(
        row,
        activity=activity,
        course=course,
        username=current_user.username,
        chapter_name=await _chapter_name(row.chapter_id, db),
    )


@router.get(
    "/courses/{course_uuid}/feedback",
    response_model=List[LessonFeedbackRead],
    summary="List lesson feedback for a course (instructors)",
)
async def list_course_feedback(
    request: Request,
    course_uuid: str,
    status: Optional[FeedbackStatus] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> List[LessonFeedbackRead]:
    course = await _load_course_for_update(request, course_uuid, current_user, db)
    from src.db.courses.chapters import Chapter

    statement = (
        select(LessonFeedback, Activity, User, Chapter.name)
        .join(Activity, Activity.id == LessonFeedback.activity_id)
        .join(User, User.id == LessonFeedback.user_id)
        .outerjoin(Chapter, Chapter.id == LessonFeedback.chapter_id)
        .where(LessonFeedback.course_id == course.id)
        .order_by(LessonFeedback.creation_date.desc())
        .offset(offset)
        .limit(limit)
    )
    if status is not None:
        statement = statement.where(LessonFeedback.status == status)
    rows = (await db.execute(statement)).all()
    return [
        _feedback_read(
            feedback,
            activity=activity,
            course=course,
            username=user.username,
            chapter_name=chapter_name,
        )
        for feedback, activity, user, chapter_name in rows
    ]


@router.patch(
    "/feedback/{feedback_uuid}",
    response_model=LessonFeedbackRead,
    summary="Edit a lesson comment or resolve it (author/instructor)",
)
async def update_feedback(
    request: Request,
    feedback_uuid: str,
    body: FeedbackUpdateRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
) -> LessonFeedbackRead:
    row = (
        await db.execute(
            select(LessonFeedback).where(LessonFeedback.feedback_uuid == feedback_uuid)
        )
    ).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    course = await db.get(Course, row.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _require_human(current_user)

    is_author = row.user_id == current_user.id
    is_instructor = False
    await _require_member(current_user, course.org_id, db)
    try:
        await check_resource_access(
            request, db, current_user, course.course_uuid, AccessAction.UPDATE
        )
        is_instructor = True
    except HTTPException:
        if not is_author:
            raise HTTPException(status_code=403, detail="Not allowed to edit this feedback")

    if body.content is not None:
        if not is_author:
            raise HTTPException(
                status_code=403, detail="Only the author can edit the comment"
            )
        row.content = body.content.strip()[:5000]
    if body.rating is not None:
        if not is_author:
            raise HTTPException(
                status_code=403, detail="Only the author can edit the rating"
            )
        row.rating = body.rating
    if body.status is not None:
        if not is_instructor:
            raise HTTPException(
                status_code=403, detail="Only an instructor can resolve feedback"
            )
        row.status = body.status
    row.update_date = str(datetime.now())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    activity = await db.get(Activity, row.activity_id)
    user = await db.get(User, row.user_id)
    return _feedback_read(
        row,
        activity=activity,
        course=course,
        username=user.username if user else None,
        chapter_name=await _chapter_name(row.chapter_id, db),
    )


@router.delete(
    "/feedback/{feedback_uuid}",
    summary="Delete a lesson comment (author/instructor)",
)
async def delete_feedback(
    request: Request,
    feedback_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db_session),
):
    row = (
        await db.execute(
            select(LessonFeedback).where(LessonFeedback.feedback_uuid == feedback_uuid)
        )
    ).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    course = await db.get(Course, row.course_id)
    _require_human(current_user)
    if row.user_id != current_user.id:
        await _load_course_for_update(request, course.course_uuid, current_user, db)
    await db.delete(row)
    await db.commit()
    return {"detail": "feedback deleted"}
