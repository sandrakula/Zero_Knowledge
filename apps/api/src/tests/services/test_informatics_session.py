"""Google-only Informatics accounts connect through a MoodleSession cookie."""

from __future__ import annotations

import pytest

from src.services.informatics import links
from src.services.informatics.client import InformaticsAuthError, LoginResult


class _FakeClient:
    def __init__(self, result: LoginResult | None = None, error: Exception | None = None):
        self._result = result
        self._error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None

    async def use_session(self, cookie: str) -> LoginResult:
        if self._error:
            raise self._error
        return self._result or LoginResult(42, "")


@pytest.mark.asyncio
async def test_link_session_stores_an_encrypted_cookie(db, regular_user, monkeypatch):
    monkeypatch.setattr(
        links, "InformaticsClient", lambda: _FakeClient(LoginResult(321, ""))
    )

    account = await links.link_session(db, regular_user.id, "moodle-session-value")

    assert account.status == "ACTIVE"
    assert account.informatics_user_id == 321
    assert account.password_encrypted == ""
    assert account.session_encrypted
    assert "moodle-session-value" not in account.session_encrypted

    payload = links.link_to_dict(account)
    assert payload["linked"] is True
    assert payload["auth_method"] == "session"
    assert payload["has_session"] is True
    assert payload["has_password"] is False


@pytest.mark.asyncio
async def test_invalid_session_marks_the_link_invalid(db, regular_user, monkeypatch):
    monkeypatch.setattr(
        links,
        "InformaticsClient",
        lambda: _FakeClient(error=InformaticsAuthError("session expired")),
    )

    with pytest.raises(links.LinkError):
        await links.link_session(db, regular_user.id, "bad-cookie")

    account = await links.get_account(db, regular_user.id)
    assert account is not None
    assert account.status == "INVALID"
    assert account.last_error


@pytest.mark.asyncio
async def test_verify_session_refreshes_the_link(db, regular_user, monkeypatch):
    monkeypatch.setattr(
        links, "InformaticsClient", lambda: _FakeClient(LoginResult(777, ""))
    )
    await links.link_session(db, regular_user.id, "cookie")

    monkeypatch.setattr(
        links, "InformaticsClient", lambda: _FakeClient(LoginResult(777, ""))
    )
    account = await links.verify_account(db, regular_user.id)
    assert account.status == "ACTIVE"
    assert account.informatics_user_id == 777
