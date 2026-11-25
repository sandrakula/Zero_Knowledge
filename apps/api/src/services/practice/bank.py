"""Organization-wide task bank: listing and inline metadata editing."""

from __future__ import annotations

from collections import Counter
from typing import Optional, Sequence

from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.practice.curriculum import (
    read_task_meta,
    resolve_level,
    resolve_minutes,
    resolve_topic_key,
    write_task_meta,
)

BANK_ROW_LIMIT = 5000


def _task_type(value) -> str:
    return str(value).split(".")[-1]


async def list_bank(
    db: AsyncSession,
    *,
    org_id: int,
    course_uuid: Optional[str] = None,
    level: Optional[int] = None,
    assignment_type: Optional[str] = None,
    topic_key: Optional[str] = None,
    query: Optional[str] = None,
    only_unleveled: bool = False,
    page: int = 1,
    limit: int = 50,
) -> dict:
    statement = (
        select(AssignmentTask, Assignment, Activity, Course, Chapter)
        .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
        .join(Activity, Activity.id == AssignmentTask.activity_id)
        .join(Course, Course.id == AssignmentTask.course_id)
        .outerjoin(Chapter, Chapter.id == AssignmentTask.chapter_id)
        .where(AssignmentTask.org_id == org_id)
    )
    if course_uuid:
        statement = statement.where(Course.course_uuid == course_uuid)
    if assignment_type:
        try:
            statement = statement.where(
                AssignmentTask.assignment_type
                == AssignmentTaskTypeEnum(assignment_type)
            )
        except ValueError:
            return {
                "items": [],
                "total": 0,
                "page": page,
                "limit": limit,
                "facets": {
                    "courses": [],
                    "topics": [],
                    "types": {},
                    "levels": {},
                    "unleveled": 0,
                },
            }
    if query:
        needle = f"%{query.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(AssignmentTask.title).like(needle),
                func.lower(AssignmentTask.description).like(needle),
            )
        )
    statement = statement.order_by(Course.name, Chapter.name, AssignmentTask.id).limit(
        BANK_ROW_LIMIT
    )
    rows = (await db.execute(statement)).all()

    courses: dict[str, dict] = {}
    topics: dict[str, dict] = {}
    types: Counter = Counter()
    level_counts: Counter = Counter()
    unleveled_count = 0
    items: list[dict] = []

    for task, assignment, activity, course, chapter in rows:
        meta = read_task_meta(task)
        task_level = resolve_level(task, chapter)
        task_topic = resolve_topic_key(task, chapter)
        has_explicit_level = "level" in meta
        topic_name = chapter.name if chapter else task_topic
        types[_task_type(task.assignment_type)] += 1
        level_counts[task_level] += 1
        if not has_explicit_level:
            unleveled_count += 1
        courses[course.course_uuid] = {
            "course_uuid": course.course_uuid,
            "name": course.name,
        }
        if task_topic:
            topics[task_topic] = {
                "topic_key": task_topic,
                "name": topic_name,
                "course_uuid": course.course_uuid,
            }

        if level is not None and task_level != level:
            continue
        if only_unleveled and has_explicit_level:
            continue
        if topic_key and task_topic != topic_key:
            continue

        items.append(
            {
                "task_uuid": task.assignment_task_uuid,
                "title": task.title,
                "assignment_type": _task_type(task.assignment_type),
                "level": task_level,
                "topic_key": task_topic,
                "topic_name": topic_name,
                "estimated_minutes": resolve_minutes(task, chapter),
                "has_explicit_level": has_explicit_level,
                "course_uuid": course.course_uuid,
                "course_name": course.name,
                "chapter_uuid": getattr(chapter, "chapter_uuid", ""),
                "chapter_name": chapter.name if chapter else "",
                "activity_uuid": activity.activity_uuid,
                "published": bool(
                    assignment.published and activity.published and course.published
                ),
            }
        )

    total = len(items)
    page = max(1, page)
    limit = max(1, min(200, limit))
    start = (page - 1) * limit
    page_items = items[start : start + limit]

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "limit": limit,
        "facets": {
            "courses": sorted(courses.values(), key=lambda row: row["name"]),
            "topics": sorted(topics.values(), key=lambda row: row["name"]),
            "types": dict(types),
            "levels": {str(key): value for key, value in sorted(level_counts.items())},
            "unleveled": unleveled_count,
        },
    }


async def update_bank_tasks(
    db: AsyncSession,
    *,
    org_id: int,
    updates: Sequence[dict],
) -> dict:
    uuids = [str(item.get("task_uuid") or "") for item in updates]
    uuids = [uuid for uuid in uuids if uuid]
    if not uuids:
        return {"updated": 0, "courses": []}

    rows = list(
        (
            await db.execute(
                select(AssignmentTask, Course)
                .join(Course, Course.id == AssignmentTask.course_id)
                .where(
                    AssignmentTask.org_id == org_id,
                    AssignmentTask.assignment_task_uuid.in_(uuids),  # type: ignore[attr-defined]
                )
            )
        ).all()
    )
    by_uuid = {task.assignment_task_uuid: (task, course) for task, course in rows}
    updated_courses: set[str] = set()
    updated = 0
    for item in updates:
        uuid = str(item.get("task_uuid") or "")
        pair = by_uuid.get(uuid)
        if pair is None:
            continue
        task, course = pair
        write_task_meta(
            task,
            {
                "topic_key": item.get("topic_key"),
                "level": item.get("level"),
                "estimated_minutes": item.get("estimated_minutes"),
            },
        )
        db.add(task)
        updated_courses.add(course.course_uuid)
        updated += 1

    await db.commit()
    if updated_courses:
        try:
            from src.services.courses.cache import invalidate_course_meta_cache

            for course_uuid in updated_courses:
                invalidate_course_meta_cache(course_uuid)
        except Exception:
            pass
    return {"updated": updated, "courses": sorted(updated_courses)}
