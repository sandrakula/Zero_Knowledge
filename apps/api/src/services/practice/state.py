"""Database side of adaptive practice: record attempts, project mastery, build feeds."""

from __future__ import annotations

import logging
import os
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Sequence
from uuid import uuid4

from sqlalchemy import case, func, inspect
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.practice import ItemCalibration, PracticeAttempt, UserTopicMastery
from src.services.practice import adaptive
from src.services.practice.curriculum import (
    read_chapter_curriculum,
    read_task_meta,
    resolve_level,
    resolve_minutes,
    resolve_topic_key,
)

logger = logging.getLogger(__name__)

PRACTICE_ENABLED = os.getenv("LEARNHOUSE_PRACTICE", "1").strip().lower() not in {
    "0",
    "false",
    "off",
    "no",
}

XP_GOAL = 40
PREREQ_MASTERY = 0.6
MAX_ATTEMPTS_PER_TOPIC = 500
MAX_ELAPSED_SAMPLES = 1000


@dataclass
class AttemptInput:
    user_id: int
    org_id: int
    course_id: int
    chapter_id: Optional[int] = None
    task_id: Optional[int] = None
    topic_key: str = ""
    task_uuid: str = ""
    activity_uuid: str = ""
    assignment_uuid: str = ""
    task_type: str = ""
    level: int = 1
    score: float = 0.0
    passed: bool = False
    tests_passed: int = 0
    tests_total: int = 0
    elapsed_ms: int = 0
    source: str = "assignment"
    source_uuid: str = ""
    graded_at: str = ""
    topic_name: str = ""


def _now() -> datetime:
    return datetime.now()


def _iso(dt: datetime | None = None) -> str:
    return adaptive.iso(dt or _now())


async def _tables_ready(db: AsyncSession) -> bool:
    """True when the practice tables exist in this database.

    Grading runs in deployments that may not have the migration yet, and the
    test suite creates schemas per test module. A missing table must not break
    grading, so the caller gets a quiet False.
    """
    try:
        connection = await db.connection()
        return bool(
            await connection.run_sync(
                lambda sync_connection: inspect(sync_connection).has_table(
                    "practice_attempt"
                )
            )
        )
    except Exception:
        return False


async def record_attempts(db: AsyncSession, attempts: Sequence[AttemptInput]) -> int:
    """Upsert graded attempts and refresh the affected mastery rows."""
    if not PRACTICE_ENABLED or not attempts:
        return 0
    if not await _tables_ready(db):
        return 0

    now = _now()
    topics: dict[tuple[int, int, int, str], str] = {}
    items: set[tuple[int, str]] = set()

    for attempt in attempts:
        source_uuid = attempt.source_uuid or f"manual_{uuid4().hex}"
        statement = select(PracticeAttempt).where(
            PracticeAttempt.user_id == attempt.user_id,
            PracticeAttempt.source_uuid == source_uuid,
        )
        row = (await db.execute(statement)).scalars().first()
        stamp = _iso(now)
        if row is None:
            row = PracticeAttempt(
                user_id=attempt.user_id,
                org_id=attempt.org_id,
                course_id=attempt.course_id,
                source_uuid=source_uuid,
                created_at=stamp,
            )
            db.add(row)
        row.chapter_id = attempt.chapter_id
        row.task_id = attempt.task_id
        row.topic_key = attempt.topic_key
        row.task_uuid = attempt.task_uuid
        row.activity_uuid = attempt.activity_uuid
        row.assignment_uuid = attempt.assignment_uuid
        row.task_type = attempt.task_type
        row.source = attempt.source
        row.level = adaptive.clamp(attempt.level, 1, 3)
        row.score = adaptive.clamp(attempt.score)
        row.passed = bool(attempt.passed)
        row.tests_passed = max(0, int(attempt.tests_passed))
        row.tests_total = max(0, int(attempt.tests_total))
        row.elapsed_ms = max(0, int(attempt.elapsed_ms))
        row.graded_at = attempt.graded_at or stamp
        row.updated_at = stamp
        topics[(attempt.user_id, attempt.org_id, attempt.course_id, attempt.topic_key)] = (
            attempt.topic_name
        )
        items.add((attempt.org_id, attempt.task_uuid))

    await db.flush()

    for (user_id, org_id, course_id, topic_key), topic_name in topics.items():
        if not topic_key:
            continue
        await refresh_topic_mastery(
            db,
            user_id=user_id,
            org_id=org_id,
            course_id=course_id,
            topic_key=topic_key,
            topic_name=topic_name,
            now=now,
            commit=False,
        )
    for org_id, task_uuid in items:
        if not task_uuid:
            continue
        await refresh_item_calibration(
            db, org_id=org_id, task_uuid=task_uuid, commit=False
        )

    await db.commit()
    return len(attempts)


async def refresh_topic_mastery(
    db: AsyncSession,
    *,
    user_id: int,
    org_id: int,
    course_id: int,
    topic_key: str,
    topic_name: str = "",
    now: datetime | None = None,
    commit: bool = True,
) -> Optional[UserTopicMastery]:
    now = now or _now()
    if not topic_key:
        return None
    statement = (
        select(PracticeAttempt)
        .where(
            PracticeAttempt.user_id == user_id,
            PracticeAttempt.org_id == org_id,
            PracticeAttempt.course_id == course_id,
            PracticeAttempt.topic_key == topic_key,
        )
        .order_by(PracticeAttempt.graded_at.desc(), PracticeAttempt.id.desc())
        .limit(MAX_ATTEMPTS_PER_TOPIC)
    )
    rows = list((await db.execute(statement)).scalars().all())
    if not rows:
        return None

    observations: list[tuple[float, float, datetime]] = []
    for row in rows[:30]:
        graded_at = adaptive.parse_dt(row.graded_at) or adaptive.parse_dt(row.created_at)
        if graded_at is None:
            continue
        observations.append(
            (
                row.score,
                adaptive.reliability_for(row.task_type),
                graded_at,
            )
        )
    mastery, confidence = adaptive.weighted_mastery(observations, now)
    passed_count = sum(1 for row in rows if row.passed)

    latest = rows[0]
    next_review = adaptive.next_review_at(mastery, bool(latest.passed), now)

    mastery_statement = select(UserTopicMastery).where(
        UserTopicMastery.user_id == user_id,
        UserTopicMastery.org_id == org_id,
        UserTopicMastery.course_id == course_id,
        UserTopicMastery.topic_key == topic_key,
    )
    record = (await db.execute(mastery_statement)).scalars().first()
    if record is None:
        record = UserTopicMastery(
            user_id=user_id,
            org_id=org_id,
            course_id=course_id,
            topic_key=topic_key,
            created_at=_iso(now),
        )
        db.add(record)
    if topic_name:
        record.topic_name = topic_name[:300]
    record.mastery = round(mastery, 4)
    record.confidence = round(confidence, 4)
    record.attempts = len(rows)
    record.passed = passed_count
    record.last_attempt_at = latest.graded_at or latest.created_at
    record.next_review_at = next_review
    record.updated_at = _iso(now)
    await db.flush()
    if commit:
        await db.commit()
    return record


async def refresh_item_calibration(
    db: AsyncSession,
    *,
    org_id: int,
    task_uuid: str,
    commit: bool = True,
) -> Optional[ItemCalibration]:
    if not task_uuid:
        return None
    attempts_statement = select(
        func.count(),
        func.sum(case((PracticeAttempt.passed.is_(True), 1), else_=0)),
    ).where(
        PracticeAttempt.org_id == org_id,
        PracticeAttempt.task_uuid == task_uuid,
    )
    total, passes = (await db.execute(attempts_statement)).one()
    total = int(total or 0)
    passes = int(passes or 0)
    if total <= 0:
        return None

    elapsed_statement = (
        select(PracticeAttempt.elapsed_ms)
        .where(
            PracticeAttempt.org_id == org_id,
            PracticeAttempt.task_uuid == task_uuid,
            PracticeAttempt.elapsed_ms > 0,
        )
        .limit(MAX_ELAPSED_SAMPLES)
    )
    elapsed = [int(value) for value in (await db.execute(elapsed_statement)).scalars()]
    median = int(statistics.median(elapsed)) if elapsed else 0

    calibration_statement = select(ItemCalibration).where(
        ItemCalibration.org_id == org_id,
        ItemCalibration.task_uuid == task_uuid,
    )
    record = (await db.execute(calibration_statement)).scalars().first()
    if record is None:
        record = ItemCalibration(org_id=org_id, task_uuid=task_uuid)
        db.add(record)
    record.attempts = total
    record.passes = passes
    record.difficulty = round(adaptive.difficulty_from_pass_rate(passes, total), 4)
    record.median_elapsed_ms = median
    record.updated_at = _iso()
    await db.flush()
    if commit:
        await db.commit()
    return record


async def _mastery_map(
    db: AsyncSession, user_id: int, org_id: int, course_id: int
) -> dict[str, UserTopicMastery]:
    statement = select(UserTopicMastery).where(
        UserTopicMastery.user_id == user_id,
        UserTopicMastery.org_id == org_id,
        UserTopicMastery.course_id == course_id,
    )
    rows = (await db.execute(statement)).scalars().all()
    return {row.topic_key: row for row in rows}


async def _calibration_map(
    db: AsyncSession, org_id: int, task_uuids: Sequence[str]
) -> dict[str, ItemCalibration]:
    if not task_uuids:
        return {}
    statement = select(ItemCalibration).where(
        ItemCalibration.org_id == org_id,
        ItemCalibration.task_uuid.in_(list(task_uuids)),  # type: ignore[attr-defined]
    )
    rows = (await db.execute(statement)).scalars().all()
    return {row.task_uuid: row for row in rows}


def _safe_task_fields(task: AssignmentTask) -> dict:
    """Only what the learner needs to open a task — never tests or solutions."""
    contents = task.contents if isinstance(task.contents, dict) else {}
    task_type = str(task.assignment_type).split(".")[-1]
    if task_type != "CODE":
        return {}
    allowed = (
        "starter_code",
        "language_id",
        "languages",
        "time_limit_ms",
        "memory_limit_kb",
        "allow_student_run",
    )
    return {key: contents[key] for key in allowed if key in contents}


async def get_candidates(
    db: AsyncSession,
    *,
    course: Course,
    user_id: int,
    org_id: int,
    include_unpublished: bool = False,
) -> tuple[list[adaptive.Candidate], dict[str, dict]]:
    statement = (
        select(AssignmentTask, Assignment, Activity)
        .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
        .join(Activity, Activity.id == AssignmentTask.activity_id)
        .where(
            AssignmentTask.org_id == org_id,
            AssignmentTask.course_id == course.id,
            Assignment.ungraded.is_not(True),
        )
    )
    if not include_unpublished:
        statement = statement.where(
            Assignment.published.is_(True),
            Activity.published.is_(True),
        )
    rows = (await db.execute(statement)).all()
    if not rows:
        return [], {}

    chapter_statement = select(Chapter).where(Chapter.course_id == course.id)
    chapters = {
        chapter.id: chapter
        for chapter in (await db.execute(chapter_statement)).scalars().all()
    }
    mastery = await _mastery_map(db, user_id, org_id, course.id)
    calibration = await _calibration_map(
        db, org_id, [task.assignment_task_uuid for task, _a, _act in rows]
    )
    attempts_statement = (
        select(PracticeAttempt)
        .where(
            PracticeAttempt.user_id == user_id,
            PracticeAttempt.org_id == org_id,
            PracticeAttempt.course_id == course.id,
        )
        .order_by(PracticeAttempt.graded_at.desc(), PracticeAttempt.id.desc())
        .limit(2000)
    )
    latest_by_task: dict[str, PracticeAttempt] = {}
    for attempt in (await db.execute(attempts_statement)).scalars().all():
        if attempt.task_uuid and attempt.task_uuid not in latest_by_task:
            latest_by_task[attempt.task_uuid] = attempt

    candidates: list[adaptive.Candidate] = []
    contexts: dict[str, dict] = {}
    for task, assignment, activity in rows:
        chapter = chapters.get(task.chapter_id)
        curriculum = read_chapter_curriculum(chapter)
        meta = read_task_meta(task)
        topic_key = resolve_topic_key(task, chapter)
        if not topic_key:
            continue
        level = resolve_level(task, chapter)
        topic_mastery = mastery.get(topic_key)
        calc = calibration.get(task.assignment_task_uuid)
        latest_attempt = latest_by_task.get(task.assignment_task_uuid)
        difficulty = (
            calc.difficulty
            if calc is not None and calc.attempts >= 5
            else adaptive.level_prior(level)
        )
        prerequisites = curriculum.get("prerequisites", [])
        prereq_ready = all(
            mastery.get(prerequisite, None) is not None
            and mastery[prerequisite].mastery >= PREREQ_MASTERY
            for prerequisite in prerequisites
        )
        candidates.append(
            adaptive.Candidate(
                task_uuid=task.assignment_task_uuid,
                topic_key=topic_key,
                level=level,
                difficulty=difficulty,
                mastery=topic_mastery.mastery if topic_mastery else 0.0,
                confidence=topic_mastery.confidence if topic_mastery else 0.0,
                attempts=topic_mastery.attempts if topic_mastery else 0,
                next_review_at=topic_mastery.next_review_at if topic_mastery else "",
                prereq_ready=prereq_ready,
                task_type=str(task.assignment_type).split(".")[-1],
                last_passed=bool(latest_attempt.passed) if latest_attempt else False,
                last_attempt_at=(
                    latest_attempt.graded_at or latest_attempt.created_at
                    if latest_attempt
                    else ""
                ),
            )
        )
        contexts[task.assignment_task_uuid] = {
            "title": task.title,
            "assignment_type": str(task.assignment_type).split(".")[-1],
            "activity_uuid": activity.activity_uuid,
            "assignment_uuid": assignment.assignment_uuid,
            "course_uuid": course.course_uuid,
            "topic_key": topic_key,
            "topic_name": (
                topic_mastery.topic_name
                if topic_mastery and topic_mastery.topic_name
                else (chapter.name if chapter else "")
            ),
            "level": level,
            "estimated_minutes": resolve_minutes(task, chapter),
            "max_grade_value": int(task.max_grade_value or 0),
            "meta": meta,
            "safe": _safe_task_fields(task),
        }
    return candidates, contexts


async def build_today(
    db: AsyncSession,
    *,
    course: Course,
    user_id: int,
    org_id: int,
    limit: int = 10,
    include_unpublished: bool = False,
    strict_prereq: bool = True,
) -> dict:
    candidates, contexts = await get_candidates(
        db,
        course=course,
        user_id=user_id,
        org_id=org_id,
        include_unpublished=include_unpublished,
    )
    picks = adaptive.select_feed(
        candidates,
        limit=limit,
        strict_prereq=strict_prereq,
    )
    items: list[dict] = []
    for pick in picks:
        context = contexts.get(pick.candidate.task_uuid, {})
        items.append(
            {
                "task_uuid": pick.candidate.task_uuid,
                "title": context.get("title", ""),
                "assignment_type": context.get("assignment_type", ""),
                "activity_uuid": context.get("activity_uuid", ""),
                "assignment_uuid": context.get("assignment_uuid", ""),
                "course_uuid": context.get("course_uuid", course.course_uuid),
                "topic_key": pick.candidate.topic_key,
                "topic_name": context.get("topic_name", ""),
                "level": pick.candidate.level,
                "estimated_minutes": context.get("estimated_minutes", 10),
                "max_grade_value": context.get("max_grade_value", 0),
                "reason": pick.reason,
                "mastery": round(pick.candidate.mastery, 3),
                "expected_success": pick.expected,
                "score": pick.score,
                "xp": adaptive.xp_for_level(pick.candidate.level),
                **context.get("safe", {}),
            }
        )
    planned_xp = sum(item["xp"] for item in items)
    return {
        "course_uuid": course.course_uuid,
        "goal_xp": XP_GOAL,
        "planned_xp": planned_xp,
        "items_count": len(items),
        "items": items,
    }


async def get_state(
    db: AsyncSession,
    *,
    course: Course,
    user_id: int,
    org_id: int,
) -> dict:
    mastery = await _mastery_map(db, user_id, org_id, course.id)
    topics = sorted(
        (
            {
                "topic_key": row.topic_key,
                "topic_name": row.topic_name,
                "mastery": round(row.mastery, 3),
                "confidence": round(row.confidence, 3),
                "attempts": row.attempts,
                "passed": row.passed,
                "last_attempt_at": row.last_attempt_at,
                "next_review_at": row.next_review_at,
            }
            for row in mastery.values()
        ),
        key=lambda item: (item["mastery"], item["topic_key"]),
    )
    average = (
        sum(item["mastery"] for item in topics) / len(topics) if topics else 0.0
    )
    attempts_statement = select(PracticeAttempt).where(
        PracticeAttempt.user_id == user_id,
        PracticeAttempt.org_id == org_id,
        PracticeAttempt.course_id == course.id,
    )
    attempts = list((await db.execute(attempts_statement)).scalars().all())
    day_set: set[str] = set()
    for row in attempts:
        when = adaptive.parse_dt(row.graded_at) or adaptive.parse_dt(row.created_at)
        if when is not None:
            day_set.add(when.date().isoformat())
    days = sorted(day_set, reverse=True)
    streak = 0
    if days:
        cursor = datetime.now().date()
        if cursor.isoformat() not in day_set:
            cursor -= timedelta(days=1)
        while cursor.isoformat() in day_set:
            streak += 1
            cursor -= timedelta(days=1)

    return {
        "course_uuid": course.course_uuid,
        "summary": {
            "topics_started": sum(1 for item in topics if item["attempts"] > 0),
            "topics_mastered": sum(1 for item in topics if item["mastery"] >= 0.8),
            "average_mastery": round(average, 3),
            "attempts": len(attempts),
            "active_days": len(days),
            "streak_days": streak,
            "goal_xp": XP_GOAL,
        },
        "topics": topics,
    }
