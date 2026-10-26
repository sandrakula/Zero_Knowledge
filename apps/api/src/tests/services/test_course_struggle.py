"""Tests for the class struggle map aggregation."""

from datetime import datetime

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentAttempt,
    AssignmentAttemptVerdict,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.services.courses.struggle import get_course_struggle_map


def _now():
    return str(datetime.now())


async def _setup(db, org, course, chapter):
    activity = Activity(
        id=601,
        name="Code activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_struggle_601",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(activity)
    await db.commit()
    db.add(
        ChapterActivity(
            order=0,
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=_now(),
            update_date=_now(),
        )
    )
    assignment = Assignment(
        title="Struggle assignment",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=True,
        is_required=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_struggle",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(assignment)
    await db.commit()
    task = AssignmentTask(
        title="A+B",
        description="",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={"language_id": 71, "test_cases": []},
        max_grade_value=100,
        assignment_task_uuid="assignmenttask_struggle",
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return assignment, task


@pytest.mark.asyncio
async def test_struggle_map_counts_verdicts_and_failed_tests(
    db, org, course, chapter, admin_user, regular_user
):
    assignment, task = await _setup(db, org, course, chapter)

    db.add(
        AssignmentAttempt(
            attempt_uuid="attempt_struggle_1",
            user_id=admin_user.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=assignment.activity_id,
            assignment_id=assignment.id,
            assignment_task_id=task.id,
            attempt_number=1,
            source_code="print(1)",
            language_id=71,
            verdict=AssignmentAttemptVerdict.WRONG_ANSWER.value,
            passed_tests=1,
            total_tests=2,
            test_results=[
                {"id": "t1", "label": "Example 1", "passed": False},
                {"id": "t2", "label": "Hidden 1", "passed": True},
            ],
            created_date=_now(),
            update_date=_now(),
        )
    )
    db.add(
        AssignmentAttempt(
            attempt_uuid="attempt_struggle_2",
            user_id=regular_user.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=assignment.activity_id,
            assignment_id=assignment.id,
            assignment_task_id=task.id,
            attempt_number=1,
            source_code="print(2)",
            language_id=71,
            verdict=AssignmentAttemptVerdict.COMPILATION_ERROR.value,
            passed_tests=0,
            total_tests=2,
            test_results=[{"id": "t1", "label": "Example 1", "passed": False}],
            created_date=_now(),
            update_date=_now(),
        )
    )
    await db.commit()

    result = await get_course_struggle_map(course.course_uuid, db)

    assert len(result.tasks) == 1
    row = result.tasks[0]
    assert row.attempts == 2
    assert row.wrong_answer == 1
    assert row.compilation_error == 1
    assert row.students_attempted == 2
    assert row.students_stuck == 2
    assert row.top_failed_tests[0].id == "t1"
    assert row.top_failed_tests[0].failures == 2
