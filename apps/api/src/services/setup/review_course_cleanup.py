"""One-off cleanup for the leftover LearnHouse platform-tour course.

The demo instance ships a "Review Course: Platform Tour" walkthrough. It is not
part of the real programme, so it must not appear in course statistics or the
weighted KPI. Removing it here is idempotent: the fixed UUID only ever matches
that demo course, and a fresh install simply does nothing.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import delete, select

from src.core.events.database import _async_session_factory
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor
from src.db.stats import CourseStat, ProgramCourse, StatSnapshot, UserCourseStat

logger = logging.getLogger(__name__)

LEGACY_REVIEW_COURSE_UUID = "course_827ab2b5-4dea-43ff-839d-a37a57c36241"


async def remove_legacy_review_course(session_factory=None) -> Optional[dict]:
    factory = session_factory or _async_session_factory
    try:
        async with factory() as db:
            course = (
                await db.execute(
                    select(Course).where(
                        Course.course_uuid == LEGACY_REVIEW_COURSE_UUID
                    )
                )
            ).scalars().first()
            if course is None:
                return None
            course_id = int(course.id or 0)
            course_uuid = course.course_uuid
            course_name = course.name

            # These tables have no foreign key to `course`, so the database
            # cascade does not reach them.
            await db.execute(
                delete(UserCourseStat).where(UserCourseStat.course_id == course_id)
            )
            await db.execute(
                delete(CourseStat).where(CourseStat.course_id == course_id)
            )
            await db.execute(
                delete(StatSnapshot).where(
                    StatSnapshot.scope_type == "course",
                    StatSnapshot.scope_id == course_id,
                )
            )
            await db.execute(
                delete(ProgramCourse).where(ProgramCourse.course_id == course_id)
            )
            # Resource authors are keyed by UUID rather than a foreign key.
            await db.execute(
                delete(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid == course_uuid
                )
            )

            # Chapters, activities, trail runs/steps, assignments and the rest
            # cascade from `course`.
            await db.delete(course)
            await db.commit()
            report = {
                "course_id": course_id,
                "course_uuid": course_uuid,
                "course_name": course_name,
            }
            logger.info("Removed legacy review course: %s", report)
            return report
    except Exception:
        logger.exception("Legacy review course cleanup failed")
        return None
