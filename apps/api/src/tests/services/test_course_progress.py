"""Course progress / gradebook summary service tests."""

from datetime import datetime

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.services.courses.progress import get_course_progress_summary


def _now():
    return str(datetime.now())


async def _activity(db, org, course, chapter, *, id, uuid, published=True):
    activity = Activity(
        id=id,
        name=f"Activity {id}",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(activity)
    await db.commit()
    db.add(
        ChapterActivity(
            order=id,
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=_now(),
            update_date=_now(),
        )
    )
    await db.commit()
    return activity


async def _enroll(db, org, course, user, *, suffix):
    trail = Trail(
        org_id=org.id,
        user_id=user.id,
        trail_uuid=f"trail_progress_{suffix}",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(trail)
    await db.commit()
    run = TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=org.id,
        user_id=user.id,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(run)
    await db.commit()
    return run


@pytest.mark.asyncio
async def test_summary_includes_non_submitters_and_graded_rows(
    db, org, course, chapter, admin_user, regular_user
):
    first = await _activity(db, org, course, chapter, id=501, uuid="activity_progress_501")
    second = await _activity(db, org, course, chapter, id=502, uuid="activity_progress_502")

    assignment = Assignment(
        title="Required work",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=True,
        is_required=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=second.id,
        assignment_uuid="assignment_progress_required",
        creation_date=_now(),
        update_date=_now(),
    )
    optional = Assignment(
        title="Optional work",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=True,
        is_required=False,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=first.id,
        assignment_uuid="assignment_progress_optional",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(assignment)
    db.add(optional)
    await db.commit()

    for item in (assignment, optional):
        db.add(
            AssignmentTask(
                title="Task",
                description="",
                hint="",
                assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
                contents={},
                max_grade_value=100,
                assignment_task_uuid=f"assignmenttask_{item.assignment_uuid}",
                assignment_id=item.id,
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=item.activity_id,
                creation_date=_now(),
                update_date=_now(),
            )
        )
    await db.commit()

    await _enroll(db, org, course, admin_user, suffix="admin")
    await _enroll(db, org, course, regular_user, suffix="regular")

    db.add(
        AssignmentUserSubmission(
            assignmentusersubmission_uuid="assignmentusersubmission_progress_admin",
            submission_status=AssignmentUserSubmissionStatus.GRADED,
            grade=80,
            attempt_number=2,
            is_late=True,
            user_id=admin_user.id,
            assignment_id=assignment.id,
            creation_date=_now(),
            update_date=_now(),
        )
    )
    await db.commit()

    summary = await get_course_progress_summary(course.course_uuid, db)

    assert summary.total_students == 2
    rows = {row.user_id: row for row in summary.students}
    assert rows[admin_user.id].completed_assignments == 1
    assert rows[admin_user.id].required_assignments == 1
    assert rows[admin_user.id].percent == 50.0

    admin_required = next(
        card for card in rows[admin_user.id].assignments
        if card.assignment_uuid == assignment.assignment_uuid
    )
    assert admin_required.submission_status == "GRADED"
    assert admin_required.grade == 80
    assert admin_required.attempt_number == 2
    assert admin_required.is_late is True

    regular_required = next(
        card for card in rows[regular_user.id].assignments
        if card.assignment_uuid == assignment.assignment_uuid
    )
    assert regular_required.submission_status == "NOT_SUBMITTED"
    assert rows[regular_user.id].completed_assignments == 0


@pytest.mark.asyncio
async def test_summary_404_for_unknown_course(db):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await get_course_progress_summary("course_missing", db)
    assert exc.value.status_code == 404
