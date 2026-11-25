"""Course curriculum metadata: sections, modules, levels and prerequisites.

Curriculum lives in existing JSON columns, so the course model itself does not
change:

* ``chapter.extra_metadata["curriculum"]`` — section, module, level 1..3,
  prerequisite topic keys, credit weights, estimated minutes;
* ``assignment_task.contents["_meta"]`` — the topic a task belongs to, its
  level, estimated minutes and provenance.

The functions here normalize those blobs, merge partial updates, and validate
the prerequisite graph before writing anything.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import attributes
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.services.practice.schemas import CurriculumUpdate

CURRICULUM_KEY = "curriculum"
TASK_META_KEY = "_meta"
DEFAULT_LEVEL = 1
DEFAULT_MINUTES = 10


def _as_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _clean_key(value: Any) -> str:
    return str(value or "").strip()[:128]


def _clean_level(value: Any) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError):
        level = DEFAULT_LEVEL
    return max(1, min(3, level))


def _clean_minutes(value: Any) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = DEFAULT_MINUTES
    return max(1, min(600, minutes))


def _clean_prerequisites(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple, set)):
        return []
    cleaned: list[str] = []
    for item in value:
        key = _clean_key(item)
        if key and key not in cleaned:
            cleaned.append(key)
    return cleaned[:50]


def _clean_credit(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, float] = {}
    for key, weight in value.items():
        topic = _clean_key(key)
        if not topic:
            continue
        try:
            cleaned[topic] = round(max(0.0, min(1.0, float(weight))), 3)
        except (TypeError, ValueError):
            continue
    return dict(list(cleaned.items())[:50])


def read_chapter_curriculum(chapter: Chapter | None) -> dict:
    """The normalized curriculum block of a chapter, with safe defaults."""
    meta = _as_dict(chapter.extra_metadata) if chapter is not None else {}
    raw = _as_dict(meta.get(CURRICULUM_KEY))
    chapter_uuid = getattr(chapter, "chapter_uuid", "") or ""
    return {
        "chapter_uuid": chapter_uuid,
        "topic_key": _clean_key(raw.get("topic_key")) or chapter_uuid,
        "section": str(raw.get("section") or "")[:200],
        "module": str(raw.get("module") or "")[:200],
        "level": _clean_level(raw.get("level")),
        "prerequisites": _clean_prerequisites(raw.get("prerequisites")),
        "credit": _clean_credit(raw.get("credit")),
        "estimated_minutes": _clean_minutes(
            raw.get("estimated_minutes", DEFAULT_MINUTES)
        ),
        "order": raw.get("order") if isinstance(raw.get("order"), int) else None,
    }


def write_chapter_curriculum(chapter: Chapter, values: dict) -> None:
    """Persist a normalized curriculum block without dropping other metadata."""
    meta = _as_dict(chapter.extra_metadata)
    meta[CURRICULUM_KEY] = {
        "topic_key": _clean_key(values.get("topic_key")) or chapter.chapter_uuid,
        "section": str(values.get("section") or "")[:200],
        "module": str(values.get("module") or "")[:200],
        "level": _clean_level(values.get("level")),
        "prerequisites": _clean_prerequisites(values.get("prerequisites")),
        "credit": _clean_credit(values.get("credit")),
        "estimated_minutes": _clean_minutes(values.get("estimated_minutes")),
        "order": values.get("order") if isinstance(values.get("order"), int) else None,
    }
    chapter.extra_metadata = meta
    attributes.flag_modified(chapter, "extra_metadata")


def read_task_meta(task: AssignmentTask | None) -> dict:
    if task is None:
        return {}
    contents = _as_dict(task.contents)
    raw = _as_dict(contents.get(TASK_META_KEY))
    meta: dict = {
        "topic_key": _clean_key(raw.get("topic_key")),
        "estimated_minutes": (
            _clean_minutes(raw["estimated_minutes"])
            if "estimated_minutes" in raw
            else None
        ),
        "source": str(raw.get("source") or "")[:64],
        "validated": bool(raw.get("validated", False)),
        "tests_generated": bool(raw.get("tests_generated", False)),
    }
    if "level" in raw:
        meta["level"] = _clean_level(raw.get("level"))
    return meta


def write_task_meta(task: AssignmentTask, values: dict) -> None:
    """Merge ``values`` into ``contents["_meta"]`` and keep the rest of contents."""
    contents = _as_dict(task.contents)
    raw = _as_dict(contents.get(TASK_META_KEY))
    if values.get("topic_key") is not None:
        raw["topic_key"] = _clean_key(values.get("topic_key"))
    if values.get("level") is not None:
        raw["level"] = _clean_level(values.get("level"))
    if values.get("estimated_minutes") is not None:
        raw["estimated_minutes"] = _clean_minutes(values.get("estimated_minutes"))
    for key in ("source", "validated", "tests_generated"):
        if key in values:
            raw[key] = values[key]
    contents[TASK_META_KEY] = raw
    task.contents = contents
    attributes.flag_modified(task, "contents")


def resolve_topic_key(task: AssignmentTask | None, chapter: Chapter | None) -> str:
    meta = read_task_meta(task)
    if meta.get("topic_key"):
        return str(meta["topic_key"])
    curriculum = read_chapter_curriculum(chapter)
    return str(curriculum.get("topic_key") or getattr(chapter, "chapter_uuid", "") or "")


def resolve_level(task: AssignmentTask | None, chapter: Chapter | None) -> int:
    meta = read_task_meta(task)
    if meta.get("level") is not None:
        return _clean_level(meta["level"])
    return _clean_level(read_chapter_curriculum(chapter).get("level"))


def resolve_minutes(task: AssignmentTask | None, chapter: Chapter | None) -> int:
    meta = read_task_meta(task)
    if meta.get("estimated_minutes") is not None:
        return _clean_minutes(meta["estimated_minutes"])
    return _clean_minutes(read_chapter_curriculum(chapter).get("estimated_minutes"))


async def _load_chapters(db: AsyncSession, course: Course) -> list[tuple[Chapter, int]]:
    statement = (
        select(Chapter, CourseChapter.order)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
        .where(CourseChapter.course_id == course.id)
        .order_by(CourseChapter.order)
    )
    rows = (await db.execute(statement)).all()
    return [(row[0], int(row[1] or 0)) for row in rows]


async def _load_tasks(db: AsyncSession, course: Course) -> list[tuple[AssignmentTask, bool]]:
    statement = (
        select(AssignmentTask, Assignment.published)
        .outerjoin(Assignment, Assignment.id == AssignmentTask.assignment_id)
        .where(AssignmentTask.course_id == course.id)
    )
    rows = (await db.execute(statement)).all()
    return [(row[0], bool(row[1])) for row in rows]


async def get_course_curriculum(db: AsyncSession, course: Course) -> dict:
    """The whole curriculum of a course: topics, tasks and level statistics."""
    chapter_rows = await _load_chapters(db, course)
    task_rows = await _load_tasks(db, course)

    activity_statement = select(Activity.id, Activity.activity_uuid).where(
        Activity.course_id == course.id
    )
    activity_uuids = {
        row[0]: row[1] for row in (await db.execute(activity_statement)).all()
    }

    chapter_by_id = {chapter.id: chapter for chapter, _ in chapter_rows}
    task_counts: dict[int, int] = {}
    level_counts: dict[int, int] = {}
    tasks_without_meta = 0
    for task, _published in task_rows:
        task_counts[task.chapter_id] = task_counts.get(task.chapter_id, 0) + 1
        level = resolve_level(task, chapter_by_id.get(task.chapter_id))
        level_counts[level] = level_counts.get(level, 0) + 1
        if "level" not in read_task_meta(task):
            tasks_without_meta += 1

    topics: list[dict] = []
    for chapter, order in chapter_rows:
        curriculum = read_chapter_curriculum(chapter)
        curriculum["chapter_id"] = chapter.id
        curriculum["name"] = chapter.name
        curriculum["order"] = (
            curriculum["order"] if curriculum["order"] is not None else order
        )
        curriculum["tasks_total"] = task_counts.get(chapter.id, 0)
        curriculum["_index"] = len(topics)
        topics.append(curriculum)

    topics.sort(
        key=lambda topic: (
            topic["order"] if topic["order"] is not None else 10**6,
            topic["_index"],
        )
    )

    sections: list[dict] = []
    section_index: dict[tuple[str, str], dict] = {}
    for topic in topics:
        section_name = topic["section"]
        module_name = topic["module"]
        key = (section_name, module_name)
        block = section_index.get(key)
        if block is None:
            section = next(
                (item for item in sections if item["name"] == section_name), None
            )
            if section is None:
                section = {"name": section_name, "modules": []}
                sections.append(section)
            block = {"name": module_name, "topics": []}
            section["modules"].append(block)
            section_index[key] = block
        block["topics"].append(topic["chapter_uuid"])

    tasks: list[dict] = []
    for task, published in task_rows:
        chapter = chapter_by_id.get(task.chapter_id)
        meta = read_task_meta(task)
        tasks.append(
            {
                "task_uuid": task.assignment_task_uuid,
                "task_id": task.id,
                "title": task.title,
                "assignment_type": str(task.assignment_type).split(".")[-1],
                "chapter_uuid": getattr(chapter, "chapter_uuid", ""),
                "activity_uuid": activity_uuids.get(task.activity_id, ""),
                "topic_key": resolve_topic_key(task, chapter),
                "level": resolve_level(task, chapter),
                "estimated_minutes": resolve_minutes(task, chapter),
                "published": published,
                "meta": meta,
            }
        )

    for topic in topics:
        topic.pop("_index", None)

    return {
        "course_uuid": course.course_uuid,
        "course_id": course.id,
        "name": course.name,
        "topics": topics,
        "tasks": tasks,
        "sections": sections,
        "stats": {
            "topics": len(topics),
            "tasks": len(tasks),
            "tasks_by_level": {str(level): count for level, count in sorted(level_counts.items())},
            "published_tasks": sum(1 for _task, published in task_rows if published),
            "topics_without_tasks": sum(1 for topic in topics if not topic["tasks_total"]),
            "tasks_without_level": tasks_without_meta,
        },
    }


def _find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    """Return one cycle in the topic prerequisite graph, or None."""
    state: dict[str, int] = {key: 0 for key in graph}
    stack: list[str] = []

    def walk(node: str) -> list[str] | None:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if nxt not in state:
                continue
            if state[nxt] == 1:
                start = stack.index(nxt)
                return stack[start:] + [nxt]
            if state[nxt] == 0:
                found = walk(nxt)
                if found:
                    return found
        stack.pop()
        state[node] = 2
        return None

    for key in graph:
        if state[key] == 0:
            found = walk(key)
            if found:
                return found
    return None


async def apply_course_curriculum(
    db: AsyncSession, course: Course, update: CurriculumUpdate
) -> dict:
    """Merge a partial curriculum update and validate the prerequisite graph."""
    chapter_rows = await _load_chapters(db, course)
    chapters = {chapter.chapter_uuid: (chapter, order) for chapter, order in chapter_rows}
    task_rows = await _load_tasks(db, course)
    tasks = {task.assignment_task_uuid: task for task, _published in task_rows}

    seen: set[str] = set()
    for topic in update.topics:
        if topic.chapter_uuid in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Topic {topic.chapter_uuid} is listed twice",
            )
        seen.add(topic.chapter_uuid)
        if topic.chapter_uuid not in chapters:
            raise HTTPException(
                status_code=400,
                detail=f"Chapter {topic.chapter_uuid} is not part of this course",
            )

    effective: dict[str, dict] = {}
    for chapter, order in chapter_rows:
        current = read_chapter_curriculum(chapter)
        if current["order"] is None:
            current["order"] = order
        effective[chapter.chapter_uuid] = current

    updated_chapters: set[str] = set()
    for topic in update.topics:
        chapter, order = chapters[topic.chapter_uuid]
        current = effective[chapter.chapter_uuid]
        merged = {
            "chapter_uuid": chapter.chapter_uuid,
            "topic_key": (
                _clean_key(topic.topic_key)
                if topic.topic_key is not None
                else current["topic_key"]
            )
            or chapter.chapter_uuid,
            "section": (
                topic.section if topic.section is not None else current["section"]
            ),
            "module": topic.module if topic.module is not None else current["module"],
            "level": (
                _clean_level(topic.level)
                if topic.level is not None
                else current["level"]
            ),
            "prerequisites": (
                _clean_prerequisites(topic.prerequisites)
                if topic.prerequisites is not None
                else current["prerequisites"]
            ),
            "credit": (
                _clean_credit(topic.credit)
                if topic.credit is not None
                else current["credit"]
            ),
            "estimated_minutes": (
                _clean_minutes(topic.estimated_minutes)
                if topic.estimated_minutes is not None
                else current["estimated_minutes"]
            ),
            "order": topic.order if topic.order is not None else current["order"],
        }
        if merged["order"] is None:
            merged["order"] = order
        effective[chapter.chapter_uuid] = merged
        updated_chapters.add(chapter.chapter_uuid)

    # Topic keys must be unique across the course; otherwise mastery would mix
    # two different chapters.
    key_owner: dict[str, str] = {}
    for chapter_uuid, values in effective.items():
        key = values["topic_key"]
        if key in key_owner and key_owner[key] != chapter_uuid:
            raise HTTPException(
                status_code=400,
                detail=f"Topic key '{key}' is used by more than one chapter",
            )
        key_owner[key] = chapter_uuid

    known_keys = set(key_owner)
    for chapter_uuid, values in effective.items():
        for prerequisite in values["prerequisites"]:
            if prerequisite not in known_keys:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Chapter {chapter_uuid} has unknown prerequisite "
                        f"'{prerequisite}'"
                    ),
                )
            if prerequisite == values["topic_key"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Chapter {chapter_uuid} cannot require itself",
                )
        for credited in values["credit"]:
            if credited not in known_keys:
                raise HTTPException(
                    status_code=400,
                    detail=f"Chapter {chapter_uuid} has unknown credit topic '{credited}'",
                )

    graph = {
        values["topic_key"]: list(values["prerequisites"])
        for values in effective.values()
    }
    cycle = _find_cycle(graph)
    if cycle:
        raise HTTPException(
            status_code=400,
            detail="Prerequisite cycle: " + " -> ".join(cycle),
        )

    for chapter_uuid, values in effective.items():
        if chapter_uuid not in updated_chapters:
            continue
        chapter, _order = chapters[chapter_uuid]
        write_chapter_curriculum(chapter, values)
        db.add(chapter)

    for task_update in update.tasks:
        task = tasks.get(task_update.task_uuid)
        if task is None:
            raise HTTPException(
                status_code=400,
                detail=f"Task {task_update.task_uuid} is not part of this course",
            )
        values = {
            "topic_key": task_update.topic_key,
            "level": task_update.level,
            "estimated_minutes": task_update.estimated_minutes,
        }
        write_task_meta(task, values)
        db.add(task)

    await db.commit()
    return await get_course_curriculum(db, course)
