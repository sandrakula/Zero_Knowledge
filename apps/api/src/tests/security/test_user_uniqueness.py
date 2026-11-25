"""Database-level uniqueness for accounts and organization memberships.

The application already checks for duplicates before inserting, but two
concurrent requests can both pass that check. These tests pin the indexes that
close the race, so a future schema change cannot quietly drop the guarantee.
"""

from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from src.db.user_organizations import UserOrganization
from src.db.users import User


def _now() -> str:
    return str(datetime.now())


def _user(**overrides) -> User:
    data = {
        "username": "first",
        "first_name": "",
        "last_name": "",
        "email": "first@test.com",
        "password": "hashed",
        "user_uuid": "user_first",
        "creation_date": _now(),
        "update_date": _now(),
    }
    data.update(overrides)
    return User(**data)


async def _insert(db, user: User) -> User:
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class TestUserUniqueness:
    async def test_email_is_unique_case_insensitively(self, db):
        await _insert(db, _user(email="dup@test.com", username="dup"))

        db.add(_user(email="DUP@test.com", username="dup2", user_uuid="user_dup2"))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()

    async def test_username_is_unique(self, db):
        await _insert(db, _user(email="a@test.com", username="taken"))

        db.add(_user(email="b@test.com", username="taken", user_uuid="user_b"))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()


class TestMembershipUniqueness:
    async def test_one_membership_per_user_and_org(self, db, org, user_role):
        user = await _insert(db, _user(email="member@test.com", username="member"))

        def membership() -> UserOrganization:
            return UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=user_role.id,
                creation_date=_now(),
                update_date=_now(),
            )

        db.add(membership())
        await db.commit()

        db.add(membership())
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
