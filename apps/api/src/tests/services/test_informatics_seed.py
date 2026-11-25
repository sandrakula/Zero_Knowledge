"""The bundled informatics outline seeds idempotently and additively."""

from __future__ import annotations

import copy

import pytest
from sqlalchemy import func, select

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.setup.informatics_course import (
    SEED_NAME,
    SeedError,
    load_seed_bundle,
    seed_course_outline,
)


async def _count(db, model, **where) -> int:
    statement = select(func.count()).select_from(model)
    for key, value in where.items():
        statement = statement.where(getattr(model, key) == value)
    return int((await db.execute(statement)).scalar_one())


def test_bundle_is_valid_and_fully_populated():
    bundle = load_seed_bundle()
    assert bundle["seed"] == SEED_NAME
    assert bundle["version"] >= 2
    assert bundle["course"]["name"]
    assert len(bundle["chapters"]) == 23

    activities = [a for c in bundle["chapters"] for a in c["activities"]]
    assert len(activities) == 52

    tasks = [t for a in activities for t in a["assignment"]["tasks"]]
    assert len(tasks) == 439

    tests = [tc for t in tasks for tc in t["contents"]["test_cases"]]
    assert len(tests) == 614
    assert all(test["expectedStdout"].strip() for test in tests)
    assert all(task["contents"]["language_id"] == 54 for task in tasks)


def test_bad_schema_version_is_rejected(tmp_path):
    path = tmp_path / "bundle.json"
    path.write_text('{"schema_version": 99, "course": {}, "chapters": []}', encoding="utf-8")
    with pytest.raises(SeedError):
        load_seed_bundle(path)


async def test_seed_creates_the_outline(db, org):
    report = await seed_course_outline(db, org, load_seed_bundle())

    assert report == {
        "course_created": True,
        "chapters_created": 23,
        "activities_created": 52,
        "assignments_created": 52,
        "tasks_created": 439,
    }

    course = (
        await db.execute(select(Course).where(Course.org_id == org.id))
    ).scalars().one()
    assert course.extra_metadata["seed"] == SEED_NAME
    assert course.extra_metadata["version"] >= 2
    assert course.name == "Informatics"
    assert course.published is True

    assert await _count(db, Chapter, course_id=course.id) == 23
    assert await _count(db, Activity, course_id=course.id) == 52
    assert await _count(db, Assignment, course_id=course.id) == 52
    assert await _count(db, AssignmentTask, course_id=course.id) == 439


async def test_reseed_enforces_the_informatics_name(db, org):
    await seed_course_outline(db, org, load_seed_bundle())
    course = (
        await db.execute(select(Course).where(Course.org_id == org.id))
    ).scalars().one()
    course.name = "Информатика"
    db.add(course)
    await db.commit()

    await seed_course_outline(db, org, load_seed_bundle())
    await db.refresh(course)
    assert course.name == "Informatics"


async def test_reseeding_changes_nothing(db, org):
    await seed_course_outline(db, org, load_seed_bundle())
    report = await seed_course_outline(db, org, load_seed_bundle())

    assert report == {
        "course_created": False,
        "chapters_created": 0,
        "activities_created": 0,
        "assignments_created": 0,
        "tasks_created": 0,
    }
    assert await _count(db, Course, org_id=org.id) == 1
    assert await _count(db, Chapter) == 23


async def test_seeding_is_additive_and_preserves_edits(db, org):
    await seed_course_outline(db, org, load_seed_bundle())

    chapter = (
        await db.execute(select(Chapter).order_by(Chapter.id).limit(1))
    ).scalars().one()
    chapter.name = "Переименовано преподавателем"
    await db.commit()

    bundle = copy.deepcopy(load_seed_bundle())
    bundle["chapters"].append(
        {
            "key": "topic-extra",
            "name": "Новая тема",
            "description": "",
            "extra_metadata": {"informatics": {"chapter_key": "topic-extra"}},
            "activities": [
                {
                    "key": "t-extra-s1",
                    "name": "Новый модуль",
                    "activity_type": "TYPE_ASSIGNMENT",
                    "activity_sub_type": "SUBTYPE_ASSIGNMENT_ANY",
                    "content": {},
                    "details": {},
                    "extra_metadata": {
                        "informatics": {"activity_key": "t-extra-s1"}
                    },
                    "assignment": {
                        "title": "Новый модуль",
                        "description": "",
                        "grading_type": "PERCENTAGE",
                        "auto_grading": True,
                        "published": True,
                        "tasks": [],
                    },
                }
            ],
        }
    )

    report = await seed_course_outline(db, org, bundle)
    assert report["course_created"] is False
    assert report["chapters_created"] == 1
    assert report["activities_created"] == 1
    assert report["assignments_created"] == 1
    assert report["tasks_created"] == 0

    await db.refresh(chapter)
    assert chapter.name == "Переименовано преподавателем"
    assert await _count(db, Chapter) == 24
    assert await _count(db, Activity) == 53
