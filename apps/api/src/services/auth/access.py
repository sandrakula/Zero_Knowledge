"""Open registration.

The platform is closed to anonymous visitors but open to anyone who creates an
account: a new user is attached to the default organization with the built-in
``role_global_user`` (student) role immediately, and can sign in right away.
No administrator approval is involved.
"""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserRead
from src.security.security import security_hash_password
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.security.password_validation import validate_password_complexity
from src.services.security.profile_validation import validate_profile_fields
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)

STUDENT_ROLE_UUID = "role_global_user"


def normalize_login_email(raw: str) -> str:
    """Lowercase the address for storage and login lookups."""
    return str(raw or "").strip().lower()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def register_user(
    request: Request,
    db_session: AsyncSession,
    email: str,
    password: str,
    first_name: str = "",
    last_name: str = "",
) -> UserRead:
    """Create an activated student account in the default organization."""
    canonical = normalize_login_email(email)
    if not canonical:
        raise HTTPException(status_code=400, detail="Email is required")

    validation = validate_password_complexity(password)
    if not validation.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "WEAK_PASSWORD",
                "message": "Password does not meet security requirements",
                "errors": validation.errors,
                "requirements": validation.requirements,
            },
        )

    profile = validate_profile_fields(
        {"first_name": first_name, "last_name": last_name}
    )
    if not profile.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "PROFILE_FIELD_INVALID",
                "message": "Display name fields may not contain URLs or links",
                "errors": profile.errors,
            },
        )

    existing = (
        await db_session.execute(
            select(User).where(func.lower(User.email) == canonical)
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EMAIL_IN_USE",
                "message": "An account with this email already exists.",
            },
        )

    org = (
        await db_session.execute(select(Organization).order_by(Organization.id))
    ).scalars().first()
    if org is None or org.id is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NOT_INSTALLED",
                "message": "The platform has no organization yet.",
            },
        )

    role = (
        await db_session.execute(
            select(Role).where(Role.role_uuid == STUDENT_ROLE_UUID)
        )
    ).scalars().first()
    role_id = role.id if role is not None and role.id is not None else 4

    username = (canonical.partition("@")[0] or "student")[:30]
    if (
        await db_session.execute(select(User.id).where(User.username == username))
    ).scalars().first():
        username = f"{username}_{uuid4().hex[:6]}"

    now = str(datetime.now())
    user = User(
        username=username,
        first_name=(first_name or "").strip(),
        last_name=(last_name or "").strip(),
        email=canonical,
        password=security_hash_password(password),
        user_uuid=f"user_{uuid4()}",
        email_verified=True,
        email_verified_at=_now(),
        signup_method="registration",
        access_status="approved",
        access_requested_at=_now(),
        access_decided_at=_now(),
        creation_date=now,
        update_date=now,
    )
    db_session.add(user)
    try:
        await db_session.commit()
    except IntegrityError:
        # The pre-flight lookup above loses races: two concurrent requests can
        # both see "free" and then collide on uq_user_email_lower or
        # uq_user_username. Report a normal conflict instead of a 500.
        await db_session.rollback()
        raise HTTPException(
            status_code=400,
            detail={
                "code": "ACCOUNT_CONFLICT",
                "message": "That e-mail or username is already taken. Try another one.",
            },
        )
    await db_session.refresh(user)

    membership = UserOrganization(
        user_id=user.id,
        org_id=org.id,
        role_id=role_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(membership)
    await db_session.commit()

    await track(
        event_name=analytics_events.USER_SIGNED_UP,
        org_id=org.id,
        user_id=user.id or 0,
        properties={"signup_method": "registration", "role": STUDENT_ROLE_UUID},
    )
    try:
        await dispatch_webhooks(
            event_name=analytics_events.USER_SIGNED_UP,
            org_id=org.id,
            data={
                "user": {
                    "user_uuid": user.user_uuid,
                    "email": user.email,
                    "username": user.username,
                },
                "signup_method": "registration",
            },
        )
    except Exception:
        logger.debug("Registration webhook dispatch failed", exc_info=True)

    return UserRead.model_validate(user)
