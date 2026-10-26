"""Router-level tests for /api/v1/problems (multipart import + list)."""

import io
import json
import zipfile
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.problems.problems import router as problems_router
from src.security.auth import get_current_user


def _pack() -> bytes:
    buffer = io.BytesIO()
    manifest = {
        "format": "learnhouse-problem-pack",
        "version": 1,
        "problems": [{"external_id": "inf-100", "dir": "problems/100"}],
    }
    meta = {
        "external_id": "inf-100",
        "title": "Sum",
        "statement_file": "statement.md",
        "input_format": "two ints",
        "output_format": "one int",
        "tests_file": "tests.json",
        "source": {"name": "Informatics", "problem_id": "100"},
    }
    tests = {
        "tests": [
            {"id": "t1", "stdin": "1 2\n", "expected_stdout": "3\n", "hidden": False}
        ]
    }
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("problems/100/problem.json", json.dumps(meta))
        zf.writestr("problems/100/statement.md", "Add two numbers.")
        zf.writestr("problems/100/tests.json", json.dumps(tests))
    return buffer.getvalue()


@pytest.fixture
def app(db, admin_user):
    application = FastAPI()
    application.include_router(problems_router, prefix="/api/v1/problems")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[get_current_user] = lambda: admin_user
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_import_endpoint_is_multipart_and_returns_report(client, admin_user):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        response = await client.post(
            "/api/v1/problems/org/1/import",
            files={"file": ("pack.zip", _pack(), "application/zip")},
            data={"dry_run": "false"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 1
    assert body["results"][0]["status"] == "created"


@pytest.mark.asyncio
async def test_list_endpoint_returns_imported_problem(client, admin_user):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        await client.post(
            "/api/v1/problems/org/1/import",
            files={"file": ("pack.zip", _pack(), "application/zip")},
        )
        response = await client.get("/api/v1/problems/org/1")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["problems"][0]["title"] == "Sum"
    assert body["problems"][0]["tests"][0]["expected_stdout"] == "3\n"


@pytest.mark.asyncio
async def test_import_endpoint_rejects_broken_zip(client):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        response = await client.post(
            "/api/v1/problems/org/1/import",
            files={"file": ("pack.zip", b"nope", "application/zip")},
        )
    assert response.status_code == 400
