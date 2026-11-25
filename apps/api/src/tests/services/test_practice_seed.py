"""Starter practice courses: additive, idempotent seeding."""

from __future__ import annotations

import pytest
from sqlmodel import select

from src.db.courses.assignments import AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.setup.practice_courses import seed_bundle
from src.services.setup.practice_seed_data import (
    build_practice_bundles,
    python_bundle,
    sql_bundle,
)


@pytest.mark.asyncio
async def test_python_bundle_is_idempotent(db, org):
    first = await seed_bundle(db, org, python_bundle())
    assert first["course_created"] is True
    assert first["chapters_created"] == 9
    assert first["activities_created"] == 18
    assert first["assignments_created"] == 9
    assert first["tasks_created"] == 27

    second = await seed_bundle(db, org, python_bundle())
    assert second["course_created"] is False
    assert second["chapters_created"] == 0
    assert second["activities_created"] == 0
    assert second["assignments_created"] == 0
    assert second["tasks_created"] == 0

    course = (
        await db.execute(
            select(Course).where(Course.org_id == org.id, Course.name == "Python-практикум")
        )
    ).scalars().one()
    chapters = list(
        (await db.execute(select(Chapter).where(Chapter.course_id == course.id))).scalars()
    )
    assert len(chapters) == 9
    io_chapter = next(
        chapter for chapter in chapters if chapter.name.startswith("Ввод-вывод")
    )
    assert io_chapter.extra_metadata["curriculum"]["topic_key"] == "py-io"
    assert io_chapter.extra_metadata["curriculum"]["section"] == "Основы языка"

    tasks = list(
        (
            await db.execute(
                select(AssignmentTask).where(AssignmentTask.course_id == course.id)
            )
        ).scalars()
    )
    assert len(tasks) == 27
    assert all(task.contents["_meta"]["topic_key"] for task in tasks)
    assert all(1 <= int(task.contents["_meta"]["level"]) <= 3 for task in tasks)


@pytest.mark.asyncio
async def test_all_three_starter_courses_exist(db, org):
    for bundle in build_practice_bundles():
        await seed_bundle(db, org, bundle)

    names = {
        course.name
        for course in (
            await db.execute(select(Course).where(Course.org_id == org.id))
        ).scalars()
    }
    assert {
        "Python-практикум",
        "SQL-практикум",
        "Математика и логика для CS",
    } <= names


@pytest.mark.asyncio
async def test_sql_prerequisites_form_a_graph(db, org):
    await seed_bundle(db, org, sql_bundle())
    course = (
        await db.execute(
            select(Course).where(Course.org_id == org.id, Course.name == "SQL-практикум")
        )
    ).scalars().one()
    chapters = list(
        (await db.execute(select(Chapter).where(Chapter.course_id == course.id))).scalars()
    )
    by_key = {
        chapter.extra_metadata["curriculum"]["topic_key"]: chapter
        for chapter in chapters
    }
    joins = by_key["sql-joins"]
    assert joins.extra_metadata["curriculum"]["prerequisites"] == ["sql-select"]
    windows = by_key["sql-windows"]
    assert windows.extra_metadata["curriculum"]["prerequisites"] == ["sql-aggregates"]
