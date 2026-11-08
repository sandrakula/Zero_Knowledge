"""Informatics account-linking service tests (no network)."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.db.informatics_link import InformaticsLink
from src.services.informatics import links


@pytest.mark.asyncio
@pytest.mark.parametrize("email", ["", "   "])
async def test_link_account_rejects_empty_email(db, regular_user, email):
    """Empty/whitespace email must 400 before any Informatics login is attempted."""
    with patch("src.services.informatics.client.login") as login:
        with pytest.raises(HTTPException) as exc:
            await links.link_account(regular_user, "student", "secret", email, db)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Email обязателен"
    login.assert_not_called()


@pytest.mark.asyncio
async def test_get_link_status_includes_email(db, regular_user):
    link = InformaticsLink(
        user_id=regular_user.id,
        username="student",
        password="encrypted",
        email="student@test.com",
        informatics_user_id=123,
        informatics_username="stu",
    )
    db.add(link)
    await db.commit()

    result = await links.get_link_status(regular_user.id, db)
    assert result["email"] == "student@test.com"
