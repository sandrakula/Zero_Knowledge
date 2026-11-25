"""Credit an accepted Informatics verdict into the course.

The Informatics verdict is authoritative for a task that carries a
``informatics_problem_id``. The task row is marked as manually graded so the
normal grading pass does not re-run hidden local tests and overwrite the
verdict. The assignment is finalized only when every task has a submission, so
a multi-task assignment is not stamped GRADED prematurely.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.informatics import InformaticsSubmission
from src.services.courses.activities.assignments import _apply_grade_and_finalize


def _now() -> str:
    return datetime.now().isoformat()


async def credit_accepted_submission(
    db: AsyncSession, row: InformaticsSubmission
) -> bool:
    """Return True when the task is now credited. Idempotent."""
    if row.credited:
        return True
    if not row.solved:
        return False

    task: AssignmentTask | None = None
    if row.assignment_task_uuid:
        task = (
            await db.execute(
                select(AssignmentTask).where(
                    AssignmentTask.assignment_task_uuid == row.assignment_task_uuid
                )
            )
        ).scalars().first()
    if task is None:
        # No linked LMS task (userscript-only legacy row). Nothing to credit.
        row.credited = True
        row.credited_at = _now()
        db.add(row)
        await db.commit()
        return True

    assignment = (
        await db.execute(
            select(Assignment).where(Assignment.id == task.assignment_id)
        )
    ).scalars().first()
    if assignment is None:
        row.credited = True
        row.credited_at = _now()
        db.add(row)
        await db.commit()
        return True
    course = (
        await db.execute(
            select(Course).where(Course.id == assignment.course_id)
        )
    ).scalars().first()

    now = _now()
    task_submission = (
        await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == row.user_id,
                AssignmentTaskSubmission.assignment_task_id == task.id,
            )
        )
    ).scalars().first()
    if task_submission is None:
        task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid=f"assignmenttasksubmission_{row.submission_uuid}",
            task_submission={},
            grade=0,
            task_submission_grade_feedback="",
            manually_graded=False,
            assignment_type=task.assignment_type,
            user_id=row.user_id,
            activity_id=task.activity_id,
            course_id=task.course_id,
            chapter_id=task.chapter_id,
            assignment_task_id=int(task.id),
            creation_date=now,
            update_date=now,
        )
        db.add(task_submission)

    payload = dict(task_submission.task_submission or {})
    payload["source_code"] = row.source_code
    payload["informatics"] = {
        "problem_id": row.problem_id,
        "run_id": row.run_id,
        "ejudge_status": row.ejudge_status,
        "verdict": row.verdict,
    }
    task_submission.task_submission = payload
    task_submission.grade = int(task.max_grade_value or 100)
    task_submission.task_submission_grade_feedback = "Informatics: accepted"
    task_submission.manually_graded = True
    task_submission.update_date = now
    db.add(task_submission)
    await db.flush()

    # Finalize the assignment only when every task has a submission. One-task
    # assignments (the common Informatics case) finalize immediately.
    tasks = list(
        (
            await db.execute(
                select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id)
            )
        ).scalars().all()
    )
    task_ids = [int(t.id) for t in tasks if t.id is not None]
    submitted_count = 0
    if task_ids:
        submitted_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(AssignmentTaskSubmission)
                    .where(
                        AssignmentTaskSubmission.user_id == row.user_id,
                        AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
                    )
                )
            ).scalar_one()
        )

    if (
        course is not None
        and not assignment.ungraded
        and tasks
        and submitted_count >= len(tasks)
    ):
        user_submission = (
            await db.execute(
                select(AssignmentUserSubmission).where(
                    AssignmentUserSubmission.user_id == row.user_id,
                    AssignmentUserSubmission.assignment_id == assignment.id,
                )
            )
        ).scalars().first()
        if user_submission is None:
            user_submission = AssignmentUserSubmission(
                user_id=row.user_id,
                assignment_id=int(assignment.id),
                grade=0,
                assignmentusersubmission_uuid=f"assignmentusersubmission_{row.submission_uuid}",
                submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
                attempt_number=1,
                creation_date=now,
                update_date=now,
            )
            db.add(user_submission)
            await db.flush()
        elif user_submission.submission_status not in (
            AssignmentUserSubmissionStatus.SUBMITTED,
            AssignmentUserSubmissionStatus.GRADED,
        ):
            user_submission.submission_status = AssignmentUserSubmissionStatus.SUBMITTED
            db.add(user_submission)
            await db.flush()

        await _apply_grade_and_finalize(
            assignment,
            course,
            row.user_id,
            user_submission,
            db,
            auto_graded=False,
            dispatch_webhook=False,
            assignment_tasks=tasks,
        )

    row.credited = True
    row.credited_at = now
    db.add(row)
    await db.commit()
    return True
