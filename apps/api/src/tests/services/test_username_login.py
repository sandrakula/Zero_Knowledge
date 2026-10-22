"""Sign-in accepts either an email address or the unique username."""

import pytest

from src.services.users.users import security_get_user

pytestmark = pytest.mark.asyncio


async def test_security_get_user_resolves_username(db, admin_user, mock_request, monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_USERNAME_ONLY_AUTH", "true")
    by_username = await security_get_user(mock_request, db, "admin")

    assert by_username is not None
    assert by_username.id == admin_user.id


async def test_security_get_user_still_resolves_email_in_username_only_mode(
    db, admin_user, mock_request, monkeypatch
):
    """Token subjects are emails; username-only login must not break refresh."""
    monkeypatch.setenv("LEARNHOUSE_USERNAME_ONLY_AUTH", "true")
    by_email = await security_get_user(mock_request, db, "admin@test.com")
    assert by_email is not None
    assert by_email.id == admin_user.id


async def test_security_get_user_falls_back_to_email_without_test_mode(
    db, admin_user, mock_request, monkeypatch
):
    monkeypatch.delenv("LEARNHOUSE_USERNAME_ONLY_AUTH", raising=False)
    by_email = await security_get_user(mock_request, db, "admin@test.com")
    assert by_email is not None
    assert by_email.id == admin_user.id


async def test_security_get_user_is_case_insensitive(db, admin_user, mock_request, monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_USERNAME_ONLY_AUTH", "true")
    user = await security_get_user(mock_request, db, "AdMiN")
    assert user is not None
    assert user.id == admin_user.id
