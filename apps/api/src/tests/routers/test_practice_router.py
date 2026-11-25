"""Router tests for practice feed/state and the curriculum authoring API."""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.routers.courses.curriculum import router as curriculum_router
from src.routers.practice import router as practice_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(practice_router, prefix="/api/v1/practice")
    app.include_router(curriculum_router, prefix="/api/v1/courses")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as test_client:
        yield test_client


async def _second_chapter(db, org, course) -> Chapter:
    chapter = Chapter(
        name="Second Chapter",
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid="chapter_two",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    link = CourseChapter(
        chapter_id=chapter.id,
        course_id=course.id,
        org_id=org.id,
        order=2,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    await db.commit()
    return chapter


@pytest.mark.asyncio
async def test_empty_feed_and_state(client, course):
    response = await client.get(
        "/api/v1/practice/today", params={"course_uuid": course.course_uuid}
    )
    assert response.status_code == 200
    assert response.json()["items"] == []

    state = await client.get(
        "/api/v1/practice/state", params={"course_uuid": course.course_uuid}
    )
    assert state.status_code == 200
    assert state.json()["summary"]["attempts"] == 0


@pytest.mark.asyncio
async def test_unknown_course_is_404(client):
    response = await client.get(
        "/api/v1/practice/today", params={"course_uuid": "course_missing"}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_non_member_is_403(app, client, course):
    from src.db.users import PublicUser

    app.dependency_overrides[get_current_user] = lambda: PublicUser(
        id=999,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="out@test.com",
        user_uuid="user_outsider",
    )
    response = await client.get(
        "/api/v1/practice/today", params={"course_uuid": course.course_uuid}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_curriculum_roundtrip_and_cycle_guard(
    client, db, org, course, chapter
):
    await _second_chapter(db, org, course)
    response = await client.put(
        f"/api/v1/courses/{course.course_uuid}/curriculum",
        json={
            "topics": [
                {
                    "chapter_uuid": chapter.chapter_uuid,
                    "section": "Основы",
                    "module": "Ввод",
                    "level": 1,
                    "estimated_minutes": 15,
                },
                {
                    "chapter_uuid": "chapter_two",
                    "section": "Основы",
                    "module": "Ввод",
                    "level": 2,
                    "prerequisites": [chapter.chapter_uuid],
                },
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stats"]["topics"] == 2
    assert body["sections"][0]["modules"][0]["name"] == "Ввод"

    cycle = await client.put(
        f"/api/v1/courses/{course.course_uuid}/curriculum",
        json={
            "topics": [
                {
                    "chapter_uuid": chapter.chapter_uuid,
                    "prerequisites": ["chapter_two"],
                }
            ]
        },
    )
    assert cycle.status_code == 400
    assert "cycle" in cycle.json()["detail"].lower()

    unknown = await client.put(
        f"/api/v1/courses/{course.course_uuid}/curriculum",
        json={"topics": [{"chapter_uuid": "chapter_missing", "level": 1}]},
    )
    assert unknown.status_code == 400


@pytest.mark.asyncio
async def test_curriculum_task_meta_keeps_tests(client, db, org, course, chapter):
    activity = Activity(
        name="Practice",
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_meta",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    assignment = Assignment(
        title="Practice",
        description="",
        grading_type=GradingTypeEnum.PERCENTAGE,
        published=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_meta",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        assignment_task_uuid="task_meta",
        title="Meta",
        description="",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={
            "test_cases": [{"id": "tc", "stdin": "1", "expectedStdout": "1"}],
            "solution_code": "print(1)",
        },
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()

    response = await client.put(
        f"/api/v1/courses/{course.course_uuid}/curriculum",
        json={
            "tasks": [
                {
                    "task_uuid": "task_meta",
                    "topic_key": chapter.chapter_uuid,
                    "level": 2,
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    updated = (
        await db.execute(
            select(AssignmentTask).where(AssignmentTask.assignment_task_uuid == "task_meta")
        )
    ).scalars().one()
    assert updated.contents["_meta"]["level"] == 2
    assert updated.contents["test_cases"][0]["expectedStdout"] == "1"
    assert updated.contents["solution_code"] == "print(1)"


@pytest.mark.asyncio
async def test_curriculum_write_requires_update_rights(
    app, client, course, regular_user
):
    app.dependency_overrides[get_current_user] = lambda: regular_user
    response = await client.put(
        f"/api/v1/courses/{course.course_uuid}/curriculum",
        json={"topics": [{"chapter_uuid": "chapter_test", "level": 2}]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_task_bank_filters_and_updates(client, db, org, course, chapter):
    activity = Activity(
        name="Bank practice",
        activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_bank",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    assignment = Assignment(
        title="Bank practice",
        description="",
        grading_type=GradingTypeEnum.PERCENTAGE,
        published=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_bank",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        assignment_task_uuid="task_bank",
        title="Банк: сумма",
        description="Сложите два числа",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={
            "_meta": {"topic_key": chapter.chapter_uuid, "level": 2},
            "test_cases": [{"id": "tc", "stdin": "1 2", "expectedStdout": "3"}],
            "solution_code": "print(3)",
        },
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()

    response = await client.get(
        "/api/v1/practice/bank",
        params={"org_id": org.id, "level": 2, "q": "сумма"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["task_uuid"] == "task_bank"
    assert item["level"] == 2
    assert item["has_explicit_level"] is True
    assert "test_cases" not in response.text
    assert "expectedStdout" not in response.text
    assert body["facets"]["courses"][0]["course_uuid"] == course.course_uuid

    updated = await client.put(
        f"/api/v1/practice/bank/tasks?org_id={org.id}",
        json={"tasks": [{"task_uuid": "task_bank", "level": 3}]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["updated"] == 1

    level_three = await client.get(
        "/api/v1/practice/bank",
        params={"org_id": org.id, "level": 3},
    )
    assert level_three.json()["total"] == 1

    unleveled = await client.get(
        "/api/v1/practice/bank",
        params={"org_id": org.id, "only_unleveled": True},
    )
    assert unleveled.json()["total"] == 0


@pytest.mark.asyncio
async def test_task_bank_is_staff_only(app, client, org, regular_user):
    app.dependency_overrides[get_current_user] = lambda: regular_user
    response = await client.get(
        "/api/v1/practice/bank", params={"org_id": org.id}
    )
    assert response.status_code == 403
