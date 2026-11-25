"""Practice state: recording attempts, projecting mastery and building feeds."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.practice import ItemCalibration, PracticeAttempt, UserTopicMastery
from src.services.practice.hooks import record_grading_attempts
from src.services.practice.state import (
    AttemptInput,
    build_today,
    get_state,
    record_attempts,
)


async def _make_task(
    db,
    *,
    org,
    course,
    chapter,
    activity,
    assignment,
    uuid: str,
    topic_key: str,
    level: int = 1,
    contents: dict | None = None,
) -> AssignmentTask:
    task = AssignmentTask(
        assignment_task_uuid=uuid,
        title=f"Task {uuid}",
        description="Solve it",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents=contents
        or {
            "_meta": {"topic_key": topic_key, "level": level},
            "starter_code": "print()",
            "language_id": 71,
            "test_cases": [
                {
                    "id": "tc_1",
                    "stdin": "1",
                    "expectedStdout": "1",
                    "hidden": False,
                }
            ],
            "solution_code": "print(1)",
        },
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@pytest.mark.asyncio
async def test_record_attempts_upserts_and_projects_mastery(
    db, org, course, chapter, regular_user
):
    now = datetime.now()
    first = AttemptInput(
        user_id=regular_user.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        topic_key=chapter.chapter_uuid,
        task_uuid="task_1",
        task_type="CODE",
        level=1,
        score=1.0,
        passed=True,
        source_uuid="submission_1",
        graded_at=now.isoformat(timespec="seconds"),
        topic_name=chapter.name,
    )
    assert await record_attempts(db, [first]) == 1

    attempts = (
        await db.execute(select(PracticeAttempt).where(PracticeAttempt.user_id == regular_user.id))
    ).scalars().all()
    assert len(attempts) == 1

    mastery = (
        await db.execute(
            select(UserTopicMastery).where(UserTopicMastery.user_id == regular_user.id)
        )
    ).scalars().one()
    assert 0.6 < mastery.mastery < 0.7
    assert mastery.attempts == 1
    assert mastery.passed == 1
    assert mastery.next_review_at

    calibration = (
        await db.execute(
            select(ItemCalibration).where(ItemCalibration.task_uuid == "task_1")
        )
    ).scalars().one()
    assert calibration.attempts == 1
    assert calibration.passes == 1
    assert calibration.difficulty < 0

    # Re-grading the same submission updates the row instead of adding one.
    second = AttemptInput(**{**first.__dict__, "score": 0.0, "passed": False})
    assert await record_attempts(db, [second]) == 1
    attempts = (
        await db.execute(select(PracticeAttempt).where(PracticeAttempt.user_id == regular_user.id))
    ).scalars().all()
    assert len(attempts) == 1
    await db.refresh(mastery)
    assert mastery.mastery < 0.5
    assert mastery.attempts == 1
    assert mastery.passed == 0


@pytest.mark.asyncio
async def test_feed_carries_reasons_and_never_leaks_tests(
    db, org, course, chapter, regular_user
):
    activity = Activity(
        name="Practice",
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_practice",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    assignment = Assignment(
        title="Practice",
        description="",
        grading_type=GradingTypeEnum.PERCENTAGE,
        published=True,
        auto_grading=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_practice",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    for index in range(3):
        await _make_task(
            db,
            org=org,
            course=course,
            chapter=chapter,
            activity=activity,
            assignment=assignment,
            uuid=f"task_{index}",
            topic_key=chapter.chapter_uuid,
        )

    feed = await build_today(
        db,
        course=course,
        user_id=regular_user.id,
        org_id=org.id,
        limit=10,
    )
    assert feed["items_count"] >= 1
    payload = json.dumps(feed)
    assert "test_cases" not in payload
    assert "expectedStdout" not in payload
    assert "solution_code" not in payload
    for item in feed["items"]:
        assert item["reason"] in {"new", "weak", "review", "stretch", "practice"}
        assert 1 <= item["level"] <= 3
        assert item["xp"] > 0


@pytest.mark.asyncio
async def test_state_summary_and_streak(db, org, course, chapter, regular_user):
    now = datetime.now()
    attempts = [
        AttemptInput(
            user_id=regular_user.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            topic_key=chapter.chapter_uuid,
            task_uuid="task_1",
            task_type="QUIZ",
            level=1,
            score=0.8,
            passed=True,
            source_uuid="quiz_1",
            graded_at=now.isoformat(timespec="seconds"),
            topic_name=chapter.name,
        ),
        AttemptInput(
            user_id=regular_user.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            topic_key=chapter.chapter_uuid,
            task_uuid="task_2",
            task_type="CODE",
            level=2,
            score=0.4,
            passed=False,
            source_uuid="code_1",
            graded_at=(now - timedelta(days=1)).isoformat(timespec="seconds"),
            topic_name=chapter.name,
        ),
    ]
    assert await record_attempts(db, attempts) == 2

    state = await get_state(
        db, course=course, user_id=regular_user.id, org_id=org.id
    )
    assert state["summary"]["attempts"] == 2
    assert state["summary"]["active_days"] == 2
    assert state["summary"]["streak_days"] == 2
    assert len(state["topics"]) == 1
    assert state["topics"][0]["topic_key"] == chapter.chapter_uuid


@pytest.mark.asyncio
async def test_grading_hook_records_an_attempt(
    db, org, course, chapter, regular_user
):
    from types import SimpleNamespace

    activity = Activity(
        name="Hook practice",
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_hook",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    assignment = Assignment(
        title="Hook practice",
        description="",
        grading_type=GradingTypeEnum.PERCENTAGE,
        published=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_hook",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = await _make_task(
        db,
        org=org,
        course=course,
        chapter=chapter,
        activity=activity,
        assignment=assignment,
        uuid="task_hook",
        topic_key=chapter.chapter_uuid,
        level=2,
    )
    submission = SimpleNamespace(
        grade=80,
        update_date=str(datetime.now()),
        creation_date=str(datetime.now()),
        assignment_task_submission_uuid="ts_hook",
    )
    recorded = await record_grading_attempts(
        db,
        assignment=assignment,
        course=course,
        user_id=regular_user.id,
        assignment_tasks=[task],
        task_submissions_by_task_id={task.id: submission},
        grade_breakdown=[
            {
                "assignment_task_uuid": task.assignment_task_uuid,
                "passed": True,
            }
        ],
    )
    assert recorded == 1

    attempt = (
        await db.execute(
            select(PracticeAttempt).where(
                PracticeAttempt.user_id == regular_user.id,
                PracticeAttempt.source_uuid == "ts_hook",
            )
        )
    ).scalars().one()
    assert attempt.score == pytest.approx(0.8)
    assert attempt.passed is True
    assert attempt.level == 2
    assert attempt.topic_key == chapter.chapter_uuid
    assert attempt.activity_uuid == "activity_hook"
    assert attempt.assignment_uuid == "assignment_hook"

    mastery = (
        await db.execute(
            select(UserTopicMastery).where(UserTopicMastery.user_id == regular_user.id)
        )
    ).scalars().one()
    assert mastery.mastery > 0.5
