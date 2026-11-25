"""Unit/contract tests for the server-side Informatics module.

Network calls are replaced with ``httpx.MockTransport``; no real Informatics
credentials or cookies are used.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from src.db.informatics import InformaticsAccount, InformaticsSubmission, Verdict
from src.services.informatics import submissions
from src.services.informatics.client import (
    InformaticsAuthError,
    InformaticsClient,
    InformaticsSubmitError,
    SubmitResult,
)
from src.services.informatics.crypto import decrypt_secret, encrypt_secret
from src.services.informatics.languages import (
    get_language,
    informatics_lang_id,
    is_supported_by_problem,
    supported_our_ids,
)
from src.services.informatics.verdicts import (
    is_in_progress,
    is_solved,
    map_verdict,
    verdict_label,
)
from src.services.informatics.worker import InformaticsWorker


class TestVerdictMapping:
    def test_accepted_statuses(self):
        assert map_verdict(0) == Verdict.ACCEPTED
        assert map_verdict(8) == Verdict.ACCEPTED
        assert is_solved(0) and is_solved(8)

    def test_in_progress(self):
        for status in (11, 96, 98, 377):
            assert is_in_progress(status)
            assert not is_solved(status)

    def test_known_failures(self):
        assert map_verdict(1) == Verdict.COMPILATION_ERROR
        assert map_verdict(3) == Verdict.WRONG_ANSWER
        assert map_verdict(5) == Verdict.TIME_LIMIT
        assert map_verdict(6) == Verdict.MEMORY_LIMIT

    def test_unknown_is_not_guessed(self):
        assert map_verdict(12345) == Verdict.UNKNOWN
        assert map_verdict(None) == Verdict.UNKNOWN
        assert verdict_label("UNKNOWN")


class TestLanguageMapping:
    def test_known_ids(self):
        assert informatics_lang_id(71) == 27
        assert informatics_lang_id(54) == 3
        assert informatics_lang_id(50) == 2
        assert informatics_lang_id(62) == 18
        assert get_language(71).extension == "py"

    def test_unknown_language_returns_none(self):
        assert get_language(999) is None
        assert informatics_lang_id(999) is None

    def test_problem_intersection(self):
        problem = [{"id": 27, "name": "Python"}, {"id": 3, "name": "C++"}]
        assert supported_our_ids(problem) == [71, 54]
        assert is_supported_by_problem(71, problem)
        assert not is_supported_by_problem(62, problem)


class TestCrypto:
    def test_round_trip(self):
        encrypted = encrypt_secret("s3cret")
        assert encrypted and encrypted != "s3cret"
        assert decrypt_secret(encrypted) == "s3cret"

    def test_empty_and_broken(self):
        assert encrypt_secret("") == ""
        assert decrypt_secret("") == ""
        assert decrypt_secret("not-a-token") == ""


def _login_handler():
    state = {"home": 0, "token": "tok-1", "posted": False}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/":
            state["home"] += 1
            if state["posted"]:
                return httpx.Response(
                    200,
                    text='<html>Вы зашли под именем <a href="profile.php?id=42">ivan</a></html>',
                )
            return httpx.Response(
                200,
                text="<html>guest</html>",
                headers={"set-cookie": "MoodleSession=abc; Path=/"},
            )
        if path == "/login/index.php" and request.method == "GET":
            return httpx.Response(
                200,
                text='<form><input type="hidden" name="logintoken" value="tok-1" /></form>',
            )
        if path == "/login/index.php" and request.method == "POST":
            state["posted"] = True
            return httpx.Response(
                200,
                text="<html>ok</html>",
                headers={"set-cookie": "MoodleSession=abc; Path=/"},
            )
        return httpx.Response(404)

    return handler


class TestClient:
    async def test_login(self):
        client = InformaticsClient(transport=httpx.MockTransport(_login_handler()))
        try:
            result = await client.login("ivan", "secret")
            assert result.informatics_user_id == 42
            assert result.username == "ivan"
        finally:
            await client.close()

    async def test_login_without_session_cookie_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/login/index.php" and request.method == "GET":
                return httpx.Response(
                    200,
                    text='<input name="logintoken" value="x">',
                )
            return httpx.Response(200, text="guest")

        client = InformaticsClient(transport=httpx.MockTransport(handler))
        try:
            with pytest.raises(InformaticsAuthError):
                await client.login("ivan", "bad")
        finally:
            await client.close()

    async def test_submit_success_duplicate_and_rejected(self):
        responses = [
            httpx.Response(200, json={"status": "success", "data": {"run_id": 123}}),
            httpx.Response(200, text="duplicate submission"),
            httpx.Response(200, json={"status": "error"}),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            return responses.pop(0)

        client = InformaticsClient(transport=httpx.MockTransport(handler))
        try:
            result = await client.submit(2936, 27, "print(1)", "py")
            assert result.run_id == 123 and not result.duplicate

            duplicate = await client.submit(2936, 27, "print(1)", "py")
            assert duplicate.duplicate and duplicate.run_id is None

            with pytest.raises(InformaticsSubmitError):
                await client.submit(2936, 27, "print(1)", "py")
        finally:
            await client.close()

    async def test_get_run_and_problem(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/filter-runs"):
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "id": 123,
                                "ejudge_status": 0,
                                "ejudge_test_num": 12,
                                "ejudge_score": 100,
                            }
                        ]
                    },
                )
            if request.url.path.endswith("/json"):
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "title": "Гипотенуза",
                            "languages": [{"id": 27, "name": "Python 3"}],
                            "time_limit": 1.0,
                            "memory_limit": 65536,
                        }
                    },
                )
            return httpx.Response(404)

        client = InformaticsClient(transport=httpx.MockTransport(handler))
        try:
            run = await client.get_run(2936, 42, 123)
            assert run and run["ejudge_status"] == 0

            problem = await client.get_problem(2936)
            assert problem["title"] == "Гипотенуза"
            assert problem["languages"][0]["id"] == 27
            assert problem["time_limit_ms"] == 1000
        finally:
            await client.close()


class TestSubmissionService:
    async def _link(self, db, user_id: int):
        db.add(
            InformaticsAccount(
                user_id=user_id,
                username="ivan",
                email="ivan@example.com",
                password_encrypted=encrypt_secret("secret"),
                informatics_user_id=42,
                status="ACTIVE",
                created_at="2026-01-01",
                updated_at="2026-01-01",
            )
        )
        await db.commit()

    async def test_create_list_get_cancel_retry(self, db, regular_user):
        await self._link(db, regular_user.id)

        created = await submissions.create_submission(
            db,
            user_id=regular_user.id,
            problem_id=2936,
            language_id=71,
            source_code="print(1)",
            assignment_task_uuid="assignmenttask_x",
        )
        assert created["status"] == "QUEUED"
        assert created["submission_uuid"].startswith("informatics_")
        assert created["language_informatics_id"] == 27

        with pytest.raises(submissions.SubmissionError) as exc:
            await submissions.create_submission(
                db,
                user_id=regular_user.id,
                problem_id=2936,
                language_id=71,
                source_code="print(2)",
            )
        assert exc.value.code == "ACTIVE_SUBMISSION_EXISTS"

        history = await submissions.list_submissions(db, regular_user.id)
        assert len(history) == 1

        detail = await submissions.get_submission(
            db, regular_user.id, created["submission_uuid"]
        )
        assert detail["events"][0]["phase"] == "queued"

        canceled = await submissions.cancel_submission(
            db, regular_user.id, created["submission_uuid"]
        )
        assert canceled["status"] == "CANCELED"

        retried = await submissions.retry_submission(
            db, regular_user.id, created["submission_uuid"]
        )
        assert retried["status"] == "QUEUED"
        assert retried["attempt_no"] == 2

    async def test_submission_requires_link(self, db, regular_user):
        with pytest.raises(submissions.SubmissionError) as exc:
            await submissions.create_submission(
                db,
                user_id=regular_user.id,
                problem_id=2936,
                language_id=71,
                source_code="print(1)",
            )
        assert exc.value.code == "INFORMATICS_NOT_LINKED"

    async def test_unsupported_language(self, db, regular_user):
        await self._link(db, regular_user.id)
        with pytest.raises(submissions.SubmissionError) as exc:
            await submissions.create_submission(
                db,
                user_id=regular_user.id,
                problem_id=2936,
                language_id=999,
                source_code="print(1)",
            )
        assert exc.value.code == "UNSUPPORTED_LANGUAGE"


class _FakeClient:
    async def get_problem(self, problem_id: int):
        return {
            "problem_id": problem_id,
            "title": "Гипотенуза",
            "statement_md": "",
            "languages": [{"id": 27, "name": "Python 3"}],
            "time_limit_ms": 1000,
            "memory_limit_kb": 65536,
            "raw": {},
        }

    async def submit(self, problem_id: int, lang_id: int, source: str, ext: str):
        return SubmitResult(run_id=123, duplicate=False, raw={})

    async def get_run(self, problem_id: int, user_id: int, run_id: int | None = None):
        return {
            "id": 123,
            "ejudge_status": 0,
            "ejudge_test_num": 5,
            "ejudge_score": 100,
            "lang_id": 27,
        }

    async def close(self) -> None:
        pass


class _Ctx:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *_exc):
        return False


class TestWorker:
    async def test_queued_to_final_and_credited(self, db, regular_user):
        db.add(
            InformaticsAccount(
                user_id=regular_user.id,
                username="ivan",
                email="ivan@example.com",
                password_encrypted=encrypt_secret("secret"),
                informatics_user_id=42,
                status="ACTIVE",
                created_at="2026-01-01",
                updated_at="2026-01-01",
            )
        )
        await db.commit()

        created = await submissions.create_submission(
            db,
            user_id=regular_user.id,
            problem_id=2936,
            language_id=71,
            source_code="print(1)",
        )
        uuid = created["submission_uuid"]

        worker = InformaticsWorker(lambda: _Ctx(db))
        worker._client_for = AsyncMock(return_value=_FakeClient())  # type: ignore[method-assign]

        await worker.run_once()
        row = (
            await db.execute(
                select(InformaticsSubmission).where(
                    InformaticsSubmission.submission_uuid == uuid
                )
            )
        ).scalars().first()
        assert row is not None
        assert row.status == "RUNNING"
        assert row.run_id == 123

        row.next_poll_at = ""
        row.lease_expires_at = ""
        db.add(row)
        await db.commit()

        await worker.run_once()
        await db.refresh(row)
        assert row.status == "FINAL"
        assert row.verdict == "ACCEPTED"
        assert row.solved is True
        assert row.credited is True
        assert row.tests_passed == 5
