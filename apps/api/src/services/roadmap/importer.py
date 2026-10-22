"""Roadmap import: create or merge a course structure, then queue generation.

The course/chapter/activity rows are written synchronously so the caller gets a
usable course immediately; only missing lecture bodies and task sets are deferred
to the background job. Merging is name-based and idempotent: an existing lesson
with content is never overwritten, an empty one is filled, and a matching
practice assignment is reused instead of duplicated.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, ChapterCreate
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.roadmaps import RoadmapItemKind, RoadmapItemState
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.services.ai.rag.queue import index_activity
from src.services.courses.activities.activities import create_activity
from src.services.courses.chapters import create_chapter
from src.services.courses.courses import create_course
from src.services.roadmap.markdown import markdown_is_empty, markdown_to_prosemirror
from src.services.roadmap.schema import (
    RoadmapSpec,
    RoadmapTaskSpec,
)
from src.services.roadmap.tasks import task_contents, valid_tasks

logger = logging.getLogger(__name__)

PRACTICE_SUFFIX = "— Practice"


def _normalize_name(value: str) -> str:
    return " ".join((value or "").split()).casefold()


def practice_name(lesson_title: str) -> str:
    return f"{lesson_title} {PRACTICE_SUFFIX}"


async def _chapter_map(course_id: int, db: AsyncSession) -> Dict[str, Chapter]:
    rows = (
        await db.execute(
            select(Chapter)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .where(CourseChapter.course_id == course_id)
            .order_by(CourseChapter.order.asc())
        )
    ).scalars().all()
    return {_normalize_name(chapter.name): chapter for chapter in rows}


async def _activity_map(
    course_id: int, db: AsyncSession
) -> Dict[Tuple[int, str], Activity]:
    rows = (
        await db.execute(
            select(Activity, ChapterActivity.chapter_id)
            .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
            .where(Activity.course_id == course_id)
        )
    ).all()
    return {
        (chapter_id, _normalize_name(activity.name)): activity
        for activity, chapter_id in rows
    }


def _has_content(activity: Activity) -> bool:
    return not markdown_is_empty(activity.content if isinstance(activity.content, dict) else None)


async def _set_activity_content(db: AsyncSession, activity: Activity, document: dict) -> None:
    activity.content = document
    activity.update_date = str(datetime.now())
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(activity, "content")
    db.add(activity)
    await db.commit()
    index_activity(activity.id)


async def apply_generated_lecture(
    db: AsyncSession, course_id: int, activity_id: int, markdown: str
) -> None:
    activity = (
        await db.execute(
            select(Activity).where(Activity.id == activity_id, Activity.course_id == course_id)
        )
    ).scalars().first()
    if not activity:
        raise RuntimeError("Lecture activity no longer exists")
    if _has_content(activity):
        return
    await _set_activity_content(db, activity, markdown_to_prosemirror(markdown))


async def _assignment_for_activity(
    db: AsyncSession, activity_id: int
) -> Optional[Assignment]:
    return (
        await db.execute(select(Assignment).where(Assignment.activity_id == activity_id))
    ).scalars().first()


async def _create_assignment(
    db: AsyncSession,
    activity: Activity,
    chapter_id: int,
    published: bool,
) -> Assignment:
    now = str(datetime.now())
    assignment = Assignment(
        title=activity.name,
        description=str((activity.details or {}).get("description") or ""),
        due_date=None,
        published=published,
        grading_type=GradingTypeEnum.PERCENTAGE,
        auto_grading=True,
        allow_retries=True,
        max_retries=0,
        show_correct_answers=True,
        org_id=activity.org_id,
        course_id=activity.course_id,
        chapter_id=chapter_id,
        activity_id=activity.id,
        assignment_uuid=f"assignment_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    try:
        from src.security.features_utils.usage import increase_feature_usage

        await increase_feature_usage("assignments", activity.org_id, db)
    except Exception:
        logger.warning("Could not record assignment usage", exc_info=True)
    return assignment


async def apply_generated_tasks(
    db: AsyncSession,
    course_id: int,
    activity_id: int,
    specs: List[RoadmapTaskSpec],
    *,
    published: bool = False,
    append: bool = False,
) -> List[AssignmentTask]:
    """Create an assignment (if needed) and append the given tasks.

    ``append=False`` keeps the import idempotent: a practice activity that
    already has tasks is left untouched. The roadmap assistant passes
    ``append=True`` to add one more task without duplicating existing ones.
    """
    activity = (
        await db.execute(
            select(Activity).where(Activity.id == activity_id, Activity.course_id == course_id)
        )
    ).scalars().first()
    if not activity:
        raise RuntimeError("Practice activity no longer exists")

    chapter_id = (
        await db.execute(
            select(ChapterActivity.chapter_id).where(
                ChapterActivity.activity_id == activity_id
            )
        )
    ).scalars().first()
    if chapter_id is None:
        raise RuntimeError("Practice activity is not linked to a chapter")

    assignment = await _assignment_for_activity(db, activity_id)
    if assignment is None:
        assignment = await _create_assignment(db, activity, chapter_id, published)

    existing = (
        await db.execute(
            select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id)
        )
    ).scalars().all()
    if existing and not append:
        return list(existing)

    accepted, rejected = valid_tasks(specs)
    if rejected:
        logger.warning("Skipping invalid tasks for activity %s: %s", activity_id, rejected)

    now = str(datetime.now())
    created: List[AssignmentTask] = []
    start_order = len(existing)
    for offset, spec in enumerate(accepted):
        task = AssignmentTask(
            title=spec.title,
            description=spec.description,
            hint=spec.hint,
            assignment_type=AssignmentTaskTypeEnum(spec.type.value),
            contents=task_contents(spec),
            max_grade_value=100,
            assignment_task_uuid=f"assignmenttask_{uuid4()}",
            order=start_order + offset,
            creation_date=now,
            update_date=now,
            assignment_id=assignment.id,
            org_id=activity.org_id,
            course_id=course_id,
            chapter_id=chapter_id,
            activity_id=activity_id,
        )
        db.add(task)
        created.append(task)
    await db.commit()
    index_activity(activity_id)
    return created


async def import_roadmap(
    *,
    request: Request,
    spec: RoadmapSpec,
    org_id: int,
    course_uuid: Optional[str],
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db: AsyncSession,
    generate_missing: bool,
    publish: bool,
) -> Tuple[Course, List[dict], int, int, int]:
    """Create/merge the structure. Returns course, pending items, counts."""
    created = updated = skipped = 0

    if course_uuid:
        course = (
            await db.execute(select(Course).where(Course.course_uuid == course_uuid))
        ).scalars().first()
        if not course or course.org_id != org_id:
            raise ValueError("Course not found in this organization")
    else:
        from src.db.courses.courses import CourseCreate

        course_read = await create_course(
            request,
            org_id,
            CourseCreate(
                name=spec.title,
                description=spec.description,
                about=spec.description,
                learnings="",
                tags="|".join(spec.tags),
                public=False,
                published=publish,
                open_to_contributors=False,
                org_id=org_id,
            ),
            current_user,
            db,
        )
        course = (
            await db.execute(select(Course).where(Course.id == course_read.id))
        ).scalars().first()
        if not course:
            raise RuntimeError("Course creation failed")
        created += 1

    chapters = await _chapter_map(course.id, db)
    activities = await _activity_map(course.id, db)
    pending: List[dict] = []

    for chapter_index, chapter_spec in enumerate(spec.chapters):
        key = _normalize_name(chapter_spec.title)
        chapter = chapters.get(key)
        if chapter is None:
            chapter_read = await create_chapter(
                request,
                ChapterCreate(
                    name=chapter_spec.title,
                    description=chapter_spec.description,
                    org_id=course.org_id,
                    course_id=course.id,
                ),
                current_user,
                db,
            )
            chapter = (
                await db.execute(select(Chapter).where(Chapter.id == chapter_read.id))
            ).scalars().first()
            if not chapter:
                raise RuntimeError("Chapter creation failed")
            chapters[key] = chapter
            created += 1

        for lesson_index, lesson in enumerate(chapter_spec.lessons):
            lesson_key = f"{chapter_index}:{lesson_index}"
            lecture_key = _normalize_name(lesson.title)
            existing = activities.get((chapter.id, lecture_key))

            document = markdown_to_prosemirror(lesson.material)
            material_provided = bool(lesson.material and lesson.material.strip())

            if existing is None:
                activity_read = await create_activity(
                    request,
                    ActivityCreate(
                        name=lesson.title,
                        chapter_id=chapter.id,
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                        content=document if material_provided else {},
                        details={"description": lesson.summary},
                        published=publish,
                        extra_metadata={
                            "roadmap": {
                                "lesson_key": lesson_key,
                                "kind": RoadmapItemKind.LECTURE.value,
                            }
                        },
                    ),
                    current_user,
                    db,
                )
                activity = (
                    await db.execute(
                        select(Activity).where(Activity.id == activity_read.id)
                    )
                ).scalars().first()
                if not activity:
                    raise RuntimeError("Activity creation failed")
                created += 1
                if not material_provided and generate_missing and lesson.generate:
                    pending.append(
                        {
                            "key": lesson_key,
                            "kind": RoadmapItemKind.LECTURE.value,
                            "activity_uuid": activity.activity_uuid,
                            "activity_id": activity.id,
                            "title": lesson.title,
                            "state": RoadmapItemState.PENDING.value,
                            "published": publish,
                        }
                    )
            else:
                activity = existing
                if material_provided and not _has_content(activity):
                    await _set_activity_content(db, activity, document)
                    updated += 1
                elif not _has_content(activity) and generate_missing and lesson.generate:
                    pending.append(
                        {
                            "key": lesson_key,
                            "kind": RoadmapItemKind.LECTURE.value,
                            "activity_uuid": activity.activity_uuid,
                            "activity_id": activity.id,
                            "title": lesson.title,
                            "state": RoadmapItemState.PENDING.value,
                            "published": publish,
                        }
                    )
                else:
                    skipped += 1

            if not lesson.tasks and (not generate_missing or not lesson.generate):
                continue

            practice_key = _normalize_name(practice_name(lesson.title))
            practice_entry = activities.get((chapter.id, practice_key))
            if practice_entry is None:
                practice_read = await create_activity(
                    request,
                    ActivityCreate(
                        name=practice_name(lesson.title),
                        chapter_id=chapter.id,
                        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
                        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
                        content={},
                        details={
                            "description": f"Practice for {lesson.title}",
                        },
                        published=publish,
                        extra_metadata={
                            "roadmap": {
                                "lesson_key": lesson_key,
                                "kind": RoadmapItemKind.TASKS.value,
                            }
                        },
                    ),
                    current_user,
                    db,
                )
                practice = (
                    await db.execute(
                        select(Activity).where(Activity.id == practice_read.id)
                    )
                ).scalars().first()
                if not practice:
                    raise RuntimeError("Practice activity creation failed")
                created += 1
                if lesson.tasks:
                    await apply_generated_tasks(
                        db, course.id, practice.id, lesson.tasks, published=publish
                    )
                else:
                    pending.append(
                        {
                            "key": lesson_key,
                            "kind": RoadmapItemKind.TASKS.value,
                            "activity_uuid": practice.activity_uuid,
                            "activity_id": practice.id,
                            "title": practice_name(lesson.title),
                            "state": RoadmapItemState.PENDING.value,
                            "published": publish,
                        }
                    )
            else:
                practice = practice_entry
                assignment = await _assignment_for_activity(db, practice.id)
                if assignment is not None:
                    skipped += 1
                elif lesson.tasks:
                    await apply_generated_tasks(
                        db, course.id, practice.id, lesson.tasks, published=publish
                    )
                    updated += 1
                else:
                    pending.append(
                        {
                            "key": lesson_key,
                            "kind": RoadmapItemKind.TASKS.value,
                            "activity_uuid": practice.activity_uuid,
                            "activity_id": practice.id,
                            "title": practice.name,
                            "state": RoadmapItemState.PENDING.value,
                            "published": publish,
                        }
                    )

    return course, pending, created, updated, skipped
