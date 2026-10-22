"""The lesson AI context must include the learner's task without leaking keys."""

from datetime import datetime
from uuid import uuid4

import pytest

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.services.ai.ai import _assignment_ai_context

pytestmark = pytest.mark.asyncio


async def test_assignment_context_includes_learner_answer_without_answer_keys(
    db, org, course, chapter, admin_user
):
    activity = Activity(
        name="Practice",
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.flush()
    db.add(
        ChapterActivity(
            order=1,
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )

    assignment = Assignment(
        title="Practice",
        description="Desc",
        published=True,
        grading_type=GradingTypeEnum.PERCENTAGE,
        auto_grading=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid=f"assignment_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.flush()

    quiz = AssignmentTask(
        title="Quiz",
        description="Pick one",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.QUIZ,
        contents={
            "questions": [
                {
                    "questionText": "2+2?",
                    "options": [
                        {"text": "4", "assigned_right_answer": True},
                        {"text": "5", "assigned_right_answer": False},
                    ],
                }
            ]
        },
        assignment_task_uuid="assignmenttask_quiz",
        order=0,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )
    code = AssignmentTask(
        title="Sum",
        description="Read two ints",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={
            "solution_code": "print(a + b)",
            "test_cases": [
                {"stdin": "1 2\n", "expectedStdout": "3\n", "hidden": False},
                {"stdin": "2 2\n", "expectedStdout": "4\n", "hidden": True},
            ],
        },
        assignment_task_uuid="assignmenttask_code",
        order=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )
    db.add(quiz)
    db.add(code)
    await db.flush()

    db.add(
        AssignmentTaskSubmission(
            assignment_task_submission_uuid=f"sub_{uuid4()}",
            task_submission={"source_code": "print(3)"},
            grade=None,
            task_submission_grade_feedback="",
            assignment_type=AssignmentTaskTypeEnum.CODE,
            user_id=admin_user.id,
            activity_id=activity.id,
            course_id=course.id,
            chapter_id=chapter.id,
            assignment_task_id=code.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()

    from src.db.courses.activities import ActivityRead

    context = await _assignment_ai_context(
        ActivityRead.model_validate(activity),
        admin_user.id,
        db,
        "assignmenttask_code",
    )

    assert "CURRENT TASK" in context
    assert "print(3)" in context
    assert "solution_code" not in context
    assert "assigned_right_answer" not in context
    assert "2 2" not in context  # hidden test input is withheld
