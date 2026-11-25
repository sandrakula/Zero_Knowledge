"""Router tests for the Informatics account and verdict ingest."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.informatics import InformaticsAccount, InformaticsSubmission
from src.routers.informatics import router as informatics_router
from src.security.auth import get_authenticated_user
from src.services.informatics.crypto import encrypt_secret


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setattr(
        "src.routers.informatics.check_rate_limit",
        lambda *a, **k: (True, 1, 60),
    )


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(informatics_router, prefix="/api/v1/informatics")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def code_task(db, org, course, chapter, activity):
    assignment = Assignment(
        title="Informatics practice",
        description="",
        published=True,
        grading_type=GradingTypeEnum.PERCENTAGE,
        auto_grading=True,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_informatics_test",
        creation_date="2026-01-01",
        update_date="2026-01-01",
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        title="informatics.msk.ru №2936. Гипотенуза",
        description="## Гипотенуза",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={"_meta": {"problem_id": 2936}, "test_cases": []},
        max_grade_value=100,
        order=0,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_task_uuid="assignmenttask_informatics_test",
        creation_date="2026-01-01",
        update_date="2026-01-01",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


class TestInformaticsRouter:
    async def test_token_me_and_ingest_flow(self, client, code_task):
        me = await client.get("/api/v1/informatics/me")
        assert me.status_code == 200
        assert me.json()["linked"] is False

        patched = await client.patch(
            "/api/v1/informatics/me",
            json={"username": "student", "informatics_user_id": 42},
        )
        assert patched.status_code == 200
        assert patched.json()["username"] == "student"

        token_response = await client.post("/api/v1/informatics/token")
        assert token_response.status_code == 200
        token = token_response.json()["token"]
        assert token.startswith("zi_")

        me = await client.get("/api/v1/informatics/me")
        assert me.json()["linked"] is True
        assert me.json()["informatics_user_id"] == 42

        ingest = await client.post(
            "/api/v1/informatics/ingest",
            headers={"X-Ingest-Token": token},
            json={
                "problem_id": 2936,
                "run_id": 42510665,
                "ejudge_status": 0,
                "tests": 5,
                "score": 100,
            },
        )
        assert ingest.status_code == 200
        payload = ingest.json()
        assert payload["solved"] is True
        assert payload["duplicate"] is False
        assert payload["task_uuids"] == ["assignmenttask_informatics_test"]

        duplicate = await client.post(
            "/api/v1/informatics/ingest",
            headers={"X-Ingest-Token": token},
            json={
                "problem_id": 2936,
                "run_id": 42510665,
                "ejudge_status": 0,
                "tests": 5,
                "score": 100,
            },
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate"] is True

        results = await client.get("/api/v1/informatics/results")
        assert results.status_code == 200
        assert len(results.json()) == 1
        assert results.json()[0]["solved"] is True

        assignment_results = await client.get(
            "/api/v1/informatics/results/assignment/assignment_informatics_test"
        )
        assert assignment_results.status_code == 200
        assert assignment_results.json()["assignmenttask_informatics_test"]["solved"] is True

        by_problem = await client.get(
            "/api/v1/informatics/results/by-problem",
            params={"problem_ids": "2936,9999"},
        )
        assert by_problem.status_code == 200
        assert by_problem.json()[0]["problem_id"] == 2936

        me = await client.get("/api/v1/informatics/me")
        assert me.json()["solved_count"] == 1

        unlink = await client.delete("/api/v1/informatics/link")
        assert unlink.status_code == 200
        assert unlink.json()["linked"] is False

        rejected = await client.post(
            "/api/v1/informatics/ingest",
            headers={"X-Ingest-Token": token},
            json={
                "problem_id": 2936,
                "run_id": 42510666,
                "ejudge_status": 0,
            },
        )
        assert rejected.status_code == 401

    async def test_requirement_ignores_legacy_userscript_token(
        self, client, db, course
    ):
        course.extra_metadata = {"informatics": {"require_script": True}}
        db.add(course)
        await db.commit()

        response = await client.get(
            "/api/v1/informatics/requirement",
            params={"course_uuid": course.course_uuid},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["required"] is True
        assert payload["connected"] is False
        assert payload["ready"] is False
        assert payload["reason"] == "connect"

        token = (await client.post("/api/v1/informatics/token")).json()["token"]

        response = await client.get(
            "/api/v1/informatics/requirement",
            params={"course_uuid": course.course_uuid},
        )
        payload = response.json()
        assert payload["connected"] is True
        assert payload["script_seen"] is False
        assert payload["ready"] is False
        assert payload["reason"] == "connect"

        ping = await client.post(
            "/api/v1/informatics/ping",
            headers={"X-Ingest-Token": token},
        )
        assert ping.status_code == 200
        assert ping.json()["last_seen_at"]

        response = await client.get(
            "/api/v1/informatics/requirement",
            params={"course_uuid": course.course_uuid},
        )
        payload = response.json()
        assert payload["connected"] is True
        assert payload["script_seen"] is True
        assert payload["ready"] is False
        assert payload["reason"] == "connect"

    async def test_requirement_unknown_course_is_404(self, client):
        response = await client.get(
            "/api/v1/informatics/requirement",
            params={"course_uuid": "course_missing"},
        )
        assert response.status_code == 404

    async def test_ping_rejects_bad_token(self, client):
        response = await client.post(
            "/api/v1/informatics/ping",
            headers={"X-Ingest-Token": "zi_not_a_real_token"},
        )
        assert response.status_code == 401

    async def test_ingest_rejects_bad_token(self, client):
        response = await client.post(
            "/api/v1/informatics/ingest",
            headers={"X-Ingest-Token": "zi_not_a_real_token"},
            json={"problem_id": 1, "run_id": 1, "ejudge_status": 0},
        )
        assert response.status_code == 401

    async def test_unsolved_status_is_stored_but_not_solved(self, client, code_task):
        token = (await client.post("/api/v1/informatics/token")).json()["token"]
        response = await client.post(
            "/api/v1/informatics/ingest",
            headers={"X-Ingest-Token": token},
            json={
                "problem_id": 2936,
                "run_id": 7,
                "ejudge_status": 5,
                "tests": 1,
                "score": 0,
            },
        )
        assert response.status_code == 200
        assert response.json()["solved"] is False
        assert response.json()["task_uuids"] == ["assignmenttask_informatics_test"]

    async def test_link_post_and_get(self, client, regular_user):
        account = InformaticsAccount(
            user_id=regular_user.id,
            username="ivan",
            email="ivan@example.com",
            password_encrypted="encrypted",
            informatics_user_id=42,
            status="ACTIVE",
            last_verified_at="2026-01-01T00:00:00",
            last_error="",
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
        )
        with patch(
            "src.routers.informatics.links.link_account",
            new=AsyncMock(return_value=account),
        ):
            response = await client.post(
                "/api/v1/informatics/link",
                json={"username": "ivan", "password": "secret", "email": "ivan@example.com"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["linked"] is True
        assert payload["informatics_user_id"] == 42
        assert "password" not in payload

        state = await client.get("/api/v1/informatics/link")
        assert state.status_code == 200
        assert state.json()["linked"] is False

    async def test_submission_requires_link(self, client):
        response = await client.post(
            "/api/v1/informatics/submissions",
            json={"problem_id": 2936, "language_id": 71, "source_code": "print(1)"},
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "INFORMATICS_NOT_LINKED"

    async def test_submission_lifecycle(self, client, db, regular_user):
        db.add(
            InformaticsAccount(
                user_id=regular_user.id,
                username="ivan",
                email="ivan@example.com",
                password_encrypted=encrypt_secret("secret"),
                informatics_user_id=42,
                status="ACTIVE",
                created_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:00",
            )
        )
        await db.commit()

        created = await client.post(
            "/api/v1/informatics/submissions",
            json={
                "problem_id": 2936,
                "language_id": 71,
                "source_code": "print(1)",
                "assignment_task_uuid": "assignmenttask_x",
            },
        )
        assert created.status_code == 202
        payload = created.json()
        assert payload["status"] == "QUEUED"
        assert payload["language_informatics_id"] == 27
        uuid = payload["submission_uuid"]

        conflict = await client.post(
            "/api/v1/informatics/submissions",
            json={"problem_id": 2936, "language_id": 71, "source_code": "print(2)"},
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "ACTIVE_SUBMISSION_EXISTS"

        history = await client.get("/api/v1/informatics/submissions")
        assert history.status_code == 200
        assert len(history.json()) == 1

        detail = await client.get(f"/api/v1/informatics/submissions/{uuid}")
        assert detail.status_code == 200
        assert detail.json()["events"][0]["phase"] == "queued"

        canceled = await client.post(
            f"/api/v1/informatics/submissions/{uuid}/cancel"
        )
        assert canceled.status_code == 200
        assert canceled.json()["status"] == "CANCELED"

        retried = await client.post(
            f"/api/v1/informatics/submissions/{uuid}/retry"
        )
        assert retried.status_code == 202
        assert retried.json()["status"] == "QUEUED"
        assert retried.json()["attempt_no"] == 2

        with patch(
            "src.routers.informatics.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ):
            health = await client.get("/api/v1/informatics/health")
        assert health.status_code == 200
        body = health.json()
        assert "queue_depth" in body
        assert "informatics_ok" in body

        denied = await client.get("/api/v1/informatics/health")
        assert denied.status_code == 403

    async def test_problem_metadata_uses_refresh(self, client):
        with patch(
            "src.routers.informatics._refresh_problem",
            new=AsyncMock(
                return_value={
                    "problem_id": 2936,
                    "title": "Гипотенуза",
                    "languages": [{"id": 27, "name": "Python 3"}],
                    "supported_language_ids": [71],
                    "time_limit_ms": 1000,
                    "memory_limit_kb": 65536,
                    "fetched_at": "2026-01-01T00:00:00",
                }
            ),
        ):
            response = await client.get(
                "/api/v1/informatics/problems/2936", params={"refresh": "true"}
            )
        assert response.status_code == 200
        assert response.json()["supported_language_ids"] == [71]

    async def test_statistics_aggregates_from_lms(self, client, db, regular_user):
        db.add(
            InformaticsSubmission(
                submission_uuid="test_stats_1",
                user_id=regular_user.id,
                problem_id=2936,
                status="FINAL",
                verdict="ACCEPTED",
                solved=True,
                score=100,
                max_score=100,
                language_our_id=71,
                created_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:00",
            )
        )
        db.add(
            InformaticsSubmission(
                submission_uuid="test_stats_2",
                user_id=regular_user.id,
                problem_id=2937,
                status="FINAL",
                verdict="WRONG_ANSWER",
                solved=False,
                score=0,
                max_score=100,
                language_our_id=54,
                created_at="2026-01-02T00:00:00",
                updated_at="2026-01-02T00:00:00",
            )
        )
        await db.commit()

        response = await client.get("/api/v1/informatics/statistics")
        assert response.status_code == 200
        body = response.json()
        assert body["total_attempts"] == 2
        assert body["solved_problems"] == 1
        assert body["accepted_attempts"] == 1
        assert body["final_attempts"] == 2
        assert body["by_verdict"]["ACCEPTED"] == 1
        assert body["by_verdict"]["WRONG_ANSWER"] == 1
        assert body["by_language"]["71"] == 1
        assert body["by_language"]["54"] == 1

    async def test_admin_requeue_after_cancel(self, client, db, regular_user):
        db.add(
            InformaticsAccount(
                user_id=regular_user.id,
                username="ivan",
                email="ivan@example.com",
                password_encrypted=encrypt_secret("secret"),
                informatics_user_id=42,
                status="ACTIVE",
                created_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:00",
            )
        )
        await db.commit()

        created = await client.post(
            "/api/v1/informatics/submissions",
            json={"problem_id": 2936, "language_id": 71, "source_code": "print(1)"},
        )
        uuid = created.json()["submission_uuid"]
        await client.post(f"/api/v1/informatics/submissions/{uuid}/cancel")

        with patch(
            "src.routers.informatics._is_staff_for_row",
            new=AsyncMock(return_value=True),
        ):
            response = await client.post(
                f"/api/v1/informatics/admin/requeue/{uuid}"
            )
        assert response.status_code == 200
        assert response.json()["status"] == "QUEUED"
