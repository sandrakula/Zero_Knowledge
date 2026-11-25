"""Course KPI and global weighted KPI.

The raw events stay in TrailStep / assignment submissions / InformaticsSubmission.
This module derives:

* ``user_course_stat`` — one row per student per course;
* ``user_global_stat`` — weighted KPI over the programme;
* ``course_stat`` — teacher-facing aggregate;
* ``stat_snapshot`` — an ``all`` snapshot (weekly/monthly can reuse the table);
* ``informatics_problem_stat`` — problem-level stats for the Informatics course.

A locked course does not enter the global KPI. An unlocked but not started
course enters with KPI 0, as agreed.
"""

from __future__ import annotations

import math
import statistics
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
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
from src.db.informatics import InformaticsProblem, InformaticsSubmission
from src.db.stats import (
    CourseStat,
    DefenseRecord,
    InformaticsProblemStat,
    LearningProgram,
    ProgramCourse,
    ProgramEnrollment,
    StatSnapshot,
    UserCourseStat,
    UserGlobalStat,
)
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.users import User

DEFAULT_GENERAL_FORMULA = {
    "completion": 0.35,
    "grades": 0.35,
    "regularity": 0.20,
    "practice": 0.10,
}
DEFAULT_INFORMATICS_FORMULA = {
    "solved": 0.45,
    "score": 0.20,
    "efficiency": 0.20,
    "regularity": 0.15,
}


def _now() -> str:
    return datetime.now().isoformat()


def _json_value(value: Any) -> dict:
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value or {}


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            return None


def _week_key(dt: datetime) -> tuple[int, int]:
    iso = dt.isocalendar()
    return (iso[0], iso[1])


def _date_key(dt: datetime) -> str:
    return dt.date().isoformat()


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


# The period selector uses rolling windows so it matches the legacy
# `stats/me` score, which already treats "week" as the last 7 days.
PERIOD_DAYS = {"week": 7, "month": 30}
VALID_PERIODS = ("week", "month", "all")


def _period_window(period: str) -> tuple[Optional[datetime], Optional[float]]:
    """Return (window_start, weeks_in_window) for a period label."""
    if period not in VALID_PERIODS:
        raise ValueError("period must be week, month or all")
    days = PERIOD_DAYS.get(period)
    if days is None:
        return None, None
    weeks = 1.0 if period == "week" else 30.0 / 7.0
    return datetime.now() - timedelta(days=days), weeks


def _within(value: Optional[str], since: Optional[datetime]) -> bool:
    if since is None:
        return True
    dt = _parse_dt(value)
    return dt is not None and dt >= since


def _task_problem_id(task: AssignmentTask) -> Optional[int]:
    contents = _json_value(task.contents)
    meta = contents.get("_meta") or {}
    raw = meta.get("problem_id") or contents.get("informatics_problem_id")
    try:
        return int(raw) if raw is not None and str(raw).strip() else None
    except (TypeError, ValueError):
        return None


def is_informatics_course(course: Course, program_course: ProgramCourse | None = None) -> bool:
    meta = _json_value(course.extra_metadata)
    if meta.get("seed") == "informatics":
        return True
    if program_course and isinstance(program_course.kpi_formula, dict):
        if "solved" in program_course.kpi_formula:
            return True
    name = (course.name or "").lower()
    return "информат" in name or "informatics" in name


def default_formula(informatics: bool) -> dict:
    return dict(DEFAULT_INFORMATICS_FORMULA if informatics else DEFAULT_GENERAL_FORMULA)


def _regularity(active_weeks: int, total_weeks: float) -> float:
    weeks = max(1.0, total_weeks or 1.0)
    return min(1.0, max(0.0, active_weeks / weeks)) ** 1.2


def _practice(defenses: int) -> float:
    return 1.0 - math.exp(-max(0, defenses) / 6.0)


async def _get_default_program(db: AsyncSession, org_id: int) -> LearningProgram | None:
    program = (
        await db.execute(
            select(LearningProgram)
            .where(LearningProgram.org_id == org_id, LearningProgram.is_active.is_(True))
            .order_by(LearningProgram.id.asc())
            .limit(1)
        )
    ).scalars().first()
    return program


async def get_program(
    db: AsyncSession, org_id: int, program_id: Optional[int] = None
) -> LearningProgram:
    if program_id is not None:
        program = await db.get(LearningProgram, int(program_id))
    else:
        program = await _get_default_program(db, org_id)
    if program is None:
        raise ValueError("Learning programme not found")
    return program


async def _program_courses(
    db: AsyncSession, program_id: int
) -> list[tuple[ProgramCourse, Course]]:
    rows = list(
        (
            await db.execute(
                select(ProgramCourse)
                .where(ProgramCourse.program_id == program_id)
                .order_by(ProgramCourse.sequence_order.asc(), ProgramCourse.id.asc())
            )
        ).scalars().all()
    )
    result: list[tuple[ProgramCourse, Course]] = []
    for pc in rows:
        course = await db.get(Course, pc.course_id)
        if course is not None:
            result.append((pc, course))
    return result


async def _course_metrics(
    db: AsyncSession,
    user_id: int,
    course: Course,
    program_course: ProgramCourse,
    *,
    known_informatics: bool,
    since: Optional[datetime] = None,
    period_weeks: Optional[float] = None,
) -> dict:
    course_id = int(course.id or 0)
    org_id = int(course.org_id or 0)

    activities_total = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Activity)
                .where(
                    Activity.course_id == course_id,
                    Activity.published.is_(True),
                )
            )
        ).scalar_one()
    )
    step_rows = (
        await db.execute(
            select(TrailStep.activity_id, TrailStep.creation_date).where(
                TrailStep.user_id == user_id,
                TrailStep.course_id == course_id,
                TrailStep.complete.is_(True),
            )
        )
    ).all()
    if since is not None:
        step_rows = [row for row in step_rows if _within(row[1], since)]
    activity_ids = {int(row[0]) for row in step_rows if row[0] is not None}
    activities_completed = len(activity_ids)

    assignments = list(
        (
            await db.execute(
                select(Assignment).where(Assignment.course_id == course_id)
            )
        ).scalars().all()
    )
    assignment_ids = [int(a.id) for a in assignments if a.id is not None]
    assignment_uuids = [a.assignment_uuid for a in assignments if a.assignment_uuid]
    assignments_total = len(assignments)

    tasks = list(
        (
            await db.execute(
                select(AssignmentTask).where(AssignmentTask.course_id == course_id)
            )
        ).scalars().all()
    )
    task_ids = [int(t.id) for t in tasks if t.id is not None]
    tasks_by_id = {int(t.id): t for t in tasks if t.id is not None}
    tasks_total = len(tasks)
    problem_ids = {
        pid for pid in (_task_problem_id(t) for t in tasks) if pid is not None
    }

    assignments_graded = 0
    if assignment_ids:
        graded_submissions = list(
            (
                await db.execute(
                    select(AssignmentUserSubmission).where(
                        AssignmentUserSubmission.user_id == user_id,
                        AssignmentUserSubmission.assignment_id.in_(assignment_ids),  # type: ignore[attr-defined]
                        AssignmentUserSubmission.submission_status
                        == AssignmentUserSubmissionStatus.GRADED,
                    )
                )
            ).scalars().all()
        )
        if since is not None:
            graded_submissions = [
                row
                for row in graded_submissions
                if _within(row.update_date or row.creation_date, since)
            ]
        assignments_graded = len(graded_submissions)

    task_submissions: list[AssignmentTaskSubmission] = []
    if task_ids:
        task_submissions = list(
            (
                await db.execute(
                    select(AssignmentTaskSubmission).where(
                        AssignmentTaskSubmission.user_id == user_id,
                        AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
                    )
                )
            ).scalars().all()
        )
    if since is not None:
        task_submissions = [
            row for row in task_submissions if _within(row.creation_date, since)
        ]

    grade_sum = 0.0
    grade_max_sum = 0.0
    for task in tasks:
        grade_max_sum += _as_float(task.max_grade_value)
    tasks_attempted_ids: set[int] = set()
    tasks_solved = 0
    for ts in task_submissions:
        task = tasks_by_id.get(int(ts.assignment_task_id))
        if task is None:
            continue
        tasks_attempted_ids.add(int(ts.assignment_task_id))
        grade_sum += _as_float(ts.grade)
        max_grade = _as_float(task.max_grade_value)
        if max_grade > 0 and _as_float(ts.grade) >= max_grade * 0.5:
            tasks_solved += 1
    tasks_attempted = len(tasks_attempted_ids)
    grade_percent = 100.0 * grade_sum / grade_max_sum if grade_max_sum > 0 else 0.0

    defenses = list(
        (
            await db.execute(
                select(DefenseRecord).where(
                    DefenseRecord.user_id == user_id,
                    DefenseRecord.course_id == course_id,
                )
            )
        ).scalars().all()
    )
    if since is not None:
        defenses = [
            row for row in defenses if _within(row.confirmed_at, since)
        ]
    defense_count = len(defenses)

    # Contests are organization-level, not course-level. They must not give a
    # not-started course a non-zero regularity component.
    contest_count = 0

    inf_conditions = [InformaticsSubmission.user_id == user_id]
    if assignment_uuids:
        inf_conditions.append(
            InformaticsSubmission.assignment_uuid.in_(assignment_uuids)
        )
    elif problem_ids:
        inf_conditions.append(InformaticsSubmission.problem_id.in_(problem_ids))
    else:
        inf_conditions.append(InformaticsSubmission.problem_id == -1)
    inf_rows = list(
        (
            await db.execute(
                select(InformaticsSubmission).where(*inf_conditions)
            )
        ).scalars().all()
    )
    if since is not None:
        inf_rows = [row for row in inf_rows if _within(row.created_at, since)]
    informatics_attempts = len(inf_rows)
    informatics_solved = len(
        {int(row.problem_id) for row in inf_rows if row.solved}
    )
    informatics_accepted = sum(
        1 for row in inf_rows if (row.verdict or "") == "ACCEPTED"
    )
    final_scores = [
        _as_float(row.score)
        for row in inf_rows
        if (row.status or "") == "FINAL" and row.score is not None
    ]
    informatics_avg_score = (
        round(sum(final_scores) / len(final_scores), 2) if final_scores else None
    )

    dates: list[datetime] = []
    for _activity_id, created in step_rows:
        dt = _parse_dt(created)
        if dt is not None:
            dates.append(dt)
    for row in inf_rows:
        dt = _parse_dt(row.created_at)
        if dt is not None:
            dates.append(dt)
    for row in defenses:
        dt = _parse_dt(row.confirmed_at)
        if dt is not None:
            dates.append(dt)

    date_keys = {_date_key(dt) for dt in dates}
    active_days = len(date_keys)
    active_weeks = len({_week_key(dt) for dt in dates})
    earliest = min(dates) if dates else None
    if period_weeks is not None:
        total_weeks = max(1.0, period_weeks)
    else:
        total_weeks = (
            max(1.0, (datetime.now() - earliest).days / 7.0) if earliest else 1.0
        )
    last_activity_at = max(dates).isoformat() if dates else ""

    informatics = known_informatics
    if informatics and problem_ids:
        course_percent = (
            100.0 * informatics_solved / len(problem_ids) if problem_ids else 0.0
        )
    else:
        course_percent = (
            100.0 * activities_completed / activities_total if activities_total else 0.0
        )

    completion = (
        informatics_solved / len(problem_ids)
        if informatics and problem_ids
        else (activities_completed / activities_total if activities_total else 0.0)
    )
    grades = grade_percent / 100.0
    regularity = _regularity(active_weeks, total_weeks)
    practice = _practice(defense_count)

    if informatics:
        formula = (
            program_course.kpi_formula
            if isinstance(program_course.kpi_formula, dict)
            and program_course.kpi_formula
            else default_formula(True)
        )
        components = {
            "solved": min(1.0, completion),
            "score": (informatics_avg_score or 0.0) / 100.0,
            "efficiency": (
                informatics_accepted / informatics_attempts
                if informatics_attempts > 0
                else 0.0
            ),
            "regularity": regularity,
        }
        formula_sum = sum(_as_float(v) for v in formula.values()) or 1.0
        raw_kpi = sum(
            _as_float(formula.get(key, 0.0)) * min(1.0, value)
            for key, value in components.items()
        )
    else:
        formula = (
            program_course.kpi_formula
            if isinstance(program_course.kpi_formula, dict)
            and program_course.kpi_formula
            else default_formula(False)
        )
        components = {
            "completion": min(1.0, completion),
            "grades": min(1.0, grades),
            "regularity": regularity,
            "practice": practice,
        }
        formula_sum = sum(_as_float(v) for v in formula.values()) or 1.0
        raw_kpi = sum(
            _as_float(formula.get(key, 0.0)) * min(1.0, value)
            for key, value in components.items()
        )

    course_kpi = _clamp(100.0 * raw_kpi / formula_sum)

    return {
        "org_id": org_id,
        "course_id": course_id,
        "activities_total": activities_total,
        "activities_completed": activities_completed,
        "assignments_total": assignments_total,
        "assignments_graded": assignments_graded,
        "tasks_total": tasks_total,
        "tasks_solved": informatics_solved if informatics else tasks_solved,
        "tasks_attempted": tasks_attempted,
        "grade_sum": round(grade_sum, 2),
        "grade_max_sum": round(grade_max_sum, 2),
        "grade_percent": round(grade_percent, 2),
        "defense_count": defense_count,
        "contest_count": contest_count,
        "informatics_attempts": informatics_attempts,
        "informatics_solved": informatics_solved,
        "informatics_accepted": informatics_accepted,
        "informatics_avg_score": informatics_avg_score,
        "active_weeks": active_weeks,
        "total_weeks": round(total_weeks, 2),
        "active_days": active_days,
        "active_date_keys": date_keys,
        "last_activity_at": last_activity_at,
        "course_percent": round(_clamp(course_percent), 2),
        "course_kpi": round(course_kpi, 2),
        "components": {key: round(value, 4) for key, value in components.items()},
        "is_informatics": informatics,
        "has_activity": bool(
            activities_completed
            or informatics_attempts
            or tasks_attempted
            or defense_count
        ),
    }


def _is_completed(metrics: dict) -> bool:
    if metrics["activities_total"] > 0 and metrics["activities_completed"] >= metrics["activities_total"]:
        return True
    if metrics["is_informatics"] and metrics["informatics_solved"] > 0:
        return metrics["course_percent"] >= 99.999
    return False


async def refresh_user_course_stats(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    program_id: Optional[int] = None,
) -> UserGlobalStat:
    program = await get_program(db, org_id, program_id)
    program_courses = await _program_courses(db, int(program.id or 0))
    computed_at = _now()
    stats_by_course: dict[int, UserCourseStat] = {}
    all_date_keys: set[str] = set()
    last_activity = ""

    for program_course, course in program_courses:
        course_id = int(course.id or 0)
        informatics = is_informatics_course(course, program_course)
        metrics = await _course_metrics(
            db, user_id, course, program_course, known_informatics=informatics
        )
        has_activity = bool(
            metrics["activities_completed"]
            or metrics["informatics_attempts"]
            or metrics["tasks_attempted"]
            or metrics["defense_count"]
        )
        completed = _is_completed(metrics)

        locked = False
        if (
            program_course.unlock_after_course_id
            and _as_float(program_course.unlock_kpi_threshold) > 0
            and not has_activity
        ):
            prerequisite = stats_by_course.get(int(program_course.unlock_after_course_id))
            if prerequisite is None or _as_float(prerequisite.course_kpi) < _as_float(
                program_course.unlock_kpi_threshold
            ):
                locked = True

        status = (
            "locked"
            if locked
            else "completed"
            if completed
            else "in_progress"
            if has_activity
            else "available"
        )

        row = await _upsert_user_course_stat(
            db,
            user_id,
            int(program.id or 0),
            course_id,
            {
                "org_id": org_id,
                "enrolled_at": metrics["last_activity_at"] or computed_at,
                "last_activity_at": metrics["last_activity_at"],
                "course_status": status,
                "included_in_global": not locked
                and bool(program_course.include_in_global),
                "weight": _as_float(program_course.weight),
                **{
                    key: metrics[key]
                    for key in (
                        "activities_total",
                        "activities_completed",
                        "assignments_total",
                        "assignments_graded",
                        "tasks_total",
                        "tasks_solved",
                        "tasks_attempted",
                        "grade_sum",
                        "grade_max_sum",
                        "grade_percent",
                        "defense_count",
                        "contest_count",
                        "informatics_attempts",
                        "informatics_solved",
                        "informatics_accepted",
                        "informatics_avg_score",
                        "active_weeks",
                        "total_weeks",
                        "active_days",
                        "course_percent",
                        "course_kpi",
                    )
                },
                "computed_at": computed_at,
            },
        )
        stats_by_course[course_id] = row
        all_date_keys.update(metrics["active_date_keys"])
        if metrics["last_activity_at"] > last_activity:
            last_activity = metrics["last_activity_at"]

        await _upsert_snapshot(
            db,
            org_id,
            user_id,
            int(program.id or 0),
            "course",
            course_id,
            "all",
            "",
            "",
            _course_snapshot(row),
            row.course_kpi,
            computed_at,
        )

    included = [row for row in stats_by_course.values() if row.included_in_global]
    weight_sum = sum(_as_float(row.weight) for row in included)
    weighted_kpi_sum = sum(_as_float(row.course_kpi) * _as_float(row.weight) for row in included)
    global_kpi = weighted_kpi_sum / weight_sum if weight_sum > 0 else 0.0
    started = [
        row
        for row in included
        if row.course_status in ("in_progress", "completed")
    ]
    coverage = (
        sum(_as_float(row.weight) for row in started) / weight_sum
        if weight_sum > 0
        else 0.0
    )
    global_row = await _upsert_user_global_stat(
        db,
        user_id,
        int(program.id or 0),
        {
            "org_id": org_id,
            "global_kpi": round(_clamp(global_kpi), 2),
            "weighted_kpi_sum": round(weighted_kpi_sum, 2),
            "weight_sum": round(weight_sum, 2),
            "coverage": round(_clamp(coverage * 100.0), 2),
            "active_days": len(all_date_keys),
            "courses_included": len(included),
            "courses_started": len(started),
            "courses_completed": sum(
                1 for row in included if row.course_status == "completed"
            ),
            "courses_locked": sum(
                1 for row in stats_by_course.values() if row.course_status == "locked"
            ),
            "computed_at": computed_at,
        },
    )
    await _upsert_snapshot(
        db,
        org_id,
        user_id,
        int(program.id or 0),
        "global",
        0,
        "all",
        "",
        "",
        _global_snapshot(global_row, stats_by_course, program_courses, last_activity),
        global_row.global_kpi,
        computed_at,
    )
    await db.commit()
    await db.refresh(global_row)
    return global_row


async def _upsert_user_course_stat(
    db: AsyncSession,
    user_id: int,
    program_id: int,
    course_id: int,
    values: dict,
) -> UserCourseStat:
    row = (
        await db.execute(
            select(UserCourseStat).where(
                UserCourseStat.user_id == user_id,
                UserCourseStat.program_id == program_id,
                UserCourseStat.course_id == course_id,
            )
        )
    ).scalars().first()
    if row is None:
        row = UserCourseStat(
            user_id=user_id,
            program_id=program_id,
            course_id=course_id,
        )
    for key, value in values.items():
        setattr(row, key, value)
    db.add(row)
    await db.flush()
    return row


async def _upsert_user_global_stat(
    db: AsyncSession, user_id: int, program_id: int, values: dict
) -> UserGlobalStat:
    row = (
        await db.execute(
            select(UserGlobalStat).where(
                UserGlobalStat.user_id == user_id,
                UserGlobalStat.program_id == program_id,
            )
        )
    ).scalars().first()
    if row is None:
        row = UserGlobalStat(user_id=user_id, program_id=program_id)
    for key, value in values.items():
        setattr(row, key, value)
    db.add(row)
    await db.flush()
    return row


async def _upsert_snapshot(
    db: AsyncSession,
    org_id: int,
    user_id: int,
    program_id: int,
    scope_type: str,
    scope_id: int,
    period_kind: str,
    period_start: str,
    period_end: str,
    metrics: dict,
    kpi: float,
    computed_at: str,
) -> None:
    row = (
        await db.execute(
            select(StatSnapshot).where(
                StatSnapshot.user_id == user_id,
                StatSnapshot.program_id == program_id,
                StatSnapshot.scope_type == scope_type,
                StatSnapshot.scope_id == scope_id,
                StatSnapshot.period_kind == period_kind,
                StatSnapshot.period_start == period_start,
            )
        )
    ).scalars().first()
    if row is None:
        row = StatSnapshot(
            org_id=org_id,
            user_id=user_id,
            program_id=program_id,
            scope_type=scope_type,
            scope_id=scope_id,
            period_kind=period_kind,
            period_start=period_start,
        )
    row.period_end = period_end
    row.metrics = metrics
    row.kpi = kpi
    row.computed_at = computed_at
    db.add(row)


def _course_snapshot(row: UserCourseStat) -> dict:
    return {
        "course_status": row.course_status,
        "course_percent": row.course_percent,
        "course_kpi": row.course_kpi,
        "activities_completed": row.activities_completed,
        "activities_total": row.activities_total,
        "tasks_solved": row.tasks_solved,
        "tasks_total": row.tasks_total,
        "informatics_attempts": row.informatics_attempts,
        "informatics_solved": row.informatics_solved,
        "informatics_accepted": row.informatics_accepted,
        "active_days": row.active_days,
    }


def _global_snapshot(
    global_row: UserGlobalStat,
    stats_by_course: dict[int, UserCourseStat],
    program_courses: list[tuple[ProgramCourse, Course]],
    last_activity: str,
) -> dict:
    by_id = {int(course.id): course for _, course in program_courses}
    return {
        "global_kpi": global_row.global_kpi,
        "coverage": global_row.coverage,
        "active_days": global_row.active_days,
        "last_activity_at": last_activity,
        "courses": [
            {
                "course_id": course_id,
                "course_uuid": by_id[course_id].course_uuid if course_id in by_id else "",
                "name": by_id[course_id].name if course_id in by_id else "",
                "status": row.course_status,
                "kpi": row.course_kpi,
                "percent": row.course_percent,
                "weight": row.weight,
            }
            for course_id, row in stats_by_course.items()
        ],
    }


async def _period_stats(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    program: LearningProgram,
    program_courses: list[tuple[ProgramCourse, Course]],
    all_rows: dict[int, UserCourseStat],
    period: str,
) -> dict:
    """Period-scoped KPI for every course plus the weighted programme KPI.

    The cumulative `user_course_stat` row still supplies status, weight and
    completion percent; only the KPI inputs are restricted to the window.
    """
    since, period_weeks = _period_window(period)
    course_kpis: dict[int, float] = {}
    course_activity: dict[int, bool] = {}
    active_keys: set[str] = set()
    for program_course, course in program_courses:
        course_id = int(course.id or 0)
        metrics = await _course_metrics(
            db,
            user_id,
            course,
            program_course,
            known_informatics=is_informatics_course(course, program_course),
            since=since,
            period_weeks=period_weeks,
        )
        course_kpis[course_id] = _as_float(metrics["course_kpi"])
        course_activity[course_id] = bool(metrics["has_activity"])
        active_keys.update(metrics["active_date_keys"])

    included = [
        course_id
        for course_id, row in all_rows.items()
        if row.included_in_global and course_id in all_rows
    ]
    weight_sum = sum(_as_float(all_rows[cid].weight) for cid in included)
    weighted = sum(
        course_kpis.get(cid, 0.0) * _as_float(all_rows[cid].weight)
        for cid in included
    )
    started_weight = sum(
        _as_float(all_rows[cid].weight)
        for cid in included
        if course_activity.get(cid)
    )
    return {
        "period": period,
        "global_kpi": round(_clamp(weighted / weight_sum), 2) if weight_sum else 0.0,
        "weighted_kpi_sum": round(weighted, 2),
        "weight_sum": round(weight_sum, 2),
        "coverage": (
            round(_clamp(100.0 * started_weight / weight_sum), 2)
            if weight_sum
            else 0.0
        ),
        "active_days": len(active_keys),
        "courses_included": len(included),
        "courses_started": sum(1 for cid in included if course_activity.get(cid)),
        "course_kpis": course_kpis,
        "course_activity": course_activity,
    }


async def get_global_stats(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    program_id: Optional[int] = None,
    period: str = "all",
) -> dict:
    _period_window(period)  # validate before doing any work
    program = await get_program(db, org_id, program_id)
    program_id_value = int(program.id or 0)
    global_row = await refresh_user_course_stats(
        db, user_id, org_id, program_id_value
    )
    program_courses = await _program_courses(db, program_id_value)
    courses_by_id = {int(c.id): c for _, c in program_courses if c.id is not None}
    pc_by_course = {int(pc.course_id): pc for pc, _ in program_courses}
    rows = list(
        (
            await db.execute(
                select(UserCourseStat).where(
                    UserCourseStat.user_id == user_id,
                    UserCourseStat.program_id == program_id_value,
                )
            )
        ).scalars().all()
    )
    all_rows = {int(row.course_id): row for row in rows}
    period_data = (
        await _period_stats(
            db, user_id, org_id, program, program_courses, all_rows, period
        )
        if period != "all"
        else None
    )
    base_weight_sum = _as_float(global_row.weight_sum) or 1.0
    weight_sum = (
        _as_float(period_data["weight_sum"]) if period_data else base_weight_sum
    ) or 1.0
    items = []
    for row in sorted(
        rows,
        key=lambda r: (
            int(pc_by_course.get(r.course_id).sequence_order)
            if r.course_id in pc_by_course
            else 999,
            r.course_id,
        ),
    ):
        course = courses_by_id.get(row.course_id)
        pc = pc_by_course.get(row.course_id)
        if course is None:
            continue
        course_kpi = (
            _as_float(period_data["course_kpis"].get(row.course_id, 0.0))
            if period_data
            else _as_float(row.course_kpi)
        )
        items.append(
            {
                "course_uuid": course.course_uuid,
                "name": course.name,
                "sequence_order": int(pc.sequence_order) if pc else 999,
                "weight": row.weight,
                "status": row.course_status,
                "course_kpi": course_kpi,
                "course_percent": row.course_percent,
                "contribution": round(
                    course_kpi * _as_float(row.weight) / weight_sum, 2
                ),
                "included": bool(row.included_in_global),
                "last_activity_at": row.last_activity_at,
                "activities_completed": row.activities_completed,
                "activities_total": row.activities_total,
                "informatics_solved": row.informatics_solved,
                "informatics_attempts": row.informatics_attempts,
            }
        )
    return {
        "program_id": program_id_value,
        "program_name": program.name,
        "period": period,
        "global_kpi": (
            period_data["global_kpi"] if period_data else global_row.global_kpi
        ),
        "weighted_kpi_sum": (
            period_data["weighted_kpi_sum"]
            if period_data
            else global_row.weighted_kpi_sum
        ),
        "weight_sum": period_data["weight_sum"] if period_data else global_row.weight_sum,
        "coverage": period_data["coverage"] if period_data else global_row.coverage,
        "active_days": (
            period_data["active_days"] if period_data else global_row.active_days
        ),
        "courses_included": (
            period_data["courses_included"]
            if period_data
            else global_row.courses_included
        ),
        "courses_started": (
            period_data["courses_started"] if period_data else global_row.courses_started
        ),
        "courses_completed": global_row.courses_completed,
        "courses_locked": global_row.courses_locked,
        "computed_at": global_row.computed_at,
        "courses": items,
    }


async def get_course_stats(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    course_uuid: str,
    program_id: Optional[int] = None,
    period: str = "all",
) -> dict:
    _period_window(period)  # validate before doing any work
    program = await get_program(db, org_id, program_id)
    await refresh_user_course_stats(db, user_id, org_id, int(program.id or 0))
    course = (
        await db.execute(
            select(Course).where(
                Course.course_uuid == course_uuid, Course.org_id == org_id
            )
        )
    ).scalars().first()
    if course is None:
        raise ValueError("Course not found")
    row = (
        await db.execute(
            select(UserCourseStat).where(
                UserCourseStat.user_id == user_id,
                UserCourseStat.program_id == int(program.id or 0),
                UserCourseStat.course_id == int(course.id or 0),
            )
        )
    ).scalars().first()
    if row is None:
        raise ValueError("Course statistics not found")
    program_course = (
        await db.execute(
            select(ProgramCourse).where(
                ProgramCourse.program_id == int(program.id or 0),
                ProgramCourse.course_id == int(course.id or 0),
            )
        )
    ).scalars().first()
    informatics = is_informatics_course(course, program_course)
    formula = (
        program_course.kpi_formula
        if program_course is not None
        and isinstance(program_course.kpi_formula, dict)
        and program_course.kpi_formula
        else default_formula(informatics)
    )
    period_metrics: Optional[dict] = None
    if period != "all" and program_course is not None:
        since, period_weeks = _period_window(period)
        period_metrics = await _course_metrics(
            db,
            user_id,
            course,
            program_course,
            known_informatics=informatics,
            since=since,
            period_weeks=period_weeks,
        )

    def pick(key: str) -> Any:
        if period_metrics is not None:
            return period_metrics.get(key)
        return getattr(row, key)

    return {
        "course_uuid": course.course_uuid,
        "name": course.name,
        "program_id": int(program.id or 0),
        "period": period,
        "status": row.course_status,
        "weight": row.weight,
        "course_kpi": (
            _as_float(period_metrics["course_kpi"])
            if period_metrics is not None
            else _as_float(row.course_kpi)
        ),
        "course_percent": row.course_percent,
        "is_informatics": informatics,
        "formula": {key: _as_float(value) for key, value in formula.items()},
        "components": {
            "activities_completed": pick("activities_completed"),
            "activities_total": pick("activities_total"),
            "assignments_graded": pick("assignments_graded"),
            "assignments_total": pick("assignments_total"),
            "tasks_solved": pick("tasks_solved"),
            "tasks_total": pick("tasks_total"),
            "grade_percent": pick("grade_percent"),
            "defense_count": pick("defense_count"),
            "informatics_attempts": pick("informatics_attempts"),
            "informatics_solved": pick("informatics_solved"),
            "informatics_accepted": pick("informatics_accepted"),
            "informatics_avg_score": pick("informatics_avg_score"),
            "active_weeks": pick("active_weeks"),
            "total_weeks": pick("total_weeks"),
            "active_days": pick("active_days"),
        },
        "last_activity_at": (
            period_metrics["last_activity_at"]
            if period_metrics is not None
            else row.last_activity_at
        ),
        "computed_at": row.computed_at,
    }


async def get_course_students(
    db: AsyncSession,
    org_id: int,
    course_uuid: str,
    program_id: Optional[int] = None,
    limit: int = 200,
) -> list[dict]:
    program = await get_program(db, org_id, program_id)
    course = (
        await db.execute(
            select(Course).where(
                Course.course_uuid == course_uuid, Course.org_id == org_id
            )
        )
    ).scalars().first()
    if course is None:
        raise ValueError("Course not found")
    runs = list(
        (
            await db.execute(
                select(TrailRun).where(TrailRun.course_id == int(course.id or 0))
            )
        ).scalars().all()
    )
    user_ids = sorted({int(run.user_id) for run in runs})[:limit]
    for user_id in user_ids:
        await refresh_user_course_stats(db, user_id, org_id, int(program.id or 0))
    rows = list(
        (
            await db.execute(
                select(UserCourseStat).where(
                    UserCourseStat.program_id == int(program.id or 0),
                    UserCourseStat.course_id == int(course.id or 0),
                    UserCourseStat.user_id.in_(user_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all()
    )
    users = {
        int(u.id): u
        for u in (
            await db.execute(select(User).where(User.id.in_(user_ids)))  # type: ignore[attr-defined]
        ).scalars().all()
    }
    result = []
    for row in rows:
        user = users.get(row.user_id)
        result.append(
            {
                "user_id": row.user_id,
                "name": (
                    f"{user.first_name or ''} {user.last_name or ''}".strip()
                    if user
                    else ""
                )
                or (user.username if user else ""),
                "username": user.username if user else "",
                "course_kpi": row.course_kpi,
                "course_percent": row.course_percent,
                "status": row.course_status,
                "active_days": row.active_days,
                "last_activity_at": row.last_activity_at,
            }
        )
    return sorted(result, key=lambda item: item["course_kpi"], reverse=True)


async def refresh_course_stat(
    db: AsyncSession, program_id: int, course_id: int
) -> CourseStat:
    rows = list(
        (
            await db.execute(
                select(UserCourseStat).where(
                    UserCourseStat.program_id == program_id,
                    UserCourseStat.course_id == course_id,
                )
            )
        ).scalars().all()
    )
    kpis = [_as_float(row.course_kpi) for row in rows]
    percentages = [_as_float(row.course_percent) for row in rows]
    grades = [_as_float(row.grade_percent) for row in rows]
    started = [row for row in rows if row.course_status in ("in_progress", "completed")]
    completed = [row for row in rows if row.course_status == "completed"]

    def pct(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * p))))
        return round(ordered[index], 2)

    values = {
        "org_id": rows[0].org_id if rows else 0,
        "students_total": len(rows),
        "students_started": len(started),
        "students_completed": len(completed),
        "avg_kpi": round(sum(kpis) / len(kpis), 2) if kpis else 0.0,
        "median_kpi": round(statistics.median(kpis), 2) if kpis else 0.0,
        "p25_kpi": pct(kpis, 0.25),
        "p75_kpi": pct(kpis, 0.75),
        "avg_percent": round(sum(percentages) / len(percentages), 2)
        if percentages
        else 0.0,
        "avg_grade_percent": round(sum(grades) / len(grades), 2) if grades else 0.0,
        "informatics_attempts": sum(row.informatics_attempts for row in rows),
        "informatics_solved": sum(row.informatics_solved for row in rows),
        "informatics_accepted": sum(row.informatics_accepted for row in rows),
        "computed_at": _now(),
    }
    row = (
        await db.execute(
            select(CourseStat).where(
                CourseStat.program_id == program_id,
                CourseStat.course_id == course_id,
            )
        )
    ).scalars().first()
    if row is None:
        row = CourseStat(program_id=program_id, course_id=course_id)
    for key, value in values.items():
        setattr(row, key, value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def refresh_informatics_problem_stats(db: AsyncSession) -> int:
    # Compute row by row: SQLite/Postgres differ on casting booleans in
    # aggregates, and the Informatics problem count is small enough.
    summaries: dict[int, dict] = {}
    for row in (
        await db.execute(select(InformaticsSubmission))
    ).scalars().all():
        item = summaries.setdefault(
            int(row.problem_id),
            {
                "attempts": 0,
                "users": set(),
                "solved_users": set(),
                "accepted": 0,
                "scores": [],
                "time": [],
                "memory": [],
                "last": "",
            },
        )
        item["attempts"] += 1
        item["users"].add(int(row.user_id))
        if row.solved:
            item["solved_users"].add(int(row.user_id))
        if (row.verdict or "") == "ACCEPTED":
            item["accepted"] += 1
        if (row.status or "") == "FINAL" and row.score is not None:
            item["scores"].append(_as_float(row.score))
        if row.time_ms:
            item["time"].append(int(row.time_ms))
        if row.memory_kb:
            item["memory"].append(int(row.memory_kb))
        if row.created_at and row.created_at > item["last"]:
            item["last"] = row.created_at

    for problem_id, item in summaries.items():
        row = await db.get(InformaticsProblemStat, problem_id)
        if row is None:
            row = InformaticsProblemStat(problem_id=problem_id)
        row.attempts = item["attempts"]
        row.solved_users = len(item["solved_users"])
        row.accepted_attempts = item["accepted"]
        row.avg_score = (
            round(sum(item["scores"]) / len(item["scores"]), 2)
            if item["scores"]
            else 0.0
        )
        row.avg_time_ms = (
            int(sum(item["time"]) / len(item["time"])) if item["time"] else 0
        )
        row.avg_memory_kb = (
            int(sum(item["memory"]) / len(item["memory"])) if item["memory"] else 0
        )
        row.last_attempt_at = item["last"]
        db.add(row)
    await db.commit()
    return len(summaries)


async def get_informatics_problems(
    db: AsyncSession, limit: int = 200
) -> list[dict]:
    await refresh_informatics_problem_stats(db)
    rows = list(
        (
            await db.execute(
                select(InformaticsProblemStat)
                .order_by(InformaticsProblemStat.attempts.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    problems = {
        int(p.problem_id): p
        for p in (
            await db.execute(
                select(InformaticsProblem).where(
                    InformaticsProblem.problem_id.in_(
                        [row.problem_id for row in rows]  # type: ignore[attr-defined]
                    )
                )
            )
        ).scalars().all()
    } if rows else {}
    return [
        {
            "problem_id": row.problem_id,
            "title": problems.get(row.problem_id).title
            if problems.get(row.problem_id)
            else "",
            "attempts": row.attempts,
            "solved_users": row.solved_users,
            "accepted_attempts": row.accepted_attempts,
            "avg_score": row.avg_score,
            "avg_time_ms": row.avg_time_ms,
            "avg_memory_kb": row.avg_memory_kb,
            "last_attempt_at": row.last_attempt_at,
        }
        for row in rows
    ]


async def recompute_program(
    db: AsyncSession, org_id: int, program_id: Optional[int] = None
) -> dict:
    program = await get_program(db, org_id, program_id)
    program_courses = await _program_courses(db, int(program.id or 0))
    user_ids = set(
        (
            await db.execute(
                select(TrailRun.user_id).where(TrailRun.org_id == org_id)
            )
        ).scalars().all()
    )
    user_ids.update(
        (
            await db.execute(
                select(ProgramEnrollment.user_id).where(
                    ProgramEnrollment.program_id == int(program.id or 0)
                )
            )
        ).scalars().all()
    )
    for user_id in user_ids:
        await refresh_user_course_stats(db, int(user_id), org_id, int(program.id or 0))
    for program_course, _ in program_courses:
        await refresh_course_stat(db, int(program.id or 0), int(program_course.course_id))
    await refresh_informatics_problem_stats(db)
    return {
        "program_id": int(program.id or 0),
        "users": len(user_ids),
        "courses": len(program_courses),
    }
