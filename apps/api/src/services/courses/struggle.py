"""Class-level struggle map for CODE tasks.

Stock LearnHouse shows grades. This aggregates the durable attempt history into
the questions a teacher actually asks: which task is failing, which test case is
the wall, and which students are stuck on their latest attempt.
"""

from typing import Any, Dict, List

from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import (
    Assignment,
    AssignmentAttempt,
    AssignmentAttemptVerdict,
    AssignmentTask,
    AssignmentTaskTypeEnum,
)
from src.db.courses.courses import Course


class FailedTest(BaseModel):
    id: str
    label: str
    failures: int


class StruggleTask(BaseModel):
    assignment_uuid: str
    assignment_title: str
    assignment_task_uuid: str
    task_title: str
    attempts: int = 0
    accepted: int = 0
    wrong_answer: int = 0
    compilation_error: int = 0
    runtime_error: int = 0
    time_limit: int = 0
    memory_limit: int = 0
    other_errors: int = 0
    students_attempted: int = 0
    students_stuck: int = 0
    accepted_rate: float = 0.0
    top_failed_tests: List[FailedTest] = []


class StruggleMap(BaseModel):
    course_uuid: str
    course_name: str
    tasks: List[StruggleTask] = []


async def get_course_struggle_map(
    course_uuid: str, db_session: AsyncSession
) -> StruggleMap:
    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).scalars().first()
    if not course:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Course not found")

    assignments = (
        await db_session.execute(
            select(Assignment).where(Assignment.course_id == course.id)
        )
    ).scalars().all()
    assignment_map = {a.id: a for a in assignments}
    assignment_ids = [a.id for a in assignments if a.id is not None]

    if not assignment_ids:
        return StruggleMap(course_uuid=course.course_uuid, course_name=course.name, tasks=[])

    tasks = (
        await db_session.execute(
            select(AssignmentTask).where(
                AssignmentTask.assignment_id.in_(assignment_ids),  # type: ignore[attr-defined]
                AssignmentTask.assignment_type == AssignmentTaskTypeEnum.CODE,
            )
        )
    ).scalars().all()
    task_ids = [t.id for t in tasks if t.id is not None]
    if not task_ids:
        return StruggleMap(course_uuid=course.course_uuid, course_name=course.name, tasks=[])

    attempts = (
        await db_session.execute(
            select(AssignmentAttempt).where(
                AssignmentAttempt.assignment_task_id.in_(task_ids)  # type: ignore[attr-defined]
            )
        )
    ).scalars().all()

    by_task: Dict[int, List[AssignmentAttempt]] = {}
    for attempt in attempts:
        by_task.setdefault(attempt.assignment_task_id, []).append(attempt)

    rows: List[StruggleTask] = []
    for task in tasks:
        item_attempts = by_task.get(task.id or 0, [])
        assignment = assignment_map.get(task.assignment_id)
        row = StruggleTask(
            assignment_uuid=assignment.assignment_uuid if assignment else "",
            assignment_title=assignment.title if assignment else "",
            assignment_task_uuid=task.assignment_task_uuid,
            task_title=task.title,
            attempts=len(item_attempts),
        )
        if not item_attempts:
            rows.append(row)
            continue

        latest_by_user: Dict[int, AssignmentAttempt] = {}
        failed_tests: Dict[str, Dict[str, Any]] = {}
        for attempt in item_attempts:
            verdict = str(attempt.verdict)
            if verdict == AssignmentAttemptVerdict.ACCEPTED.value:
                row.accepted += 1
            elif verdict == AssignmentAttemptVerdict.WRONG_ANSWER.value:
                row.wrong_answer += 1
            elif verdict == AssignmentAttemptVerdict.COMPILATION_ERROR.value:
                row.compilation_error += 1
            elif verdict == AssignmentAttemptVerdict.RUNTIME_ERROR.value:
                row.runtime_error += 1
            elif verdict == AssignmentAttemptVerdict.TIME_LIMIT_EXCEEDED.value:
                row.time_limit += 1
            elif verdict == AssignmentAttemptVerdict.MEMORY_LIMIT_EXCEEDED.value:
                row.memory_limit += 1
            else:
                row.other_errors += 1

            current = latest_by_user.get(attempt.user_id)
            if current is None or (attempt.attempt_number or 0) > (current.attempt_number or 0):
                latest_by_user[attempt.user_id] = attempt

            for result in attempt.test_results or []:
                if not isinstance(result, dict) or result.get("passed"):
                    continue
                test_id = str(result.get("id") or "unknown")
                bucket = failed_tests.setdefault(
                    test_id,
                    {
                        "id": test_id,
                        "label": str(result.get("label") or test_id),
                        "failures": 0,
                    },
                )
                bucket["failures"] += 1

        row.students_attempted = len(latest_by_user)
        row.students_stuck = sum(
            1
            for latest in latest_by_user.values()
            if str(latest.verdict) != AssignmentAttemptVerdict.ACCEPTED.value
        )
        row.accepted_rate = (
            round((row.accepted / row.attempts) * 100, 1) if row.attempts else 0.0
        )
        row.top_failed_tests = [
            FailedTest(**bucket)
            for bucket in sorted(
                failed_tests.values(), key=lambda value: value["failures"], reverse=True
            )[:5]
        ]
        rows.append(row)

    rows.sort(key=lambda row: (row.students_stuck, row.attempts), reverse=True)
    return StruggleMap(course_uuid=course.course_uuid, course_name=course.name, tasks=rows)
