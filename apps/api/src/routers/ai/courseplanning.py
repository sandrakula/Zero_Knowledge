import base64
import asyncio
import json
import logging
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select

from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import is_org_member, enforce_org_mfa, require_org_create_permission
from src.security.rbac import check_resource_access, AccessAction
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
    reserve_ai_credit,
)
from src.services.ai.llm import resolve_model_for_org, model_for_tier
from src.services.ai.assignment_gen import generate_assignment_plan
from src.services.ai.courseplanning import (
    get_course_planning_session,
    create_course_planning_session,
    save_course_planning_session,
    generate_course_plan_stream,
    generate_activity_content_stream,
    build_attachment_context,
    build_user_notes_context,
    MAX_PLANNING_ITERATIONS,
    MAX_ACTIVITY_ITERATIONS,
    ENABLE_ACTIVITY_CONTENT_GENERATION,
)
from src.services.ai.schemas.courseplanning import (
    CoursePlanningSessionData,
    StartCoursePlanningSession,
    SendCoursePlanningMessage,
    FinalizeCoursePlanRequest,
    GenerateActivityContentRequest,
    GenerateCourseAssignmentsRequest,
    SaveActivityContentRequest,
    CoursePlanningSessionResponse,
    FinalizeCoursePlanResponse,
    CoursePlanningMessage,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _notebook_cells_from_attachment(attachment) -> list[dict]:
    """Turn a .ipynb attachment into the notebook-task cell format."""
    if not attachment.content_base64:
        return []
    try:
        raw = base64.b64decode(attachment.content_base64).decode("utf-8")
        notebook = json.loads(raw)
    except Exception:
        logger.warning("Skipping unreadable notebook attachment %s", attachment.name)
        return []

    cells = []
    for index, cell in enumerate(notebook.get("cells") or []):
        if not isinstance(cell, dict):
            continue
        cell_type = cell.get("cell_type")
        if cell_type not in ("markdown", "code", "raw"):
            continue
        source = cell.get("source")
        if isinstance(source, list):
            source = "".join(str(part) for part in source)
        if not isinstance(source, str):
            source = ""
        cells.append({
            "id": f"cell_{index}",
            "cell_type": cell_type,
            "source": source,
        })
    return cells


def _source_names(session) -> list[str]:
    names = [attachment.name for attachment in (session.attachments or []) if attachment.name]
    if not names and session.message_history:
        names = ["материалы из чата"]
    return names


async def _keep_passing_code_tests(task) -> bool:
    """Drop CODE test cases that the generated solution does not actually pass.

    The model can invent plausible stdin/expected_stdout pairs that are
    inconsistent with its own solution. Persisting those makes every learner
    fail through no fault of their own, so each test is executed once against
    the reference solution and only passing cases survive.
    """
    contents = task.contents or {}
    tests = contents.get("test_cases") or []
    solution = (contents.get("solution_code") or "").strip()
    if not solution or not tests:
        return False

    try:
        from src.routers.code_execution import _get_judge0_config, _submit_single
        judge0_cfg = _get_judge0_config()
    except Exception:
        logger.warning("Judge0 not configured; dropping generated CODE task")
        return False

    language_id = int(contents.get("language_id") or 71)
    results = await asyncio.gather(
        *[
            _submit_single(
                judge0_cfg, language_id, solution, test.get("stdin") or ""
            )
            for test in tests
        ],
        return_exceptions=True,
    )

    passing = []
    for test, result in zip(tests, results):
        if isinstance(result, Exception):
            continue
        status_id = (result.get("status") or {}).get("id")
        actual = (result.get("stdout") or "").rstrip()
        expected = (test.get("expectedStdout") or "").rstrip()
        if status_id == 3 and actual == expected:
            passing.append(test)

    if not passing:
        return False
    contents["test_cases"] = passing
    return True


async def event_generator(generator, session_uuid: str):
    """Convert async generator to SSE format"""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logger.exception("Error in event_generator for session %s", session_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while generating the stream.'})}\n\n"


async def event_generator_with_save(generator, session_uuid: str, activity_uuid: str):
    """Convert async generator to SSE format.
    Note: Content saving is handled by the dedicated /save-activity-content endpoint
    called from the frontend after parsing the stream."""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

        # Content is saved via the dedicated save endpoint called from frontend
        logger.info(f"[AI Content] Streaming complete for activity {activity_uuid}, content will be saved via explicit API call")
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logger.exception("Error in event_generator_with_save for activity %s", activity_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while generating activity content.'})}\n\n"


def _load_owned_session(session_uuid: str, current_user) -> CoursePlanningSessionData:
    """The caller's planning session, or 404 (unknown, or started by someone else)."""
    session = get_course_planning_session(session_uuid)
    if not session or (
        session.user_id is not None and session.user_id != resolve_acting_user_id(current_user)
    ):
        raise HTTPException(status_code=404, detail="Session not found")
    return session


async def get_org_ai_model(org_id: int, db_session: AsyncSession) -> str:
    """Resolve the course-planning model for the org's plan (provider-agnostic)."""
    return await resolve_model_for_org(org_id, db_session, purpose="planning")


async def verify_user_org_membership(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    """Verify that the user is a member of the organization (superadmins bypass)."""
    member = await is_org_member(user_id, org_id, db_session)
    if member:
        await enforce_org_mfa(user_id, org_id, db_session)
    return member


async def require_activity_write_access(
    request: Request,
    activity: Activity,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> Course:
    """Require write rights on the course that owns ``activity``.

    Org membership only says "you belong to this tenant"; every other path that
    writes activity content also demands authorship or admin/maintainer on the
    owning course. These endpoints must not be a way around that.
    """
    statement = select(Course).where(Course.id == activity.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    return course


@router.post(
    "/courseplanning/start",
    summary="Start course planning session (streaming)",
    description="Start a new AI course planning session for an organization and stream the generated course plan as Server-Sent Events (SSE). Consumes AI credits based on the organization's plan tier.",
    responses={
        200: {
            "description": "SSE stream of course planning events (chunk, done, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization or insufficient credits"},
        404: {"description": "Organization not found"},
    },
)
async def start_course_planning_session(
    request: Request,
    session_request: StartCoursePlanningSession,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Start a new course planning AI session with streaming response.
    Returns Server-Sent Events (SSE) stream.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == session_request.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(resolve_acting_user_id(current_user), org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    # Planning spends credits towards a course the caller will create: the
    # same create right finalize requires, so a learner can't drain the quota.
    await require_org_create_permission(current_user, org.id, db_session, "courses")

    # Get AI model; pro models cost more credits
    ai_model = await get_org_ai_model(org.id, db_session)
    credit_cost = 3 if ai_model == model_for_tier("pro") else 1
    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)
    # Atomic check+deduct via Redis Lua so concurrent streams can't race past
    # the plan limit. Raises 403 if quota would be exceeded.
    await reserve_ai_credit(org.id, db_session, amount=credit_cost)

    # Create new session with language
    session = create_course_planning_session(
        org_id=org.id, language=session_request.language,
        user_id=resolve_acting_user_id(current_user),
    )
    session.attachments = session_request.attachments or []
    save_course_planning_session(session)

    # Generate with streaming (include attachments if provided)
    stream = generate_course_plan_stream(
        prompt=session_request.prompt,
        session=session,
        model_name=ai_model,
        attachments=session_request.attachments
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post(
    "/courseplanning/iterate",
    summary="Iterate course planning session (streaming)",
    description="Continue an existing course planning session with a new user message and stream the updated plan as Server-Sent Events (SSE). Bounded by the session's max planning iterations.",
    responses={
        200: {
            "description": "SSE stream of course planning events (chunk, done, error).",
            "content": {"text/event-stream": {}},
        },
        400: {"description": "Maximum planning iterations reached"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization or insufficient credits"},
        404: {"description": "Session or organization not found"},
    },
)
async def iterate_course_planning_session(
    request: Request,
    message_request: SendCoursePlanningMessage,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Continue an existing course planning session with a new message.
    Returns Server-Sent Events (SSE) stream.
    """
    # Get existing session
    session = _load_owned_session(message_request.session_uuid, current_user)

    # Check iteration limit
    if session.planning_iteration_count >= session.max_planning_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum planning iterations ({MAX_PLANNING_ITERATIONS}) reached"
        )

    # Get the organization
    statement = select(Organization).where(Organization.id == session.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(resolve_acting_user_id(current_user), org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    # Planning spends credits towards a course the caller will create: the
    # same create right finalize requires, so a learner can't drain the quota.
    await require_org_create_permission(current_user, org.id, db_session, "courses")

    # Get AI model; pro models cost more credits
    ai_model = await get_org_ai_model(org.id, db_session)
    credit_cost = 3 if ai_model == model_for_tier("pro") else 1
    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)
    # Atomic check+deduct via Redis Lua so concurrent streams can't race past
    # the plan limit. Raises 403 if quota would be exceeded.
    await reserve_ai_credit(org.id, db_session, amount=credit_cost)

    # Use provided plan or session's current plan
    current_plan = message_request.current_plan or session.current_plan

    # Keep every material the learner provided across iterations so activity
    # generation can use all of them, not just the latest message's files.
    if message_request.attachments:
        existing_names = {a.name for a in session.attachments}
        session.attachments.extend(
            a for a in message_request.attachments if a.name not in existing_names
        )
        save_course_planning_session(session)

    # Generate with streaming (include attachments if provided)
    stream = generate_course_plan_stream(
        prompt=message_request.message,
        session=session,
        model_name=ai_model,
        current_plan=current_plan,
        attachments=message_request.attachments
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post(
    "/courseplanning/finalize",
    response_model=FinalizeCoursePlanResponse,
    summary="Finalize course plan",
    description="Finalize an AI-generated course plan and persist the course, chapters, and activities in the database. The calling user becomes the creator of the resulting course.",
    responses={
        200: {"description": "Course, chapters, and activities created from the plan.", "model": FinalizeCoursePlanResponse},
        400: {"description": "Course already created from this session"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization, cannot create courses, or the course limit is reached"},
        404: {"description": "Session or organization not found"},
    },
)
async def finalize_course_plan(
    request: Request,
    finalize_request: FinalizeCoursePlanRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> FinalizeCoursePlanResponse:
    """
    Finalize the course plan and create the course structure in the database.
    Creates course, chapters, and activities.
    """
    # Get existing session
    session = _load_owned_session(finalize_request.session_uuid, current_user)

    # Check if already finalized
    if session.course_id is not None:
        raise HTTPException(status_code=400, detail="Course already created from this session")

    # Get the organization
    statement = select(Organization).where(Organization.id == session.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(resolve_acting_user_id(current_user), org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Membership is not permission to create. Finalizing writes a real Course
    # and makes the caller its CREATOR (which by itself grants update/delete
    # rights), so require the same courses.action_create right every other
    # course-creation path enforces.
    #
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)
    await require_org_create_permission(current_user, org.id, db_session, "courses")
    # Same plan limit as create_course.
    await check_limits_with_usage("courses", org.id, db_session)

    plan = finalize_request.plan

    # Create the course
    course = Course(
        course_uuid=f"course_{uuid4()}",
        name=plan.name,
        description=plan.description,
        about=plan.description,
        learnings=plan.learnings,
        tags="|".join(plan.tags),
        public=True,  # Access is open by default; restrict via course settings
        published=False,
        open_to_contributors=False,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(course)
    await db_session.commit()
    await db_session.refresh(course)
    await increase_feature_usage("courses", org.id, db_session)

    # Make the current user the creator of the course (resolve API tokens to
    # their creator so authorship records a real user_id, not the token id 0).
    resource_author = ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=resolve_acting_user_id(current_user),
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    await db_session.commit()

    created_chapters = []
    created_chapter_objects = []
    source_names = _source_names(session)

    # Create chapters and activities
    for chapter_index, chapter_plan in enumerate(plan.chapters):
        # Create chapter
        chapter = Chapter(
            chapter_uuid=f"chapter_{uuid4()}",
            name=chapter_plan.name,
            description=chapter_plan.description,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(chapter)
        await db_session.commit()
        await db_session.refresh(chapter)

        # Create course-chapter link
        course_chapter = CourseChapter(
            course_id=course.id,
            chapter_id=chapter.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=chapter_index,
        )

        db_session.add(course_chapter)
        await db_session.commit()

        created_activities = []

        # Create activities
        for activity_index, activity_plan in enumerate(chapter_plan.activities):
            activity = Activity(
                activity_uuid=f"activity_{uuid4()}",
                name=activity_plan.name,
                activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                content={},  # Empty dict, content will be generated later
                details={
                    "description": activity_plan.description,
                    "ai_generated": True,
                    "ai_sources": source_names,
                },
                extra_metadata={"ai_generated": True, "ai_sources": source_names},
                published=False,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(activity)
            await db_session.commit()
            await db_session.refresh(activity)

            # Create chapter-activity link
            chapter_activity = ChapterActivity(
                chapter_id=chapter.id,
                activity_id=activity.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                order=activity_index,
            )

            db_session.add(chapter_activity)
            await db_session.commit()

            created_activities.append({
                "activity_uuid": activity.activity_uuid,
                "activity_id": activity.id,
                "name": activity.name,
                "description": activity_plan.description,
                "suggested_blocks": activity_plan.suggested_blocks,
            })

        created_chapters.append({
            "chapter_uuid": chapter.chapter_uuid,
            "chapter_id": chapter.id,
            "name": chapter.name,
            "activities": created_activities,
        })
        created_chapter_objects.append(chapter)

    # Uploaded notebooks are also persisted as an executable Notebook
    # assignment, not just used as planning context. That way the learner's
    # own .ipynb remains in the course after generation.
    notebook_attachments = [
        attachment
        for attachment in (session.attachments or [])
        if attachment.name.lower().endswith(".ipynb")
    ]
    if notebook_attachments and created_chapter_objects:
        attachment = notebook_attachments[0]
        cells = _notebook_cells_from_attachment(attachment)
        if cells:
            target_chapter = created_chapter_objects[-1]
            target_order = len(created_chapters[-1]["activities"])

            assignment_activity = Activity(
                activity_uuid=f"activity_{uuid4()}",
                name=f"Практикум: {attachment.name}",
                activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
                content={},
                details={
                    "description": "Практическое задание по прикреплённому ноутбуку.",
                    "ai_generated": True,
                    "ai_sources": source_names,
                },
                extra_metadata={"ai_generated": True, "ai_sources": source_names},
                published=True,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(assignment_activity)
            await db_session.commit()
            await db_session.refresh(assignment_activity)

            db_session.add(ChapterActivity(
                chapter_id=target_chapter.id,
                activity_id=assignment_activity.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                order=target_order,
            ))

            assignment = Assignment(
                title=f"Notebook: {attachment.name}",
                description="Выполните ячейки загруженного ноутбука.",
                grading_type=GradingTypeEnum.PERCENTAGE,
                auto_grading=False,
                published=True,
                org_id=org.id,
                course_id=course.id,
                chapter_id=target_chapter.id,
                activity_id=assignment_activity.id,
            )
            assignment.assignment_uuid = f"assignment_{uuid4()}"
            assignment.creation_date = str(datetime.now())
            assignment.update_date = str(datetime.now())
            db_session.add(assignment)
            await db_session.commit()
            await db_session.refresh(assignment)

            task = AssignmentTask(
                assignment_task_uuid=f"assignmenttask_{uuid4()}",
                title=f"Notebook: {attachment.name}",
                description="Выполните ячейки и сохраните результаты.",
                hint="",
                assignment_type=AssignmentTaskTypeEnum.CUSTOM,
                contents={
                    "kind": "notebook",
                    "language_id": 71,
                    "cells": cells,
                    "_meta": {"ai_generated": True, "source": "ai"},
                },
                max_grade_value=100,
                order=0,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                assignment_id=assignment.id,
                org_id=org.id,
                course_id=course.id,
                chapter_id=target_chapter.id,
                activity_id=assignment_activity.id,
            )
            db_session.add(task)
            await db_session.commit()

    # Update session with course_id
    session.course_id = course.id
    save_course_planning_session(session)

    return FinalizeCoursePlanResponse(
        course_uuid=course.course_uuid,
        course_id=course.id,  # type: ignore
        chapters=created_chapters,
    )


@router.post(
    "/courseplanning/generate-assignments",
    summary="Generate graded tasks for a finalized AI course",
    description="Generates one practical assignment with several graded tasks from the course content, and persists it as an assignment activity. Safe to call again: an existing AI assignment is returned instead of duplicated.",
)
async def generate_course_assignments(
    request: Request,
    body: GenerateCourseAssignmentsRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    session = _load_owned_session(body.session_uuid, current_user)
    if session.course_id is None:
        raise HTTPException(status_code=400, detail="Course is not finalized yet")

    course = (await db_session.execute(
        select(Course).where(Course.id == session.course_id)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if not await verify_user_org_membership(resolve_acting_user_id(current_user), course.org_id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )

    activity_name = "Практические задания (AI)"
    existing = (await db_session.execute(
        select(Activity).where(
            Activity.course_id == course.id,
            Activity.name == activity_name,
        )
    )).scalars().first()
    if existing:
        existing_assignment = (await db_session.execute(
            select(Assignment).where(Assignment.activity_id == existing.id)
        )).scalars().first()
        return {
            "created": False,
            "activity_uuid": existing.activity_uuid,
            "assignment_uuid": existing_assignment.assignment_uuid if existing_assignment else None,
            "tasks_created": 0,
        }

    chapter = (await db_session.execute(
        select(Chapter)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
        .where(CourseChapter.course_id == course.id)
        .order_by(CourseChapter.order.desc())
        .limit(1)
    )).scalars().first()
    if not chapter:
        raise HTTPException(status_code=400, detail="Course has no chapters")

    await check_limits_with_usage("assignments", course.org_id, db_session)
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), course.org_id)
    await reserve_ai_credit(course.org_id, db_session, amount=1)

    attachment_context = build_attachment_context(session.attachments) if session.attachments else ""
    notes = build_user_notes_context(session)
    prompt = (
        f"Создай итоговое практическое задание по курсу «{course.name}». "
        "Сделай 5 заданий разных типов: квиз, короткий ответ, числовой расчёт, "
        "заполнение пропусков и ОБЯЗАТЕЛЬНО одно задание CODE по Python. "
        "Code-задание должно быть практическим: решение на Python, 2-4 теста "
        "с ожидаемым stdout, проверяющие разные случаи. "
        "Задания должны проверять понимание материала, а не пересказ."
    )
    if attachment_context or notes:
        prompt += f"\n\nМатериалы курса:\n{attachment_context}\n{notes}"

    ai_model = await get_org_ai_model(course.org_id, db_session)
    plan, _ = await generate_assignment_plan(
        org_id=course.org_id,
        course_id=course.id,
        prompt=prompt,
        model_name=ai_model,
        db_session=db_session,
        num_tasks=5,
        allowed_task_types=["QUIZ", "FORM", "SHORT_ANSWER", "NUMBER_ANSWER", "CODE"],
    )

    if not plan.tasks:
        raise HTTPException(status_code=502, detail="AI did not produce usable tasks")

    validated_tasks = []
    for task in plan.tasks:
        if task.assignment_type == "CODE":
            if not await _keep_passing_code_tests(task):
                logger.warning("Dropping generated CODE task with no passing tests")
                continue
        validated_tasks.append(task)
    plan.tasks = validated_tasks
    if not plan.tasks:
        raise HTTPException(status_code=502, detail="AI did not produce usable tasks")

    chapter_activities = (await db_session.execute(
        select(ChapterActivity).where(ChapterActivity.chapter_id == chapter.id)
    )).scalars().all()

    activity = Activity(
        activity_uuid=f"activity_{uuid4()}",
        name=activity_name,
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        details={
            "description": plan.description,
            "ai_generated": True,
            "ai_sources": _source_names(session),
        },
        extra_metadata={"ai_generated": True, "ai_sources": _source_names(session)},
        published=True,
        course_id=course.id,
        org_id=course.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(activity)

    db_session.add(ChapterActivity(
        chapter_id=chapter.id,
        activity_id=activity.id,
        course_id=course.id,
        org_id=course.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=len(chapter_activities),
    ))

    try:
        grading_type = GradingTypeEnum(plan.grading_type)
    except ValueError:
        grading_type = GradingTypeEnum.PERCENTAGE

    assignment = Assignment(
        title=plan.title or activity_name,
        description=plan.description,
        grading_type=grading_type,
        auto_grading=True,
        published=True,
        org_id=course.org_id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )
    assignment.assignment_uuid = f"assignment_{uuid4()}"
    assignment.creation_date = str(datetime.now())
    assignment.update_date = str(datetime.now())
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(assignment)

    for index, task in enumerate(plan.tasks):
        contents = dict(task.contents or {})
        contents["_meta"] = {"ai_generated": True, "source": "ai"}
        db_session.add(AssignmentTask(
            assignment_task_uuid=f"assignmenttask_{uuid4()}",
            title=task.title,
            description=task.description,
            hint=task.hint,
            assignment_type=AssignmentTaskTypeEnum(task.assignment_type),
            contents=contents,
            max_grade_value=task.max_grade_value,
            order=index,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            assignment_id=assignment.id,
            org_id=course.org_id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
        ))
    await db_session.commit()
    await increase_feature_usage("assignments", course.org_id, db_session)

    return {
        "created": True,
        "activity_uuid": activity.activity_uuid,
        "assignment_uuid": assignment.assignment_uuid,
        "tasks_created": len(plan.tasks),
    }


@router.post(
    "/courseplanning/generate-activity",
    summary="Generate activity content (streaming)",
    description="Generate AI content for a specific activity within a course planning session and stream it as Server-Sent Events (SSE). Bounded by the session's max activity iterations. Content must subsequently be persisted via the save-activity-content endpoint.",
    responses={
        200: {
            "description": "SSE stream of activity content generation events (chunk, done, error).",
            "content": {"text/event-stream": {}},
        },
        400: {"description": "Maximum activity iterations reached"},
        401: {"description": "Authentication required"},
        403: {"description": "Activity content generation disabled, user not a member of the organization, unable to edit the activity's course, or insufficient credits"},
        404: {"description": "Session, activity, course, or organization not found"},
    },
)
async def generate_activity_content(
    request: Request,
    content_request: GenerateActivityContentRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Generate content for a specific activity with streaming response.
    Returns Server-Sent Events (SSE) stream.
    """
    # Check if feature is enabled
    if not ENABLE_ACTIVITY_CONTENT_GENERATION:
        raise HTTPException(
            status_code=403,
            detail="Activity content generation is currently disabled"
        )

    # Get existing session
    session = _load_owned_session(content_request.session_uuid, current_user)

    # Check activity iteration limit
    activity_uuid = content_request.activity_uuid
    iteration_count = session.activity_iteration_counts.get(activity_uuid, 0)

    if iteration_count >= session.max_activity_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum activity iterations ({MAX_ACTIVITY_ITERATIONS}) reached"
        )

    # Validate activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # The activity is looked up globally, so authorization must follow the
    # activity's org, not the org the caller chose when creating the planning
    # session. A planning session never legitimately reaches across tenants,
    # and on an iteration the existing content is fed back into the prompt and
    # streamed to the caller, so this is a read of the victim's material.
    if activity.org_id != session.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get the organization that actually owns the activity
    statement = select(Organization).where(Organization.id == activity.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(resolve_acting_user_id(current_user), org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # ...and that they may actually write this activity's course.
    await require_activity_write_access(request, activity, current_user, db_session)

    # Get AI model; pro models cost more credits
    ai_model = await get_org_ai_model(org.id, db_session)
    credit_cost = 3 if ai_model == model_for_tier("pro") else 1
    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)
    # Atomic check+deduct via Redis Lua so concurrent streams can't race past
    # the plan limit. Raises 403 if quota would be exceeded.
    await reserve_ai_credit(org.id, db_session, amount=credit_cost)

    # Get current content if iterating
    current_content = None
    if activity.content and iteration_count > 0:
        current_content = json.dumps(activity.content)

    # Generate with streaming
    stream = generate_activity_content_stream(
        session=session,
        activity_uuid=activity_uuid,
        activity_name=content_request.activity_name,
        activity_description=content_request.activity_description,
        chapter_name=content_request.chapter_name,
        course_name=content_request.course_name,
        course_description=content_request.course_description,
        model_name=ai_model,
        prompt=content_request.prompt,
        current_content=current_content
    )

    # Use event_generator_with_save to automatically save content to database when streaming completes
    return StreamingResponse(
        event_generator_with_save(stream, session.session_uuid, activity_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


def validate_prosemirror_content(content: dict) -> tuple[bool, str]:
    """Validate that content is a valid ProseMirror document structure."""
    if not isinstance(content, dict):
        return False, "Content must be a JSON object"

    if content.get("type") != "doc":
        return False, "Content must have 'type': 'doc' at root level"

    if "content" not in content:
        return False, "Content must have a 'content' array"

    if not isinstance(content["content"], list):
        return False, "Content 'content' field must be an array"

    # Valid ProseMirror block types used in the editor
    valid_block_types = {
        "paragraph", "heading", "bulletList", "orderedList", "listItem",
        "codeBlock", "blockQuiz", "flipcard", "calloutInfo", "calloutWarning",
        "blockEmbed", "blockImage", "blockVideo", "blockPDF", "blockMathEquation",
        "table", "tableRow", "tableCell", "tableHeader", "horizontalRule",
        "hardBreak", "text", "scenarios", "blockUser", "blockWebPreview", "button", "badge",
        "blockLibrary", "flipcardGrid"
    }

    def check_node(node: dict, path: str = "root") -> tuple[bool, str]:
        if not isinstance(node, dict):
            return False, f"Node at {path} must be an object"

        node_type = node.get("type")
        if not node_type:
            return False, f"Node at {path} must have a 'type' field"

        if node_type not in valid_block_types and node_type != "doc":
            # Allow unknown types but log warning - editor may have new block types
            import logging
            logging.getLogger(__name__).warning(f"Unknown block type '{node_type}' at {path}")

        # Recursively check children
        if "content" in node and isinstance(node["content"], list):
            for i, child in enumerate(node["content"]):
                valid, msg = check_node(child, f"{path}.content[{i}]")
                if not valid:
                    return False, msg

        return True, ""

    # Validate each block in content array
    for i, block in enumerate(content["content"]):
        valid, msg = check_node(block, f"content[{i}]")
        if not valid:
            return False, msg

    return True, ""


@router.post(
    "/courseplanning/save-activity-content",
    summary="Save AI-generated activity content",
    description="Persist AI-generated ProseMirror content to an activity. The content is validated for correct document structure before being saved.",
    responses={
        200: {"description": "Activity content saved successfully."},
        400: {"description": "Invalid content structure"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization or cannot edit this activity's course"},
        404: {"description": "Activity, course or organization not found"},
        500: {"description": "Failed to save content due to an internal error"},
    },
)
async def save_activity_content(
    request: Request,
    save_request: SaveActivityContentRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Save AI-generated content to an activity.
    Validates content structure before saving.
    """
    import logging
    logger = logging.getLogger(__name__)

    activity_uuid = save_request.activity_uuid
    content = save_request.content

    logger.info("[Save Activity Content] === START ===")
    logger.info(f"[Save Activity Content] Activity UUID: {activity_uuid}")
    logger.info(f"[Save Activity Content] Content type: {type(content)}")
    # Content MUST be a ProseMirror document object. A non-dict payload (list,
    # string, etc.) previously skipped validation entirely and got written
    # straight into activity.content, corrupting the activity so the editor
    # fails to render it. Reject it up front.
    if not isinstance(content, dict):
        logger.error(f"[Save Activity Content] Content is not an object: {type(content)}")
        raise HTTPException(status_code=400, detail="Invalid content structure: Content must be a JSON object")

    logger.info(f"[Save Activity Content] Content keys: {list(content.keys())}")
    content_str = json.dumps(content)
    logger.info(f"[Save Activity Content] Content size: {len(content_str)} bytes")
    logger.info(f"[Save Activity Content] Content preview: {content_str[:500]}")

    # Validate ProseMirror structure
    is_valid, validation_error = validate_prosemirror_content(content)
    if not is_valid:
        logger.error(f"[Save Activity Content] Validation failed: {validation_error}")
        raise HTTPException(status_code=400, detail=f"Invalid content structure: {validation_error}")

    # Validate activity exists first
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        logger.error(f"[Save Activity Content] Activity not found: {activity_uuid}")
        raise HTTPException(status_code=404, detail="Activity not found")

    logger.info(f"[Save Activity Content] Found activity ID: {activity.id}, name: {activity.name}")
    logger.info(f"[Save Activity Content] Current content size: {len(json.dumps(activity.content)) if activity.content else 0} bytes")

    # Get organization for permission check
    statement = select(Organization).where(Organization.id == activity.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(resolve_acting_user_id(current_user), org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Both the activity uuid and the content are caller-supplied, so membership
    # alone let any org member (a learner included) overwrite the body of
    # every activity in the org. Demand the same rights the regular activity
    # update path does.
    await require_activity_write_access(request, activity, current_user, db_session)

    # Direct update using SQLAlchemy ORM
    try:
        # Update activity directly - ensure fresh reference
        logger.info("[Save Activity Content] Updating activity.content...")

        # Set content directly on the model
        activity.content = content
        activity.update_date = str(datetime.now())

        # Explicitly mark as modified to ensure SQLAlchemy tracks the change
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(activity, "content")

        # Add and commit
        db_session.add(activity)
        await db_session.commit()

        logger.info("[Save Activity Content] Commit completed")

        # Verify by re-fetching with a fresh query
        db_session.expire_all()  # Clear any cached data
        statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
        verified_activity = (await db_session.execute(statement)).scalars().first()

        if verified_activity and verified_activity.content:
            content_keys = list(verified_activity.content.keys()) if isinstance(verified_activity.content, dict) else 'N/A'
            content_size = len(json.dumps(verified_activity.content)) if verified_activity.content else 0
            logger.info(f"[Save Activity Content] Verified from DB - content keys: {content_keys}, size: {content_size} bytes")
        else:
            logger.warning("[Save Activity Content] Verification failed - content is empty!")
            logger.warning(f"[Save Activity Content] Verified activity content: {verified_activity.content if verified_activity else 'None'}")

        logger.info("[Save Activity Content] === SUCCESS ===")
        return {"success": True, "activity_uuid": activity_uuid}
    except Exception as e:
        logger.error("[Save Activity Content] === FAILED ===")
        logger.error(f"[Save Activity Content] Error: {e}")
        import traceback
        logger.error(f"[Save Activity Content] Traceback: {traceback.format_exc()}")
        await db_session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save content: {str(e)}")


@router.get(
    "/courseplanning/session/{session_uuid}",
    response_model=CoursePlanningSessionResponse,
    summary="Get course planning session state",
    description="Return the current state of a course planning session, including the current plan, iteration counts, message history, and any linked course.",
    responses={
        200: {"description": "Course planning session state.", "model": CoursePlanningSessionResponse},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> CoursePlanningSessionResponse:
    """
    Get the current state of a course planning session.
    """
    session = _load_owned_session(session_uuid, current_user)

    # Cross-tenant IDOR guard: without this, any authenticated user can read
    # ANY planning session by UUID, leaking another org's full course plan and
    # the entire AI message history. Require membership of the session's org.
    if not await verify_user_org_membership(
        resolve_acting_user_id(current_user), session.org_id, db_session
    ):
        raise HTTPException(status_code=404, detail="Session not found")

    return CoursePlanningSessionResponse(
        session_uuid=session.session_uuid,
        planning_iteration_count=session.planning_iteration_count,
        max_planning_iterations=session.max_planning_iterations,
        current_plan=session.current_plan,
        message_history=[
            CoursePlanningMessage(role=msg.role, content=msg.content)
            for msg in session.message_history
        ],
        course_id=session.course_id,
    )
