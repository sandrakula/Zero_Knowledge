"""Seed the built-in informatics course on every fresh deployment.

The course is part of the product, not an AI artifact: two blocks of problems
from informatics.msk.ru, theory, Markdown statements and Judge0 tests. The
fixture is exported from the working course and replayed here when the default
organization has no `informatics` course yet.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.courses.activities import Activity, ActivityLockType, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskTypeEnum, GradingTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course, ThumbnailType
from src.db.organizations import Organization

logger = logging.getLogger(__name__)

SEED_NAME = "informatics"
SEED_FILE = Path(__file__).with_name("informatics_seed.json")


def _json_value(value):
    """asyncpg returns JSON columns as strings; the fixture may store either."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value or {}


async def ensure_default_informatics_course() -> None:
    """Create the bundled course once; never raise into application startup."""
    if os.getenv("TESTING", "false").lower() == "true":
        return
    if not SEED_FILE.exists():
        return

    try:
        data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Could not read the bundled informatics course fixture")
        return

    try:
        async with _async_session_factory() as db:
            org = (
                await db.execute(select(Organization).where(Organization.slug == "default"))
            ).scalars().first()
            if org is None:
                org = (await db.execute(select(Organization).limit(1))).scalars().first()
            if org is None:
                return

            existing = (
                await db.execute(
                    select(Course).where(
                        Course.org_id == org.id,
                        Course.name == data["course"]["name"],
                    )
                )
            ).scalars().first()
            if existing is not None:
                return

            now = str(datetime.now())
            course = Course(
                name=data["course"]["name"],
                description=data["course"].get("description") or "",
                about=data["course"].get("about") or "",
                learnings=data["course"].get("learnings") or "",
                tags=data["course"].get("tags") or "",
                thumbnail_type=ThumbnailType.IMAGE,
                thumbnail_image="",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid=f"course_{uuid4()}",
                creation_date=now,
                update_date=now,
                extra_metadata={"seed": SEED_NAME},
            )
            db.add(course)
            await db.commit()
            await db.refresh(course)

            for chapter_index, chapter_data in enumerate(data.get("chapters") or []):
                chapter = Chapter(
                    name=chapter_data["name"],
                    description=chapter_data.get("description") or "",
                    lock_type=LockType.PUBLIC,
                    org_id=org.id,
                    course_id=course.id,
                    chapter_uuid=f"chapter_{uuid4()}",
                    creation_date=now,
                    update_date=now,
                )
                db.add(chapter)
                await db.commit()
                await db.refresh(chapter)

                db.add(
                    CourseChapter(
                        order=chapter_index,
                        course_id=course.id,
                        chapter_id=chapter.id,
                        org_id=org.id,
                        creation_date=now,
                        update_date=now,
                    )
                )
                await db.commit()

                for activity_index, activity_data in enumerate(chapter_data.get("activities") or []):
                    activity = Activity(
                        name=activity_data["name"],
                        activity_type=ActivityTypeEnum(activity_data["activity_type"]),
                        activity_sub_type=ActivitySubTypeEnum(activity_data["activity_sub_type"]),
                        content=_json_value(activity_data.get("content")),
                        details=_json_value(activity_data.get("details")),
                        extra_metadata=_json_value(activity_data.get("extra_metadata")),
                        published=True,
                        lock_type=ActivityLockType.PUBLIC,
                        course_id=course.id,
                        org_id=org.id,
                        activity_uuid=f"activity_{uuid4()}",
                        creation_date=now,
                        update_date=now,
                    )
                    db.add(activity)
                    await db.commit()
                    await db.refresh(activity)

                    db.add(
                        ChapterActivity(
                            order=activity_index,
                            chapter_id=chapter.id,
                            activity_id=activity.id,
                            course_id=course.id,
                            org_id=org.id,
                            creation_date=now,
                            update_date=now,
                        )
                    )
                    await db.commit()

                    assignment_data = activity_data.get("assignment")
                    if not assignment_data:
                        continue

                    assignment = Assignment(
                        title=assignment_data["title"],
                        description=assignment_data.get("description") or "",
                        published=True,
                        grading_type=GradingTypeEnum(
                            assignment_data.get("grading_type") or "PERCENTAGE"
                        ),
                        auto_grading=True,
                        org_id=org.id,
                        course_id=course.id,
                        chapter_id=chapter.id,
                        activity_id=activity.id,
                        assignment_uuid=f"assignment_{uuid4()}",
                        creation_date=now,
                        update_date=now,
                    )
                    db.add(assignment)
                    await db.commit()
                    await db.refresh(assignment)

                    for task_index, task_data in enumerate(assignment_data.get("tasks") or []):
                        db.add(
                            AssignmentTask(
                                title=task_data["title"],
                                description=task_data.get("description") or "",
                                hint=task_data.get("hint") or "",
                                assignment_type=AssignmentTaskTypeEnum(
                                    task_data["assignment_type"]
                                ),
                                contents=_json_value(task_data.get("contents")),
                                max_grade_value=int(task_data.get("max_grade_value") or 100),
                                order=task_index,
                                assignment_id=assignment.id,
                                org_id=org.id,
                                course_id=course.id,
                                chapter_id=chapter.id,
                                activity_id=activity.id,
                                assignment_task_uuid=f"assignmenttask_{uuid4()}",
                                creation_date=now,
                                update_date=now,
                            )
                        )
                    await db.commit()

            logger.info("Seeded the bundled informatics course for org %s", org.slug)
    except Exception:
        logger.exception("Failed to seed the bundled informatics course")
