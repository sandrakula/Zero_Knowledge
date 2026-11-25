"""Router tests for the course/global KPI endpoints."""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.stats import LearningProgram, ProgramCourse
from src.routers.stats import router as stats_router
from src.security.auth import get_current_user


def _now() -> str:
    return datetime.now().isoformat()


@pytest.fixture
async def program(db, org):
    row = LearningProgram(
        org_id=org.id,
        name="Main programme",
        description="",
        is_active=True,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture
async def program_course(db, program, course):
    row = ProgramCourse(
        program_id=program.id,
        course_id=course.id,
        sequence_order=1,
        weight=5.0,
        estimated_hours=120.0,
        volume=1,
        include_in_global=True,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(stats_router, prefix="/api/v1/stats")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestStatsRouter:
    async def test_global_and_courses(self, client, program_course, course):
        response = await client.get("/api/v1/stats/global", params={"org_id": 1})
        assert response.status_code == 200
        body = response.json()
        assert body["program_id"] == program_course.program_id
        assert body["global_kpi"] == 0.0
        assert len(body["courses"]) == 1
        assert body["courses"][0]["course_uuid"] == course.course_uuid
        assert body["courses"][0]["weight"] == 5.0
        assert body["courses"][0]["status"] == "available"

        courses = await client.get("/api/v1/stats/courses", params={"org_id": 1})
        assert courses.status_code == 200
        assert len(courses.json()["courses"]) == 1

        detail = await client.get(
            f"/api/v1/stats/courses/{course.course_uuid}", params={"org_id": 1}
        )
        assert detail.status_code == 200
        assert detail.json()["course_percent"] == 0.0
        assert detail.json()["is_informatics"] is False
        assert detail.json()["formula"] == {
            "completion": 0.35,
            "grades": 0.35,
            "regularity": 0.2,
            "practice": 0.1,
        }

    async def test_course_students_requires_staff(self, client, course):
        response = await client.get(
            f"/api/v1/stats/courses/{course.course_uuid}/students",
            params={"org_id": 1},
        )
        assert response.status_code == 403

    async def test_invalid_period_rejected(self, client, program_course):
        response = await client.get(
            "/api/v1/stats/global",
            params={"org_id": 1, "period": "year"},
        )
        assert response.status_code == 400

    async def test_informatics_problems_empty(self, client):
        response = await client.get("/api/v1/stats/informatics/problems")
        assert response.status_code == 200
        assert response.json() == []

    async def test_recompute_requires_staff(self, client, program_course):
        response = await client.post("/api/v1/stats/recompute", params={"org_id": 1})
        assert response.status_code == 403
