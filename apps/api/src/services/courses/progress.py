"""Session-authenticated course progress / gradebook summary.

Unlike the Tinybird analytics tab, this endpoint works on a stock install: it
reads the transactional tables (TrailRun, Assignment, AssignmentTask,
AssignmentUserSubmission) and returns one row per enrolled learner, including
learners who have not submitted anything yet.
"""

from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.users import User


class CourseProgressAssignment(BaseModel):
    assignment_uuid: str
    title: str
    activity_uuid: Optional[str] = None
    required: bool = True
    published: bool = False
    due_date: Optional[str] = None
    max_grade: int = 0
    submission_status: str = "NOT_SUBMITTED"
    grade: int = 0
    attempt_number: int = 0
    is_late: bool = False


class CourseProgressStudent(BaseModel):
    user_id: int
    username: str
    email: str
    first_name: str
    last_name: str
    enrollment_status: Optional[str] = None
    completed_assignments: int = 0
    submitted_assignments: int = 0
    required_assignments: int = 0
    percent: float = 0.0
    assignments: List[CourseProgressAssignment] = []


class CourseProgressSummary(BaseModel):
    course_uuid: str
    course_name: str
    total_students: int
    page: int
    limit: int
    assignments: List[CourseProgressAssignment] = []
    students: List[CourseProgressStudent] = []


class MyTaskProgressEntry(BaseModel):
    total: int = 0
    solved: int = 0


class MyTaskProgress(BaseModel):
    activities: dict[str, MyTaskProgressEntry] = {}


async def get_course_progress_summary(
    course_uuid: str,
    db_session: AsyncSession,
    page: int = 1,
    limit: int = 50,
) -> CourseProgressSummary:
    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).scalars().first()
    if not course:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Course not found")

    assignment_rows = (
        await db_session.execute(
            select(Assignment, Activity.activity_uuid)
            .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
            .where(Assignment.course_id == course.id)
            .order_by(Assignment.id.asc())
        )
    ).all()
    assignment_ids = [assignment.id for assignment, _ in assignment_rows if assignment.id]

    max_grade_map: dict[int, int] = {}
    if assignment_ids:
        grade_rows = (
            await db_session.execute(
                select(
                    AssignmentTask.assignment_id,
                    func.coalesce(func.sum(AssignmentTask.max_grade_value), 0),
                )
                .where(AssignmentTask.assignment_id.in_(assignment_ids))  # type: ignore[attr-defined]
                .group_by(AssignmentTask.assignment_id)
            )
        ).all()
        max_grade_map = {row[0]: int(row[1] or 0) for row in grade_rows}

    # Enrollment is a TrailRun. Include learners who have submissions without a
    # run too, so a teacher never loses a student from the table.
    trail_user_ids = {
        row[0]
        for row in (
            await db_session.execute(
                select(TrailRun.user_id).where(TrailRun.course_id == course.id)
            )
        ).all()
    }
    submission_user_ids: set[int] = set()
    if assignment_ids:
        submission_user_ids = {
            row[0]
            for row in (
                await db_session.execute(
                    select(AssignmentUserSubmission.user_id).where(
                        AssignmentUserSubmission.assignment_id.in_(assignment_ids)  # type: ignore[attr-defined]
                    )
                )
            ).all()
        }
    user_ids = sorted(trail_user_ids | submission_user_ids)
    total_students = len(user_ids)

    page = max(1, int(page))
    limit = max(1, min(int(limit), 200))
    page_ids = user_ids[(page - 1) * limit: page * limit]

    users = {
        user.id: user
        for user in (
            await db_session.execute(select(User).where(User.id.in_(page_ids)))  # type: ignore[attr-defined]
        ).scalars().all()
    } if page_ids else {}

    runs = {
        run.user_id: run
        for run in (
            await db_session.execute(
                select(TrailRun).where(
                    TrailRun.course_id == course.id,
                    TrailRun.user_id.in_(page_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all()
    } if page_ids else {}

    submissions: dict[tuple[int, int], AssignmentUserSubmission] = {}
    if page_ids and assignment_ids:
        for submission in (
            await db_session.execute(
                select(AssignmentUserSubmission).where(
                    AssignmentUserSubmission.user_id.in_(page_ids),  # type: ignore[attr-defined]
                    AssignmentUserSubmission.assignment_id.in_(assignment_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            submissions[(submission.user_id, submission.assignment_id)] = submission

    assignment_cards = [
        CourseProgressAssignment(
            assignment_uuid=assignment.assignment_uuid,
            title=assignment.title,
            activity_uuid=activity_uuid,
            required=assignment.is_required is not False,
            published=bool(assignment.published),
            due_date=assignment.due_date,
            max_grade=max_grade_map.get(assignment.id or 0, 0),
        )
        for assignment, activity_uuid in assignment_rows
    ]
    assignment_card_map = {card.assignment_uuid: card for card in assignment_cards}

    students: List[CourseProgressStudent] = []
    for user_id in page_ids:
        user = users.get(user_id)
        if not user:
            continue
        run = runs.get(user_id)
        cards: List[CourseProgressAssignment] = []
        completed = submitted = required = 0
        for assignment, _activity_uuid in assignment_rows:
            base_card = assignment_card_map.get(assignment.assignment_uuid)
            if base_card is None:
                continue
            card = base_card.model_copy()
            if card.required:
                required += 1
            submission = submissions.get((user_id, assignment.id or 0))
            if submission is not None:
                card.submission_status = (
                    submission.submission_status.value
                    if hasattr(submission.submission_status, "value")
                    else str(submission.submission_status)
                )
                card.grade = int(submission.grade or 0)
                card.attempt_number = int(submission.attempt_number or 0)
                card.is_late = bool(getattr(submission, "is_late", False))
                if card.submission_status in (
                    AssignmentUserSubmissionStatus.SUBMITTED.value,
                    AssignmentUserSubmissionStatus.GRADED.value,
                    AssignmentUserSubmissionStatus.LATE.value,
                    AssignmentUserSubmissionStatus.PENDING.value,
                ):
                    submitted += 1
                if card.submission_status == AssignmentUserSubmissionStatus.GRADED.value:
                    completed += 1
            cards.append(card)
        percent = round((completed / len(assignment_rows)) * 100, 1) if assignment_rows else 0.0
        students.append(
            CourseProgressStudent(
                user_id=user.id or 0,
                username=user.username,
                email=user.email,
                first_name=user.first_name or "",
                last_name=user.last_name or "",
                enrollment_status=run.status.value if run and hasattr(run.status, "value") else (str(run.status) if run else None),
                completed_assignments=completed,
                submitted_assignments=submitted,
                required_assignments=required,
                percent=percent,
                assignments=cards,
            )
        )

    students.sort(key=lambda item: ((item.last_name or item.username).lower(), item.username.lower()))

    return CourseProgressSummary(
        course_uuid=course.course_uuid,
        course_name=course.name,
        total_students=total_students,
        page=page,
        limit=limit,
        assignments=assignment_cards,
        students=students,
    )


async def get_my_task_progress(
    course_uuid: str,
    user_id: int,
    db_session: AsyncSession,
) -> MyTaskProgress:
    """Per-activity solved/total CODE task counts for one learner.

    ``solved`` means a stored task submission whose grade reached the task's
    maximum. The course page renders these next to each chapter/assignment.
    """
    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).scalars().first()
    if not course:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Course not found")

    assignment_rows = (
        await db_session.execute(
            select(Assignment.id, Activity.activity_uuid)
            .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
            .where(Assignment.course_id == course.id)
        )
    ).all()
    assignment_to_activity = {
        int(assignment_id): activity_uuid
        for assignment_id, activity_uuid in assignment_rows
        if assignment_id is not None and activity_uuid
    }
    if not assignment_to_activity:
        return MyTaskProgress(activities={})

    task_rows = (
        await db_session.execute(
            select(
                AssignmentTask.id,
                AssignmentTask.assignment_id,
                AssignmentTask.max_grade_value,
            ).where(
                AssignmentTask.assignment_id.in_(  # type: ignore[attr-defined]
                    list(assignment_to_activity)
                )
            )
        )
    ).all()
    task_max = {
        int(task_id): int(max_grade or 0)
        for task_id, _assignment_id, max_grade in task_rows
        if task_id is not None
    }
    per_activity_total: dict[str, int] = {}
    for _task_id, assignment_id, _max_grade in task_rows:
        activity_uuid = assignment_to_activity.get(int(assignment_id))
        if activity_uuid:
            per_activity_total[activity_uuid] = per_activity_total.get(activity_uuid, 0) + 1

    solved_ids: set[int] = set()
    if task_max:
        submission_rows = (
            await db_session.execute(
                select(
                    AssignmentTaskSubmission.assignment_task_id,
                    AssignmentTaskSubmission.grade,
                ).where(
                    AssignmentTaskSubmission.user_id == user_id,
                    AssignmentTaskSubmission.assignment_task_id.in_(  # type: ignore[attr-defined]
                        list(task_max)
                    ),
                )
            )
        ).all()
        solved_ids = {
            int(task_id)
            for task_id, grade in submission_rows
            if task_id is not None
            and task_max.get(int(task_id), 0) > 0
            and int(grade or 0) >= task_max[int(task_id)]
        }

    per_activity_solved: dict[str, int] = {}
    for task_id in solved_ids:
        assignment_id = next(
            (
                int(assignment_id)
                for tid, assignment_id, _max_grade in task_rows
                if int(tid) == task_id
            ),
            None,
        )
        if assignment_id is None:
            continue
        activity_uuid = assignment_to_activity.get(assignment_id)
        if activity_uuid:
            per_activity_solved[activity_uuid] = per_activity_solved.get(activity_uuid, 0) + 1

    return MyTaskProgress(
        activities={
            activity_uuid: MyTaskProgressEntry(
                total=total,
                solved=per_activity_solved.get(activity_uuid, 0),
            )
            for activity_uuid, total in per_activity_total.items()
        }
    )
