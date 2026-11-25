"""Bridge from the existing grading pass into adaptive practice.

The grading choke point (``_apply_grade_and_finalize``) already knows the final
per-task grades and the assignment's pass threshold, so it hands them over here
instead of recomputing anything. Recording is best-effort: a missing migration
or a practice bug must never fail a grade.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, Sequence

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.practice.curriculum import (
    read_chapter_curriculum,
    read_task_meta,
)
from src.services.practice.state import (
    PRACTICE_ENABLED,
    AttemptInput,
    record_attempts,
)

logger = logging.getLogger(__name__)


def _task_type(task: AssignmentTask) -> str:
    return str(task.assignment_type).split(".")[-1]


async def record_grading_attempts(
    db_session: AsyncSession,
    *,
    assignment: Assignment,
    course: Course,
    user_id: int,
    assignment_tasks: Sequence[AssignmentTask],
    task_submissions_by_task_id: dict,
    grade_breakdown: Optional[Sequence[dict]] = None,
) -> int:
    """Record one practice attempt per graded task of this assignment."""
    if not PRACTICE_ENABLED or not assignment_tasks:
        return 0

    chapter_ids = {
        task.chapter_id for task in assignment_tasks if task.chapter_id is not None
    }
    chapters: dict[int, Chapter] = {}
    if chapter_ids:
        statement = select(Chapter).where(Chapter.id.in_(list(chapter_ids)))  # type: ignore[attr-defined]
        chapters = {
            chapter.id: chapter
            for chapter in (await db_session.execute(statement)).scalars().all()
        }

    breakdown = {
        row.get("assignment_task_uuid"): row
        for row in (grade_breakdown or [])
        if row.get("assignment_task_uuid")
    }

    activity_ids = {
        task.activity_id for task in assignment_tasks if task.activity_id is not None
    }
    activity_uuids: dict[int, str] = {}
    if activity_ids:
        statement = select(Activity.id, Activity.activity_uuid).where(
            Activity.id.in_(list(activity_ids))  # type: ignore[attr-defined]
        )
        activity_uuids = {
            row[0]: row[1] for row in (await db_session.execute(statement)).all()
        }

    attempts: list[AttemptInput] = []
    for task in assignment_tasks:
        submission = task_submissions_by_task_id.get(task.id)
        if submission is None:
            continue
        max_grade = int(task.max_grade_value or 0)
        raw_grade = int(submission.grade or 0)
        if max_grade > 0:
            score = max(0.0, min(1.0, raw_grade / max_grade))
        else:
            score = 1.0 if raw_grade > 0 else 0.0
        row = breakdown.get(task.assignment_task_uuid) or {}
        passed = bool(row.get("passed")) if row else score >= 0.6

        chapter = chapters.get(task.chapter_id) if task.chapter_id else None
        curriculum = read_chapter_curriculum(chapter)
        meta = read_task_meta(task)
        topic_key = (
            meta.get("topic_key")
            or curriculum.get("topic_key")
            or (chapter.chapter_uuid if chapter else f"chapter_{task.chapter_id}")
        )
        level = meta.get("level") or curriculum.get("level") or 1
        graded_at = (
            submission.update_date
            or submission.creation_date
            or datetime.now().isoformat(timespec="seconds")
        )
        source_uuid = (
            getattr(submission, "assignment_task_submission_uuid", "")
            or f"{assignment.assignment_uuid}:{task.id}:{user_id}"
        )
        attempts.append(
            AttemptInput(
                user_id=user_id,
                org_id=course.org_id,
                course_id=course.id,
                chapter_id=task.chapter_id,
                task_id=task.id,
                topic_key=topic_key,
                task_uuid=task.assignment_task_uuid,
                activity_uuid=activity_uuids.get(task.activity_id, ""),
                assignment_uuid=assignment.assignment_uuid,
                task_type=_task_type(task),
                level=int(level),
                score=score,
                passed=passed,
                source="assignment",
                source_uuid=source_uuid,
                graded_at=graded_at,
                topic_name=chapter.name if chapter else "",
            )
        )

    if not attempts:
        return 0
    return await record_attempts(db_session, attempts)
