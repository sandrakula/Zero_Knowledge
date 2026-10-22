"""Context-aware roadmap assistant and the applier for its proposed changes.

The assistant sees the whole course tree (UUIDs, lesson content presence, task
counts), the lesson the learner is on and — for assignment activities — the
student-safe task descriptions plus the learner's own submission. It answers in
text and may return structured operations; only a user with UPDATE rights on the
course can apply them.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, ChapterCreate, ChapterUpdate
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.users import PublicUser
from src.services.ai.llm import generate, resolve_model_for_org
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    update_activity,
)
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    update_chapter,
)
from src.services.roadmap.generation import (
    DEFAULT_TASKS_PER_LESSON,
    generate_lecture_markdown,
    generate_lesson_tasks,
)
from src.services.roadmap.importer import (
    apply_generated_lecture,
    apply_generated_tasks,
    _set_activity_content,
)
from src.services.roadmap.markdown import markdown_to_prosemirror
from src.services.roadmap.schema import (
    AppliedOperation,
    RoadmapAssistantRequest,
    RoadmapAssistantResponse,
    RoadmapOperation,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the AI assistant inside a learning platform.
You know the course structure and the exact lesson the learner is looking at.
Answer questions about the material and the current task clearly and concisely.
If the user asks to change the course roadmap, propose operations.

Available operations:
- add_chapter: requires title, optional description.
- update_chapter: requires chapter_uuid, optional title/description.
- delete_chapter: requires chapter_uuid.
- add_lesson: requires chapter_uuid, title, optional description/material (Markdown).
- update_lesson: requires activity_uuid, optional title/description/material (Markdown).
- delete_lesson: requires activity_uuid.
- generate_lesson: requires activity_uuid of a lecture; content is generated from its title/goal.
- add_task: requires activity_uuid of a practice assignment and a task object.
- generate_tasks: requires activity_uuid of a practice assignment.

Rules:
- Use the course tree as the source of truth. Each practice lesson lists its
  task titles and types; use them when answering.
- Use UUIDs exactly as they appear in the context.
- Only propose operations the user explicitly asked for; otherwise return an empty list.
- Never claim a change is applied; the user must confirm.
- Never reveal quiz answer keys, hidden tests or reference solutions to a learner.
- When adding a code task, include language, starter_code, solution_code and at
  least two deterministic test cases (stdin + expected output).
"""


class _AssistantOutput(BaseModel):
    reply: str
    operations: List[RoadmapOperation] = []


def _pm_text(node, limit: int = 6000) -> str:
    parts: List[str] = []

    def walk(value) -> None:
        if len(" ".join(parts)) > limit:
            return
        if isinstance(value, dict):
            if value.get("type") == "text" and value.get("text"):
                parts.append(str(value["text"]))
            for child in value.get("content") or []:
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return " ".join(parts)[:limit]


def _activity_has_content(activity: Activity) -> bool:
    content = activity.content if isinstance(activity.content, dict) else {}
    return bool(content.get("content"))


async def _course_tree(course: Course, db: AsyncSession) -> Tuple[List[dict], Dict[str, dict]]:
    chapters = (
        await db.execute(
            select(Chapter)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .where(CourseChapter.course_id == course.id)
            .order_by(CourseChapter.order.asc())
        )
    ).scalars().all()

    tree: List[dict] = []
    index: Dict[str, dict] = {}
    for chapter in chapters:
        chapter_info = {
            "chapter_uuid": chapter.chapter_uuid,
            "title": chapter.name,
            "description": chapter.description or "",
            "lessons": [],
        }
        rows = (
            await db.execute(
                select(Activity)
                .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
                .where(ChapterActivity.chapter_id == chapter.id)
                .order_by(ChapterActivity.order.asc())
            )
        ).scalars().all()
        for activity in rows:
            assignment = (
                await db.execute(
                    select(Assignment).where(Assignment.activity_id == activity.id)
                )
            ).scalars().first()
            task_count = 0
            task_summaries = []
            if assignment:
                assignment_tasks = (
                    await db.execute(
                        select(AssignmentTask)
                        .where(AssignmentTask.assignment_id == assignment.id)
                        .order_by(AssignmentTask.order.asc())
                    )
                ).scalars().all()
                task_count = len(assignment_tasks)
                task_summaries = [
                    {
                        "assignment_task_uuid": task.assignment_task_uuid,
                        "title": task.title,
                        "type": task.assignment_type.value,
                    }
                    for task in assignment_tasks
                ]
            lesson_info = {
                "activity_uuid": activity.activity_uuid,
                "title": activity.name,
                "type": activity.activity_type.value,
                "has_content": _activity_has_content(activity),
                "task_count": task_count,
                "tasks": task_summaries,
                "assignment_uuid": assignment.assignment_uuid if assignment else None,
            }
            chapter_info["lessons"].append(lesson_info)
            index[activity.activity_uuid] = {**lesson_info, "chapter_uuid": chapter.chapter_uuid}
        tree.append(chapter_info)
    return tree, index


async def _current_activity_context(
    course: Course,
    activity_uuid: Optional[str],
    assignment_task_uuid: Optional[str],
    user_id: int,
    db: AsyncSession,
) -> str:
    if not activity_uuid:
        return ""
    activity = (
        await db.execute(
            select(Activity).where(
                Activity.activity_uuid == activity_uuid, Activity.course_id == course.id
            )
        )
    ).scalars().first()
    if not activity:
        return ""

    lines = [f"CURRENT ACTIVITY: {activity.name} ({activity.activity_type.value})"]
    if _activity_has_content(activity):
        lines.append("Content:\n" + _pm_text(activity.content))

    assignment = (
        await db.execute(select(Assignment).where(Assignment.activity_id == activity.id))
    ).scalars().first()
    if assignment:
        tasks = (
            await db.execute(
                select(AssignmentTask)
                .where(AssignmentTask.assignment_id == assignment.id)
                .order_by(AssignmentTask.order.asc())
            )
        ).scalars().all()
        lines.append(f"Practice tasks ({len(tasks)}):")
        for task in tasks:
            marker = " <-- CURRENT TASK" if task.assignment_task_uuid == assignment_task_uuid else ""
            lines.append(f"- {task.assignment_task_uuid}: {task.title} [{task.assignment_type.value}]{marker}")
            if task.description:
                lines.append(f"  {task.description[:800]}")
            if task.assignment_type.value == "CODE":
                contents = task.contents or {}
                if contents.get("starter_code"):
                    lines.append(f"  starter code:\n{contents['starter_code'][:2000]}")

        submission = (
            await db.execute(
                select(AssignmentUserSubmission).where(
                    AssignmentUserSubmission.assignment_id == assignment.id,
                    AssignmentUserSubmission.user_id == user_id,
                )
            )
        ).scalars().first()
        if submission:
            lines.append(
                f"Learner submission: status={submission.submission_status.value}, grade={submission.grade}"
            )
        if assignment_task_uuid:
            task = next(
                (item for item in tasks if item.assignment_task_uuid == assignment_task_uuid),
                None,
            )
            if task:
                task_submission = (
                    await db.execute(
                        select(AssignmentTaskSubmission).where(
                            AssignmentTaskSubmission.assignment_task_id == task.id,
                            AssignmentTaskSubmission.user_id == user_id,
                        )
                    )
                ).scalars().first()
                if task_submission:
                    lines.append(
                        "Learner answer for the current task: "
                        + str(task_submission.task_submission)[:2000]
                    )
                    if task_submission.task_submission_grade_feedback:
                        lines.append(
                            "Feedback: " + task_submission.task_submission_grade_feedback[:1000]
                        )
    return "\n".join(lines)


async def ask_roadmap_assistant(
    *,
    request: Request,
    course: Course,
    body: RoadmapAssistantRequest,
    current_user: PublicUser,
    db: AsyncSession,
) -> RoadmapAssistantResponse:
    tree, _index = await _course_tree(course, db)
    context = await _current_activity_context(
        course, body.activity_uuid, body.assignment_task_uuid, current_user.id, db
    )
    model_name = await resolve_model_for_org(course.org_id, db, purpose="planning")

    prompt = (
        f"Course: {course.name}\nDescription: {course.description or ''}\n"
        f"Course tree (JSON):\n{tree}\n\n"
        f"{context}\n\n"
        f"User message:\n{body.message}"
    )
    output: _AssistantOutput = await generate(
        model_name=model_name,
        user_prompt=prompt,
        system_prompt=SYSTEM_PROMPT,
        output_type=_AssistantOutput,
        temperature=0.3,
        timeout=120.0,
    )
    return RoadmapAssistantResponse(reply=output.reply, operations=output.operations)


async def _find_chapter(course: Course, chapter_uuid: str, db: AsyncSession) -> Chapter:
    chapter = (
        await db.execute(
            select(Chapter)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .where(
                Chapter.chapter_uuid == chapter_uuid,
                CourseChapter.course_id == course.id,
            )
        )
    ).scalars().first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found in this course")
    return chapter


async def _find_activity(course: Course, activity_uuid: str, db: AsyncSession) -> Activity:
    activity = (
        await db.execute(
            select(Activity).where(
                Activity.activity_uuid == activity_uuid,
                Activity.course_id == course.id,
            )
        )
    ).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found in this course")
    return activity


async def apply_operation(
    *,
    request: Request,
    course: Course,
    operation: RoadmapOperation,
    current_user: PublicUser,
    db: AsyncSession,
    model_name: Optional[str],
) -> AppliedOperation:
    action = operation.action
    try:
        if action == "add_chapter":
            if not operation.title:
                raise HTTPException(status_code=400, detail="title is required")
            await create_chapter(
                request,
                ChapterCreate(
                    name=operation.title,
                    description=operation.description or "",
                    org_id=course.org_id,
                    course_id=course.id,
                ),
                current_user,
                db,
            )
        elif action == "update_chapter":
            if not operation.chapter_uuid:
                raise HTTPException(status_code=400, detail="chapter_uuid is required")
            chapter = await _find_chapter(course, operation.chapter_uuid, db)
            await update_chapter(
                request,
                ChapterUpdate(
                    name=operation.title,
                    description=operation.description,
                ),
                chapter.id,
                current_user,
                db,
            )
        elif action == "delete_chapter":
            if not operation.chapter_uuid:
                raise HTTPException(status_code=400, detail="chapter_uuid is required")
            chapter = await _find_chapter(course, operation.chapter_uuid, db)
            await delete_chapter(request, chapter.id, current_user, db)
        elif action == "add_lesson":
            if not operation.chapter_uuid or not operation.title:
                raise HTTPException(
                    status_code=400, detail="chapter_uuid and title are required"
                )
            chapter = await _find_chapter(course, operation.chapter_uuid, db)
            document = markdown_to_prosemirror(operation.material)
            activity_read = await create_activity(
                request,
                ActivityCreate(
                    name=operation.title,
                    chapter_id=chapter.id,
                    activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                    activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                    content=document if operation.material else {},
                    details={"description": operation.description or ""},
                    published=bool(course.published),
                    extra_metadata={"roadmap": {"assistant": True}},
                ),
                current_user,
                db,
            )
            if not operation.material and model_name:
                markdown = await generate_lecture_markdown(
                    course_name=course.name,
                    course_description=course.description or "",
                    chapter_name=chapter.name,
                    chapter_description=chapter.description or "",
                    lesson_title=operation.title,
                    lesson_summary=operation.description or "",
                    material=None,
                    language="en",
                    model_name=model_name,
                )
                if not markdown.strip():
                    raise HTTPException(
                        status_code=502, detail="The model returned an empty lecture"
                    )
                await apply_generated_lecture(
                    db, course.id, activity_read.id, markdown
                )
        elif action == "update_lesson":
            if not operation.activity_uuid:
                raise HTTPException(status_code=400, detail="activity_uuid is required")
            activity = await _find_activity(course, operation.activity_uuid, db)
            if operation.material is not None:
                await _set_activity_content(
                    db, activity, markdown_to_prosemirror(operation.material)
                )
            update_fields = {}
            if operation.title is not None:
                update_fields["name"] = operation.title
            if operation.description is not None:
                update_fields["details"] = {"description": operation.description}
            if update_fields:
                await update_activity(
                    request,
                    ActivityUpdate(**update_fields),
                    activity.activity_uuid,
                    current_user,
                    db,
                )
        elif action == "delete_lesson":
            if not operation.activity_uuid:
                raise HTTPException(status_code=400, detail="activity_uuid is required")
            await delete_activity(
                request, operation.activity_uuid, current_user, db
            )
        elif action == "generate_lesson":
            if not operation.activity_uuid:
                raise HTTPException(status_code=400, detail="activity_uuid is required")
            if not model_name:
                raise HTTPException(status_code=503, detail="AI is not configured")
            activity = await _find_activity(course, operation.activity_uuid, db)
            chapter_id = (
                await db.execute(
                    select(ChapterActivity.chapter_id).where(
                        ChapterActivity.activity_id == activity.id
                    )
                )
            ).scalars().first()
            chapter = await db.get(Chapter, chapter_id) if chapter_id else None
            markdown = await generate_lecture_markdown(
                course_name=course.name,
                course_description=course.description or "",
                chapter_name=chapter.name if chapter else "",
                chapter_description=(chapter.description or "") if chapter else "",
                lesson_title=activity.name,
                lesson_summary=str((activity.details or {}).get("description") or ""),
                material=None,
                language="en",
                model_name=model_name,
            )
            if not markdown.strip():
                raise HTTPException(
                    status_code=502, detail="The model returned an empty lecture"
                )
            await apply_generated_lecture(db, course.id, activity.id, markdown)
        elif action == "add_task":
            if not operation.activity_uuid or not operation.task:
                raise HTTPException(
                    status_code=400, detail="activity_uuid and task are required"
                )
            activity = await _find_activity(course, operation.activity_uuid, db)
            if activity.activity_type != ActivityTypeEnum.TYPE_ASSIGNMENT:
                raise HTTPException(
                    status_code=400, detail="Tasks can only be added to a practice assignment"
                )
            from src.services.roadmap.tasks import task_errors

            errors = task_errors(operation.task)
            if errors:
                raise HTTPException(
                    status_code=400, detail="; ".join(errors)
                )
            await apply_generated_tasks(
                db,
                course.id,
                activity.id,
                [operation.task],
                published=bool(course.published),
                append=True,
            )
        elif action == "generate_tasks":
            if not operation.activity_uuid:
                raise HTTPException(status_code=400, detail="activity_uuid is required")
            if not model_name:
                raise HTTPException(status_code=503, detail="AI is not configured")
            activity = await _find_activity(course, operation.activity_uuid, db)
            if activity.activity_type != ActivityTypeEnum.TYPE_ASSIGNMENT:
                raise HTTPException(
                    status_code=400,
                    detail="Tasks can only be generated for a practice assignment",
                )
            chapter_id = (
                await db.execute(
                    select(ChapterActivity.chapter_id).where(
                        ChapterActivity.activity_id == activity.id
                    )
                )
            ).scalars().first()
            chapter = await db.get(Chapter, chapter_id) if chapter_id else None
            specs = await generate_lesson_tasks(
                course_name=course.name,
                chapter_name=chapter.name if chapter else "",
                lesson_title=activity.name.replace(" — Practice", ""),
                lesson_summary=str((activity.details or {}).get("description") or ""),
                material=None,
                language="en",
                model_name=model_name,
                num_tasks=DEFAULT_TASKS_PER_LESSON,
            )
            if not specs:
                raise HTTPException(
                    status_code=502,
                    detail="The model returned no valid tasks. Try again.",
                )
            await apply_generated_tasks(
                db,
                course.id,
                activity.id,
                specs,
                published=bool(course.published),
                append=True,
            )
        else:
            raise HTTPException(status_code=400, detail="Unknown action")
        return AppliedOperation(action=action, status="applied")
    except HTTPException as exc:
        return AppliedOperation(action=action, status="failed", detail=str(exc.detail))
    except Exception as exc:
        logger.exception("Roadmap operation %s failed", action)
        return AppliedOperation(action=action, status="failed", detail=str(exc))
