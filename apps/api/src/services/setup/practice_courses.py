"""Seed the three starter practice courses (Python, SQL, maths/logic).

The courses are product content, not user data. Seeding is additive and
idempotent: every chapter, activity and task carries a stable ``practice.key``
in its metadata, and re-running only creates what is missing. Teacher edits to
existing rows are never overwritten.

The Informatics course is a separate seeder (``informatics_course.py``) and is
not touched here.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import _async_session_factory
from src.db.courses.activities import (
    Activity,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course, ThumbnailType
from src.db.organizations import Organization
from src.services.setup.practice_seed_data import build_practice_bundles

logger = logging.getLogger(__name__)

SEED_NAME = "practice"
SEED_ENV_FLAG = "LEARNHOUSE_PRACTICE_SEED"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _as_dict(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        import json

        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _seed_key(meta, field: str = "key") -> str:
    block = _as_dict(meta).get(SEED_NAME)
    if isinstance(block, dict):
        return str(block.get(field) or "")
    return ""


def _seed_enabled() -> bool:
    if os.getenv("TESTING", "false").lower() == "true":
        return False
    flag = os.getenv(SEED_ENV_FLAG, "true").strip().lower()
    return flag not in {"0", "false", "off", "no"}


def _curriculum(chapter_data: dict) -> dict:
    raw = _as_dict(chapter_data.get("curriculum"))
    return {
        "topic_key": chapter_data["key"],
        "section": str(raw.get("section") or "")[:200],
        "module": str(raw.get("module") or "")[:200],
        "level": max(1, min(3, int(raw.get("level") or 1))),
        "prerequisites": list(raw.get("prerequisites") or []),
        "credit": dict(raw.get("credit") or {}),
        "estimated_minutes": max(1, min(600, int(raw.get("estimated_minutes") or 10))),
        "order": raw.get("order"),
    }


async def _pick_org(db: AsyncSession) -> Optional[Organization]:
    org = (
        await db.execute(select(Organization).where(Organization.slug == "default"))
    ).scalars().first()
    if org is None:
        org = (await db.execute(select(Organization).limit(1))).scalars().first()
    return org


def _find_course(courses: list[Course], seed_key: str) -> Optional[Course]:
    for course in courses:
        meta = _as_dict(course.extra_metadata)
        if meta.get("seed") == SEED_NAME and meta.get("seed_key") == seed_key:
            return course
    return None


async def seed_bundle(
    db: AsyncSession,
    org: Organization,
    bundle: dict,
) -> dict:
    """Apply one course bundle. Caller owns the transaction."""
    now = _now()
    report = {
        "seed_key": bundle["course"]["seed_key"],
        "course_created": False,
        "chapters_created": 0,
        "activities_created": 0,
        "assignments_created": 0,
        "tasks_created": 0,
    }

    courses = list(
        (await db.execute(select(Course).where(Course.org_id == org.id))).scalars().all()
    )
    seed_key = bundle["course"]["seed_key"]
    course = _find_course(courses, seed_key)

    if course is None:
        course_data = bundle["course"]
        course = Course(
            name=course_data["name"],
            description=course_data.get("description") or "",
            about=course_data.get("about") or "",
            learnings=course_data.get("learnings") or "",
            tags=course_data.get("tags") or "",
            thumbnail_type=ThumbnailType.IMAGE,
            thumbnail_image="",
            public=bool(course_data.get("public", True)),
            published=bool(course_data.get("published", True)),
            open_to_contributors=False,
            org_id=org.id,
            course_uuid=f"course_{uuid4()}",
            creation_date=now,
            update_date=now,
            extra_metadata={
                "seed": SEED_NAME,
                "seed_key": seed_key,
                "version": bundle.get("version", 1),
            },
        )
        db.add(course)
        await db.flush()
        report["course_created"] = True

    db_chapters = list(
        (await db.execute(select(Chapter).where(Chapter.course_id == course.id))).scalars().all()
    )
    chapters_by_key = {
        key: chapter
        for chapter in db_chapters
        if (key := _seed_key(chapter.extra_metadata))
    }
    links = list(
        (
            await db.execute(
                select(CourseChapter).where(CourseChapter.course_id == course.id)
            )
        ).scalars().all()
    )
    chapter_orders = {row.chapter_id: row.order for row in links}

    db_activities = list(
        (
            await db.execute(
                select(Activity).where(
                    Activity.course_id == course.id,
                    Activity.org_id == org.id,
                )
            )
        ).scalars().all()
    )
    activities_by_key = {
        key: activity
        for activity in db_activities
        if (key := _seed_key(activity.extra_metadata))
    }

    for chapter_index, chapter_data in enumerate(bundle["chapters"]):
        chapter_key = chapter_data["key"]
        chapter = chapters_by_key.get(chapter_key)
        if chapter is None:
            meta = {"practice": {"key": chapter_key}, "curriculum": _curriculum(chapter_data)}
            chapter = Chapter(
                name=chapter_data["name"],
                description=chapter_data.get("description") or "",
                lock_type=LockType.PUBLIC,
                org_id=org.id,
                course_id=course.id,
                chapter_uuid=f"chapter_{uuid4()}",
                creation_date=now,
                update_date=now,
                extra_metadata=meta,
            )
            db.add(chapter)
            await db.flush()
            chapters_by_key[chapter_key] = chapter
            report["chapters_created"] += 1

        if chapter.id not in chapter_orders:
            order = int(chapter_data.get("curriculum", {}).get("order", chapter_index))
            db.add(
                CourseChapter(
                    order=order,
                    course_id=course.id,
                    chapter_id=chapter.id,
                    org_id=org.id,
                    creation_date=now,
                    update_date=now,
                )
            )
            chapter_orders[chapter.id] = order
            await db.flush()

        chapter_activities = list(
            (
                await db.execute(
                    select(ChapterActivity).where(
                        ChapterActivity.chapter_id == chapter.id
                    )
                )
            ).scalars().all()
        )
        activity_orders = {
            row.activity_id: row.order for row in chapter_activities
        }

        for activity_index, activity_data in enumerate(chapter_data.get("activities") or []):
            activity_key = activity_data["key"]
            activity = activities_by_key.get(activity_key)
            if activity is None:
                activity = Activity(
                    name=activity_data["name"],
                    activity_type=ActivityTypeEnum(activity_data["activity_type"]),
                    activity_sub_type=ActivitySubTypeEnum(
                        activity_data["activity_sub_type"]
                    ),
                    content=_as_dict(activity_data.get("content")),
                    details=_as_dict(activity_data.get("details")),
                    extra_metadata={"practice": {"key": activity_key}},
                    published=True,
                    lock_type=ActivityLockType.PUBLIC,
                    course_id=course.id,
                    org_id=org.id,
                    activity_uuid=f"activity_{uuid4()}",
                    creation_date=now,
                    update_date=now,
                )
                db.add(activity)
                await db.flush()
                activities_by_key[activity_key] = activity
                report["activities_created"] += 1

            if activity.id not in activity_orders:
                db.add(
                    ChapterActivity(
                        order=activity_index,
                        chapter_id=chapter.id,
                        activity_id=activity.id,
                        course_id=course.id,
                        org_id=org.id,
                        creation_date=now,
                        update_date=now,
                    )
                )
                activity_orders[activity.id] = activity_index
                await db.flush()

            assignment_data = activity_data.get("assignment")
            if not assignment_data:
                continue

            assignment = (
                await db.execute(
                    select(Assignment).where(Assignment.activity_id == activity.id)
                )
            ).scalars().first()
            if assignment is None:
                assignment = Assignment(
                    title=assignment_data.get("title") or activity.name,
                    description=assignment_data.get("description") or "",
                    due_date=None,
                    published=True,
                    grading_type=GradingTypeEnum(
                        assignment_data.get("grading_type") or "PERCENTAGE"
                    ),
                    auto_grading=bool(assignment_data.get("auto_grading", True)),
                    org_id=org.id,
                    course_id=course.id,
                    chapter_id=chapter.id,
                    activity_id=activity.id,
                    assignment_uuid=f"assignment_{uuid4()}",
                    creation_date=now,
                    update_date=now,
                )
                db.add(assignment)
                await db.flush()
                report["assignments_created"] += 1

            existing_tasks = list(
                (
                    await db.execute(
                        select(AssignmentTask).where(
                            AssignmentTask.assignment_id == assignment.id
                        )
                    )
                ).scalars().all()
            )
            existing_keys = {
                str(_as_dict(task.contents).get("_meta", {}).get("key") or "")
                for task in existing_tasks
            }
            next_order = max((task.order or 0 for task in existing_tasks), default=-1) + 1

            for task_data in assignment_data.get("tasks") or []:
                task_key = task_data.get("key")
                if task_key and task_key in existing_keys:
                    continue
                contents = _as_dict(task_data.get("contents"))
                meta = dict(contents.get("_meta") or {})
                if task_key:
                    meta["key"] = task_key
                meta.setdefault("source", "seed")
                contents["_meta"] = meta
                db.add(
                    AssignmentTask(
                        title=task_data["title"],
                        description=task_data.get("description") or "",
                        hint=task_data.get("hint") or "",
                        assignment_type=AssignmentTaskTypeEnum(
                            task_data["assignment_type"]
                        ),
                        contents=contents,
                        max_grade_value=int(task_data.get("max_grade_value") or 100),
                        order=next_order,
                        assignment_id=assignment.id,
                        org_id=org.id,
                        course_id=course.id,
                        chapter_id=chapter.id,
                        activity_id=activity.id,
                        assignment_task_uuid=(
                            f"assignmenttask_{uuid4()}"
                        ),
                        creation_date=now,
                        update_date=now,
                    )
                )
                next_order += 1
                report["tasks_created"] += 1

    course.update_date = now
    await db.commit()
    # The catalog list is cached per org; a direct seed bypasses the normal
    # create/update endpoints, so drop the cache explicitly.
    try:
        from src.services.courses.cache import invalidate_courses_cache

        invalidate_courses_cache(org.slug)
    except Exception:
        logger.debug("Practice course cache invalidation failed", exc_info=True)
    return report


async def ensure_default_practice_courses(
    session_factory=None,
    bundles: Optional[list[dict]] = None,
) -> Optional[dict]:
    """Seed the starter courses once per startup. Never breaks startup."""
    if not _seed_enabled():
        return None
    factory = session_factory or _async_session_factory
    try:
        async with factory() as db:
            org = await _pick_org(db)
            if org is None:
                return None
            reports = []
            for bundle in bundles or build_practice_bundles():
                reports.append(await seed_bundle(db, org, bundle))
            return {"courses": reports}
    except Exception:
        logger.exception("Practice course seeding failed")
        return None
