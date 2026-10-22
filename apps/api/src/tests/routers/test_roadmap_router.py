"""Router tests for roadmap import, assistant and lesson feedback."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.roadmaps import LessonFeedback, RoadmapImportJob
from src.routers.roadmap import router as roadmap_router
from src.security.auth import get_authenticated_user

pytestmark = pytest.mark.asyncio


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(roadmap_router, prefix="/api/v1/roadmap")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def readable_activity():
    with patch(
        "src.routers.roadmap.can_read_activity",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock:
        yield mock


class TestFeedback:
    async def test_upsert_get_and_update(self, db, client, activity, chapter, readable_activity):
        response = await client.put(
            f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback",
            json={"content": "Too fast", "rating": 4},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["content"] == "Too fast"
        assert body["status"] == "OPEN"
        assert body["activity_uuid"] == activity.activity_uuid
        assert body["chapter_name"] == chapter.name

        second = await client.put(
            f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback",
            json={"content": "Still too fast", "rating": 3},
        )
        assert second.status_code == 200
        rows = (
            await db.execute(
                select(LessonFeedback).where(LessonFeedback.activity_id == activity.id)
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].content == "Still too fast"

        fetched = await client.get(
            f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback"
        )
        assert fetched.status_code == 200
        assert fetched.json()["rating"] == 3

    async def test_requires_content_or_rating(self, client, activity, readable_activity):
        response = await client.put(
            f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback",
            json={"content": "   "},
        )
        assert response.status_code == 400

    async def test_course_feedback_list_and_resolve(
        self, db, client, course, activity, readable_activity
    ):
        created = await client.put(
            f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback",
            json={"content": "Needs an example"},
        )
        feedback_uuid = created.json()["feedback_uuid"]

        listing = await client.get(
            f"/api/v1/roadmap/courses/{course.course_uuid}/feedback"
        )
        assert listing.status_code == 200
        assert listing.json()[0]["username"] == "admin"

        resolved = await client.patch(
            f"/api/v1/roadmap/feedback/{feedback_uuid}",
            json={"status": "RESOLVED"},
        )
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "RESOLVED"

        filtered = await client.get(
            f"/api/v1/roadmap/courses/{course.course_uuid}/feedback?status=OPEN"
        )
        assert filtered.status_code == 200
        assert filtered.json() == []

    async def test_regular_user_cannot_resolve(
        self, app, activity, regular_user, readable_activity
    ):
        app.dependency_overrides[get_authenticated_user] = lambda: regular_user
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            created = await client.put(
                f"/api/v1/roadmap/activities/{activity.activity_uuid}/feedback",
                json={"content": "ok"},
            )
            assert created.status_code == 200
            feedback_uuid = created.json()["feedback_uuid"]
            resolved = await client.patch(
                f"/api/v1/roadmap/feedback/{feedback_uuid}",
                json={"status": "RESOLVED"},
            )
            assert resolved.status_code == 403


class TestImportRouter:
    async def test_import_creates_job(
        self, db, client, org, course, admin_user
    ):
        plan = {
            "title": "Roadmap",
            "chapters": [
                {
                    "title": "Chapter",
                    "lessons": [{"title": "Lesson"}],
                }
            ],
        }
        pending = [
            {
                "key": "0:0",
                "kind": "LECTURE",
                "activity_uuid": "activity_x",
                "activity_id": 99,
                "title": "Lesson",
                "state": "PENDING",
                "published": False,
            }
        ]
        with patch(
            "src.routers.roadmap.import_roadmap",
            new_callable=AsyncMock,
            return_value=(course, pending, 0, 0, 0),
        ), patch(
            "src.routers.roadmap.check_limits_with_usage",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.roadmap.run_import_job",
            new_callable=AsyncMock,
        ):
            response = await client.post(
                "/api/v1/roadmap/import",
                json={
                    "org_id": org.id,
                    "plan": plan,
                    "generate_missing": True,
                    "publish": False,
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["job_uuid"]
        job = (
            await db.execute(
                select(RoadmapImportJob).where(RoadmapImportJob.job_uuid == body["job_uuid"])
            )
        ).scalars().first()
        assert job is not None
        assert job.total == 1

    async def test_import_rejects_empty_plan(self, client, org):
        response = await client.post(
            "/api/v1/roadmap/import",
            json={
                "org_id": org.id,
                "plan": {"title": "Empty", "chapters": []},
                "generate_missing": True,
                "publish": False,
            },
        )
        assert response.status_code == 400


class TestAssistant:
    async def test_assistant_returns_proposals(
        self, client, course, activity, admin_user
    ):
        from src.services.roadmap.schema import (
            RoadmapAssistantResponse,
            RoadmapOperation,
        )

        with patch(
            "src.routers.roadmap.reserve_ai_credit", new_callable=AsyncMock
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch(
            "src.routers.roadmap.ask_roadmap_assistant",
            new_callable=AsyncMock,
            return_value=RoadmapAssistantResponse(
                reply="Add a chapter",
                operations=[RoadmapOperation(action="add_chapter", title="New")],
            ),
        ):
            response = await client.post(
                f"/api/v1/roadmap/{course.course_uuid}/assistant",
                json={"message": "add a chapter", "activity_uuid": activity.activity_uuid},
            )

        assert response.status_code == 200
        assert response.json()["operations"][0]["action"] == "add_chapter"

    async def test_apply_requires_update(self, app, course, regular_user):
        app.dependency_overrides[get_authenticated_user] = lambda: regular_user
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/api/v1/roadmap/{course.course_uuid}/operations",
                json={"operations": [{"action": "delete_chapter", "chapter_uuid": "x"}]},
            )
        assert response.status_code == 403

    async def test_apply_runs_operations(self, client, course):
        from src.services.roadmap.schema import AppliedOperation

        with patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch(
            "src.routers.roadmap.apply_operation",
            new_callable=AsyncMock,
            return_value=AppliedOperation(action="add_chapter", status="applied"),
        ) as apply:
            response = await client.post(
                f"/api/v1/roadmap/{course.course_uuid}/operations",
                json={"operations": [{"action": "add_chapter", "title": "New"}]},
            )

        assert response.status_code == 200
        assert response.json()["applied"][0]["status"] == "applied"
        apply.assert_awaited_once()
