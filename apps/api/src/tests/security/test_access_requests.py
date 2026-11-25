"""Open registration: any e-mail, student role, immediate access."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.auth.access import register_user
from src.services.auth.session import issue_session_or_challenge


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/register",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


@pytest.fixture
async def student_role(db):
    role = Role(
        id=4,
        name="User",
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_user",
        rights={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


class TestRegistration:
    async def test_creates_approved_student(self, db, org, student_role):
        with patch(
            "src.services.auth.access.dispatch_webhooks", new_callable=AsyncMock
        ):
            user = await register_user(
                _request(),
                db,
                email="New.User@Example.com",
                password="StrongPass1!",
                first_name="New",
                last_name="User",
            )

        assert user.email == "new.user@example.com"
        assert user.access_status == "approved"
        assert user.email_verified is True
        assert user.user_uuid.startswith("user_")

        stored = (await db.execute(select(User).where(User.id == user.id))).scalars().first()
        assert stored is not None
        assert stored.password != "StrongPass1!"

        membership = (
            await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == user.id)
            )
        ).scalars().first()
        assert membership is not None
        assert membership.org_id == org.id
        assert membership.role_id == student_role.id

    async def test_any_email_domain_is_accepted(self, db, org, student_role):
        with patch(
            "src.services.auth.access.dispatch_webhooks", new_callable=AsyncMock
        ):
            user = await register_user(
                _request(), db, email="person@school.example", password="StrongPass1!"
            )
        assert user.email == "person@school.example"

    async def test_duplicate_email_is_rejected(self, db, org, student_role):
        with patch(
            "src.services.auth.access.dispatch_webhooks", new_callable=AsyncMock
        ):
            await register_user(
                _request(), db, email="dup@example.com", password="StrongPass1!"
            )
        with pytest.raises(HTTPException) as exc:
            await register_user(
                _request(), db, email="DUP@example.com", password="StrongPass1!"
            )
        assert exc.value.status_code == 400
        assert exc.value.detail["code"] == "EMAIL_IN_USE"

    async def test_weak_password_is_rejected(self, db, org, student_role):
        with pytest.raises(HTTPException) as exc:
            await register_user(
                _request(), db, email="weak@example.com", password="password"
            )
        assert exc.value.status_code == 400
        assert exc.value.detail["code"] == "WEAK_PASSWORD"

    async def test_registration_requires_an_organization(self, db):
        with pytest.raises(HTTPException) as exc:
            await register_user(
                _request(), db, email="noorg@example.com", password="StrongPass1!"
            )
        assert exc.value.status_code == 503


class TestSessionAfterRegistration:
    async def test_new_account_can_sign_in_immediately(self, db, org, student_role):
        with patch(
            "src.services.auth.access.dispatch_webhooks", new_callable=AsyncMock
        ):
            registered = await register_user(
                _request(), db, email="ready@example.com", password="StrongPass1!"
            )
        user = (
            await db.execute(select(User).where(User.id == registered.id))
        ).scalars().first()

        with patch(
            "src.services.auth.mfa.is_mfa_active", new_callable=AsyncMock, return_value=False
        ), patch("src.services.auth.session.track_login", new_callable=AsyncMock):
            issued = await issue_session_or_challenge(db, user)

        assert issued.access_token
        assert issued.refresh_token
        assert issued.mfa_required is False
