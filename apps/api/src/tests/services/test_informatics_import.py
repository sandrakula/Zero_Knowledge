"""Informatics public-endpoint importer tests (no network)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.problems import Problem
from src.services.problems.informatics import (
    _pack_from_payload,
    _sample_tests,
    _statement_sections,
    import_informatics_problem,
)

SAMPLE_PAYLOAD = {
    "id": 2936,
    "name": "Гипотенуза",
    "content": (
        '<div class="problem-statement"><div class="legend"><p>Дано два числа '
        '<em><strong>a</strong></em> и <em><strong>b</strong></em>. '
        "Найдите гипотенузу.</p></div>"
        '<div class="input-specification"><div class="section-title">Входные данные</div>'
        "<p>Два целых числа.</p></div>"
        '<div class="output-specification"><div class="section-title">Выходные данные</div>'
        "<p>Одно число.</p></div></div>"
    ),
    "sample_tests_html": (
        "<div class='problem-statement'><div class='sample-tests'>"
        "<div class='sample-test'><div class='input'><pre class='content'>3\n4</pre></div>"
        "<div class='output'><pre class='content'>5.0</pre></div></div>"
        "</div></div>"
    ),
    "timelimit": 1,
    "memorylimit": 67108864,
    "languages": [{"id": 27, "name": "Python 3.9"}, {"id": 3, "name": "GNU C++ 11.2"}],
}


@pytest.fixture(autouse=True)
def _allow_rate_limit():
    with patch(
        "src.services.problems.informatics.check_rate_limit",
        return_value=(True, 0, 0),
    ):
        yield


def test_html_sections_and_samples():
    statement, input_format, output_format = _statement_sections(SAMPLE_PAYLOAD["content"])
    assert "гипотенузу" in statement
    assert "Два целых" in input_format
    assert "Одно число" in output_format
    samples = _sample_tests(SAMPLE_PAYLOAD["sample_tests_html"])
    assert samples == [
        {
            "id": "sample_1",
            "label": "Example 1",
            "stdin": "3\n4",
            "expected_stdout": "5.0",
            "hidden": False,
            "weight": 1,
        }
    ]


def test_pack_maps_limits_and_source():
    import io
    import json
    import zipfile

    pack = _pack_from_payload(2936, SAMPLE_PAYLOAD)
    with zipfile.ZipFile(io.BytesIO(pack)) as archive:
        meta = json.loads(archive.read("problems/2936/problem.json"))
        tests = json.loads(archive.read("problems/2936/tests.json"))
    assert meta["source"]["name"] == "Informatics"
    assert meta["source"]["problem_id"] == "2936"
    assert meta["limits"] == {"time_ms": 1000, "memory_kb": 65536}
    assert meta["languages"] == [71, 54]
    assert tests["tests"][0]["expected_stdout"] == "5.0"


def test_pack_falls_back_to_id_for_blank_name():
    import io
    import json
    import zipfile

    payload = dict(SAMPLE_PAYLOAD, name=" ")
    pack = _pack_from_payload(2936, payload)
    with zipfile.ZipFile(io.BytesIO(pack)) as archive:
        meta = json.loads(archive.read("problems/2936/problem.json"))
    assert meta["title"] == "Задача 2936"


def test_pack_rejects_problem_without_samples():
    payload = dict(SAMPLE_PAYLOAD)
    payload["sample_tests_html"] = "<div class='sample-tests'></div>"
    with pytest.raises(HTTPException) as exc:
        _pack_from_payload(2936, payload)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_import_is_rate_limited(db, org, admin_user):
    with patch(
        "src.services.problems.informatics.check_rate_limit",
        return_value=(False, 10, 30),
    ), patch(
        "src.services.problems.informatics._authorize",
        new_callable=AsyncMock,
        return_value=admin_user,
    ):
        with pytest.raises(HTTPException) as exc:
            await import_informatics_problem(org.id, 2936, admin_user, db)
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"] == "30"


@pytest.mark.asyncio
async def test_import_creates_library_problem(db, org, admin_user):
    with patch(
        "src.services.problems.informatics._fetch_informatics_json",
        new_callable=AsyncMock,
        return_value=SAMPLE_PAYLOAD,
    ), patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ), patch(
        "src.services.problems.informatics._authorize",
        new_callable=AsyncMock,
    ):
        result = await import_informatics_problem(org.id, 2936, admin_user, db)

    assert result.created == 1
    assert result.results[0].status == "created"
    problem = (
        await db.execute(select(Problem).where(Problem.org_id == org.id))
    ).scalars().first()
    assert problem is not None
    assert problem.title == "Гипотенуза"
    assert problem.source_name == "Informatics"
    assert problem.source_id == "2936"
    assert problem.time_limit_ms == 1000
    assert problem.memory_limit_kb == 65536
    assert problem.tests[0]["stdin"] == "3\n4"
    assert problem.tests[0]["hidden"] is False


@pytest.mark.asyncio
async def test_import_is_idempotent(db, org, admin_user):
    with patch(
        "src.services.problems.informatics._fetch_informatics_json",
        new_callable=AsyncMock,
        return_value=SAMPLE_PAYLOAD,
    ), patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ), patch(
        "src.services.problems.informatics._authorize",
        new_callable=AsyncMock,
    ):
        first = await import_informatics_problem(org.id, 2936, admin_user, db)
        second = await import_informatics_problem(org.id, 2936, admin_user, db)

    assert first.created == 1
    assert second.skipped == 1
