"""Tests for the course/global KPI aggregator."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.db.courses.courses import Course
from src.db.stats import LearningProgram, ProgramCourse
from src.services.stats.course_stats import (
    get_course_stats,
    get_global_stats,
    refresh_user_course_stats,
)


def _now() -> str:
    return datetime.now().isoformat()


@pytest.fixture
async def second_course(db, org):
    course = Course(
        name="Python labs",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_python_labs",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


@pytest.fixture
async def program(db, org):
    row = LearningProgram(
        org_id=org.id,
        name="Main programme",
        description="",
        is_active=True,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


class TestCourseKpi:
    async def test_available_course_enters_with_zero(
        self, db, org, course, second_course, program, regular_user, activity
    ):
        # One completed activity in the first course, nothing in the second.
        from src.db.trail_steps import TrailStep

        run = TrailStep(
            complete=True,
            teacher_verified=False,
            grade="",
            data={},
            trailrun_id=1,
            trail_id=1,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            user_id=regular_user.id,
            creation_date=_now(),
            update_date=_now(),
        )
        db.add(run)
        db.add_all(
            [
                ProgramCourse(
                    program_id=program.id,
                    course_id=course.id,
                    sequence_order=1,
                    weight=2.0,
                    unlock_after_course_id=None,
                    unlock_kpi_threshold=0,
                    include_in_global=True,
                    creation_date=_now(),
                    update_date=_now(),
                ),
                ProgramCourse(
                    program_id=program.id,
                    course_id=second_course.id,
                    sequence_order=2,
                    weight=1.0,
                    unlock_after_course_id=None,
                    unlock_kpi_threshold=0,
                    include_in_global=True,
                    creation_date=_now(),
                    update_date=_now(),
                ),
            ]
        )
        await db.commit()

        global_row = await refresh_user_course_stats(
            db, regular_user.id, org.id, program.id
        )
        assert global_row.courses_included == 2
        assert global_row.courses_started == 1
        assert global_row.courses_locked == 0
        # available course has KPI 0; only the started course contributes
        assert 0 < global_row.global_kpi < 100
        assert round(global_row.global_kpi, 2) == round(
            global_row.weighted_kpi_sum / global_row.weight_sum, 2
        )

        data = await get_global_stats(db, regular_user.id, org.id, program.id)
        assert [item["name"] for item in data["courses"]] == [
            "Test Course",
            "Python labs",
        ]
        python = next(item for item in data["courses"] if item["name"] == "Python labs")
        assert python["status"] == "available"
        assert python["course_kpi"] == 0.0
        assert python["included"] is True

    async def test_excluded_course_does_not_enter_global(
        self, db, org, course, second_course, program, regular_user
    ):
        db.add_all(
            [
                ProgramCourse(
                    program_id=program.id,
                    course_id=course.id,
                    sequence_order=1,
                    weight=1.0,
                    include_in_global=True,
                    creation_date=_now(),
                    update_date=_now(),
                ),
                ProgramCourse(
                    program_id=program.id,
                    course_id=second_course.id,
                    sequence_order=2,
                    weight=5.0,
                    include_in_global=False,
                    creation_date=_now(),
                    update_date=_now(),
                ),
            ]
        )
        await db.commit()

        global_row = await refresh_user_course_stats(
            db, regular_user.id, org.id, program.id
        )
        assert global_row.courses_included == 1
        assert global_row.weight_sum == 1.0

        data = await get_global_stats(db, regular_user.id, org.id, program.id)
        python = next(item for item in data["courses"] if item["name"] == "Python labs")
        assert python["included"] is False
        assert python["weight"] == 5.0

    async def test_locked_course_is_excluded(
        self, db, org, course, second_course, program, regular_user
    ):
        db.add_all(
            [
                ProgramCourse(
                    program_id=program.id,
                    course_id=course.id,
                    sequence_order=1,
                    weight=5.0,
                    creation_date=_now(),
                    update_date=_now(),
                ),
                ProgramCourse(
                    program_id=program.id,
                    course_id=second_course.id,
                    sequence_order=2,
                    weight=3.0,
                    unlock_after_course_id=course.id,
                    unlock_kpi_threshold=90.0,
                    creation_date=_now(),
                    update_date=_now(),
                ),
            ]
        )
        await db.commit()

        global_row = await refresh_user_course_stats(
            db, regular_user.id, org.id, program.id
        )
        # Neither course has activity, so course 2 is locked and excluded.
        assert global_row.courses_locked == 1
        assert global_row.courses_included == 1
        data = await get_global_stats(db, regular_user.id, org.id, program.id)
        python = next(item for item in data["courses"] if item["name"] == "Python labs")
        assert python["status"] == "locked"
        assert python["included"] is False
        assert data["courses_locked"] == 1

    async def test_period_metrics_filter_by_window(
        self, db, org, course, program, regular_user, activity
    ):
        from src.db.trail_steps import TrailStep

        now = datetime.now()
        old = (now - timedelta(days=60)).isoformat()
        base = {
            "complete": True,
            "teacher_verified": False,
            "grade": "",
            "data": {},
            "trail_id": 1,
            "activity_id": activity.id,
            "course_id": course.id,
            "org_id": org.id,
            "user_id": regular_user.id,
        }
        db.add_all(
            [
                TrailStep(trailrun_id=1, creation_date=old, update_date=old, **base),
                TrailStep(
                    trailrun_id=2,
                    creation_date=now.isoformat(),
                    update_date=now.isoformat(),
                    **base,
                ),
                ProgramCourse(
                    program_id=program.id,
                    course_id=course.id,
                    sequence_order=1,
                    weight=1.0,
                    include_in_global=True,
                    creation_date=_now(),
                    update_date=_now(),
                ),
            ]
        )
        await db.commit()

        all_stats = await get_global_stats(
            db, regular_user.id, org.id, program.id, "all"
        )
        week_stats = await get_global_stats(
            db, regular_user.id, org.id, program.id, "week"
        )
        assert all_stats["period"] == "all"
        assert week_stats["period"] == "week"

        detail_all = await get_course_stats(
            db, regular_user.id, org.id, course.course_uuid, program.id, "all"
        )
        detail_week = await get_course_stats(
            db, regular_user.id, org.id, course.course_uuid, program.id, "week"
        )
        # Two distinct completion dates all-time, only the recent one this week.
        assert detail_all["components"]["active_days"] == 2
        assert detail_week["components"]["active_days"] == 1
        assert detail_week["period"] == "week"
