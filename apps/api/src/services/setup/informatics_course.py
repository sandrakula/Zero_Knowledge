"""Seed the bundled informatics course skeleton.

The course is part of the product, not user content: the outline of the
informatics.msk.ru curriculum (23 topics, 52 practice modules) ships with the
API and is created once in the default organization. Tasks and theory are
added to ``informatics_seed.json`` later and replayed by the same seeder.

Design rules:

* **Additive only.** Existing chapters, activities, assignments and tasks are
  never edited or deleted. Re-running the seeder only creates what is missing,
  so a teacher's edits survive an upgrade.
* **Idempotent.** Everything is matched by the stable keys stored in
  ``extra_metadata`` (``chapter_key`` / ``activity_key``), not by display
  names, which teachers are free to rename.
* **One transaction.** The whole outline is committed at the end. A failure
  rolls back instead of leaving a half-built course that the next start would
  consider "already seeded" and never repair.
* **Never breaks startup.** The seeder is called from the application lifespan;
  every failure is logged and swallowed.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import select
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

logger = logging.getLogger(__name__)

SEED_NAME = "informatics"
SEED_FILE = Path(__file__).with_name("informatics_seed.json")
SEED_ENV_FLAG = "LEARNHOUSE_INFORMATICS_SEED"


class SeedError(Exception):
    """The bundle is malformed or cannot be applied."""


def _now() -> str:
    return datetime.now().isoformat()


def _json_value(value: Any) -> dict:
    """SQLite returns JSON columns as strings; accept either form."""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value or {}


def _meta_key(metadata: Any, field: str) -> Optional[str]:
    meta = _json_value(metadata)
    block = meta.get(SEED_NAME)
    if isinstance(block, dict):
        value = block.get(field)
        if isinstance(value, str) and value:
            return value
    return None


def _seed_enabled() -> bool:
    if os.getenv("TESTING", "false").lower() == "true":
        return False
    flag = os.getenv(SEED_ENV_FLAG, "true").strip().lower()
    return flag not in {"0", "false", "off", "no"}


def load_seed_bundle(path: Path = SEED_FILE) -> dict:
    """Read and validate a course bundle. Raises ``SeedError`` on bad input."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SeedError(f"seed bundle not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SeedError(f"seed bundle is not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise SeedError("seed bundle must be a JSON object")
    if data.get("schema_version") != 1:
        raise SeedError(f"unsupported schema_version: {data.get('schema_version')!r}")

    course = data.get("course")
    if not isinstance(course, dict) or not isinstance(course.get("name"), str):
        raise SeedError("seed bundle is missing course.name")
    if not isinstance(data.get("chapters"), list):
        raise SeedError("seed bundle is missing chapters")

    seen_chapters: set[str] = set()
    seen_activities: set[str] = set()
    for chapter in data["chapters"]:
        if not isinstance(chapter, dict) or not isinstance(chapter.get("name"), str):
            raise SeedError("every chapter needs a name")
        chapter_key = chapter.get("key")
        if not isinstance(chapter_key, str) or not chapter_key:
            raise SeedError(f"chapter {chapter['name']!r} is missing a stable key")
        if chapter_key in seen_chapters:
            raise SeedError(f"duplicate chapter key: {chapter_key}")
        seen_chapters.add(chapter_key)

        for activity in chapter.get("activities") or []:
            if not isinstance(activity, dict):
                raise SeedError(f"invalid activity in chapter {chapter_key}")
            activity_key = activity.get("key")
            if not isinstance(activity_key, str) or not activity_key:
                raise SeedError(f"activity in {chapter_key} is missing a stable key")
            if activity_key in seen_activities:
                raise SeedError(f"duplicate activity key: {activity_key}")
            seen_activities.add(activity_key)
            if not isinstance(activity.get("name"), str) or not activity["name"]:
                raise SeedError(f"activity {activity_key} is missing a name")
            try:
                ActivityTypeEnum(activity.get("activity_type"))
                ActivitySubTypeEnum(activity.get("activity_sub_type"))
            except ValueError as exc:
                raise SeedError(f"activity {activity_key} has an invalid type: {exc}") from exc
            assignment = activity.get("assignment")
            if assignment is not None:
                if not isinstance(assignment, dict):
                    raise SeedError(f"activity {activity_key} has an invalid assignment")
                if not isinstance(assignment.get("title"), str) or not assignment["title"]:
                    raise SeedError(f"assignment in {activity_key} needs a title")
                for task in assignment.get("tasks") or []:
                    if not isinstance(task, dict) or not isinstance(task.get("title"), str):
                        raise SeedError(f"invalid task in {activity_key}")
                    try:
                        AssignmentTaskTypeEnum(task.get("assignment_type"))
                    except ValueError as exc:
                        raise SeedError(
                            f"task {task.get('title')!r} has an invalid type: {exc}"
                        ) from exc

    return data


async def _pick_org(db: AsyncSession) -> Optional[Organization]:
    org = (
        await db.execute(select(Organization).where(Organization.slug == "default"))
    ).scalars().first()
    if org is None:
        org = (await db.execute(select(Organization).limit(1))).scalars().first()
    return org


def _find_seeded_course(courses: list[Course]) -> Optional[Course]:
    for course in courses:
        meta = _json_value(course.extra_metadata)
        if meta.get("seed") == SEED_NAME:
            return course
    return None


async def seed_course_outline(
    db: AsyncSession,
    org: Organization,
    bundle: dict,
) -> dict:
    """Apply ``bundle`` to ``org`` and return a report of what changed.

    The caller owns the transaction. ``db.commit()`` is called exactly once on
    success; on failure the session is rolled back.
    """
    now = _now()
    report = {
        "course_created": False,
        "chapters_created": 0,
        "activities_created": 0,
        "assignments_created": 0,
        "tasks_created": 0,
    }

    org_courses = list(
        (await db.execute(select(Course).where(Course.org_id == org.id))).scalars().all()
    )
    course = _find_seeded_course(org_courses)

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
                "schema_version": bundle.get("schema_version", 1),
                "version": bundle.get("version", 1),
                # This course is graded on an external judge, so the LMS only
                # sees verdicts through the browser userscript. Requiring it is
                # how the server enforces that every learner installs it.
                "informatics": {"require_script": True},
            },
        )
        db.add(course)
        await db.flush()
        report["course_created"] = True

    db_chapters = list(
        (await db.execute(select(Chapter).where(Chapter.course_id == course.id))).scalars().all()
    )
    chapters_by_key: dict[str, Chapter] = {}
    for chapter in db_chapters:
        key = _meta_key(chapter.extra_metadata, "chapter_key")
        if key:
            chapters_by_key[key] = chapter

    db_course_chapters = list(
        (
            await db.execute(
                select(CourseChapter).where(CourseChapter.course_id == course.id)
            )
        ).scalars().all()
    )
    chapter_orders = {row.chapter_id: row.order for row in db_course_chapters}
    next_chapter_order = max(chapter_orders.values(), default=-1) + 1

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
    activities_by_key: dict[str, Activity] = {}
    for activity in db_activities:
        key = _meta_key(activity.extra_metadata, "activity_key")
        if key:
            activities_by_key[key] = activity

    for chapter_data in bundle["chapters"]:
        chapter_key = chapter_data["key"]
        chapter = chapters_by_key.get(chapter_key)

        if chapter is None:
            chapter_meta = dict(_json_value(chapter_data.get("extra_metadata")))
            block = dict(chapter_meta.get(SEED_NAME) or {})
            block["chapter_key"] = chapter_key
            chapter_meta[SEED_NAME] = block
            chapter = Chapter(
                name=chapter_data["name"],
                description=chapter_data.get("description") or "",
                lock_type=LockType.PUBLIC,
                org_id=org.id,
                course_id=course.id,
                chapter_uuid=f"chapter_{uuid4()}",
                creation_date=now,
                update_date=now,
                extra_metadata=chapter_meta,
            )
            db.add(chapter)
            await db.flush()
            chapters_by_key[chapter_key] = chapter
            report["chapters_created"] += 1

        if chapter.id not in chapter_orders:
            db.add(
                CourseChapter(
                    order=next_chapter_order,
                    course_id=course.id,
                    chapter_id=chapter.id,
                    org_id=org.id,
                    creation_date=now,
                    update_date=now,
                )
            )
            chapter_orders[chapter.id] = next_chapter_order
            next_chapter_order += 1
            await db.flush()

        db_chapter_activities = list(
            (
                await db.execute(
                    select(ChapterActivity).where(ChapterActivity.chapter_id == chapter.id)
                )
            ).scalars().all()
        )
        activity_orders = {row.activity_id: row.order for row in db_chapter_activities}
        next_activity_order = max(activity_orders.values(), default=-1) + 1

        for activity_data in chapter_data.get("activities") or []:
            activity_key = activity_data["key"]
            activity = activities_by_key.get(activity_key)

            if activity is None:
                activity_meta = dict(_json_value(activity_data.get("extra_metadata")))
                block = dict(activity_meta.get(SEED_NAME) or {})
                block["activity_key"] = activity_key
                activity_meta[SEED_NAME] = block
                activity = Activity(
                    name=activity_data["name"],
                    activity_type=ActivityTypeEnum(activity_data["activity_type"]),
                    activity_sub_type=ActivitySubTypeEnum(activity_data["activity_sub_type"]),
                    content=_json_value(activity_data.get("content")),
                    details=_json_value(activity_data.get("details")),
                    extra_metadata=activity_meta,
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
                        order=next_activity_order,
                        chapter_id=chapter.id,
                        activity_id=activity.id,
                        course_id=course.id,
                        org_id=org.id,
                        creation_date=now,
                        update_date=now,
                    )
                )
                activity_orders[activity.id] = next_activity_order
                next_activity_order += 1
                await db.flush()

            assignment_data = activity_data.get("assignment")
            if assignment_data is None:
                continue

            assignment = (
                await db.execute(
                    select(Assignment).where(Assignment.activity_id == activity.id)
                )
            ).scalars().first()
            if assignment is None:
                assignment = Assignment(
                    title=assignment_data["title"],
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
            existing_task_keys = {
                _json_value(task.contents).get("_meta", {}).get("key")
                for task in existing_tasks
            }
            next_task_order = max(
                (task.order or 0 for task in existing_tasks), default=-1
            ) + 1

            for task_data in assignment_data.get("tasks") or []:
                task_key = task_data.get("key")
                if task_key and task_key in existing_task_keys:
                    continue
                contents = _json_value(task_data.get("contents"))
                meta = dict(contents.get("_meta") or {})
                if task_key:
                    meta["key"] = task_key
                contents["_meta"] = meta
                db.add(
                    AssignmentTask(
                        title=task_data["title"],
                        description=task_data.get("description") or "",
                        hint=task_data.get("hint") or "",
                        assignment_type=AssignmentTaskTypeEnum(task_data["assignment_type"]),
                        contents=contents,
                        max_grade_value=int(task_data.get("max_grade_value") or 100),
                        order=next_task_order,
                        assignment_id=assignment.id,
                        org_id=org.id,
                        course_id=course.id,
                        chapter_id=chapter.id,
                        activity_id=activity.id,
                        assignment_task_uuid=f"assignmenttask_{uuid4()}",
                        creation_date=now,
                        update_date=now,
                    )
                )
                next_task_order += 1
                report["tasks_created"] += 1

    existing_course_meta = dict(_json_value(course.extra_metadata))
    existing_course_meta.update(
        {
            "seed": SEED_NAME,
            "schema_version": bundle.get("schema_version", 1),
            "version": bundle.get("version", 1),
        }
    )
    # Product requirement: the bundled course is always titled "Informatics",
    # whatever a previous seed or a rename left in the database. Only this
    # seeded course is touched; every other course keeps its own name.
    course.name = bundle["course"]["name"]
    # Merge instead of replace: teachers may add their own keys under
    # ``informatics``, and re-seeding must not drop them.
    informatics_meta = dict(existing_course_meta.get("informatics") or {})
    informatics_meta["require_script"] = True
    existing_course_meta["informatics"] = informatics_meta
    course.extra_metadata = existing_course_meta
    course.update_date = now

    await db.commit()
    # A rename or a new course bypasses the API cache; keep the catalog fresh.
    try:
        from src.services.courses.cache import invalidate_courses_cache

        invalidate_courses_cache(org.slug)
    except Exception:
        logger.debug("Informatics course cache invalidation failed", exc_info=True)
    return report


async def ensure_default_informatics_course(
    session_factory=None,
    bundle: Optional[dict] = None,
) -> Optional[dict]:
    """Seed the bundled outline once. Never raises into application startup."""
    if not _seed_enabled():
        return None

    try:
        data = bundle if bundle is not None else load_seed_bundle()
    except SeedError as exc:
        logger.warning("Informatics seed skipped: %s", exc)
        return None

    factory = session_factory or _async_session_factory
    try:
        async with factory() as db:
            org = await _pick_org(db)
            if org is None:
                logger.info("Informatics seed skipped: no organization exists yet")
                return None
            report = await seed_course_outline(db, org, data)
            logger.info(
                "Informatics course outline ready for org %s: %s",
                org.slug,
                report,
            )
            return report
    except Exception:
        logger.exception("Failed to seed the bundled informatics course")
        return None
