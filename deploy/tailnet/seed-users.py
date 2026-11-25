"""Создать учётные записи на тестовом стенде из JSON-файла.

Запуск внутри контейнера (см. README):
    docker compose cp users.local.json "app:/app/api/_users.json"
    docker compose exec -T -w /app/api app /app/api/.venv/bin/python seed-users.py _users.json

Формат файла: список объектов
    [{"email": "...", "username": "...", "password": "...",
      "role_id": 4, "superadmin": false}]

role_id: 1 = Admin, 3 = Instructor, 4 = User (студент).
Скрипт идемпотентен: существующего пользователя он обновляет, а не падает.
Почта помечается подтверждённой, иначе без SMTP войти не получится.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime
from uuid import uuid4

from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.security import security_hash_password


async def main(path: str) -> None:
    with open(path, encoding="utf-8") as handle:
        accounts = json.load(handle)

    async with _async_session_factory() as session:
        org = (
            await session.execute(select(Organization).order_by(Organization.id))
        ).scalars().first()
        if org is None:
            raise SystemExit("В базе нет организации — сначала подними приложение.")

        for account in accounts:
            email = account["email"].strip().lower()
            user = (
                await session.execute(select(User).where(User.email == email))
            ).scalars().first()
            now = str(datetime.now())

            if user is None:
                user = User(
                    user_uuid=f"user_{uuid4()}",
                    username=account["username"],
                    first_name=account.get("first_name", ""),
                    last_name=account.get("last_name", ""),
                    email=email,
                    avatar_image="",
                    bio="",
                    password=security_hash_password(account["password"]),
                    email_verified=True,
                    email_verified_at=now,
                    is_superadmin=bool(account.get("superadmin", False)),
                    creation_date=now,
                    update_date=now,
                )
                session.add(user)
                await session.commit()
                await session.refresh(user)
                action = "created"
            else:
                user.password = security_hash_password(account["password"])
                user.email_verified = True
                user.is_superadmin = user.is_superadmin or bool(account.get("superadmin", False))
                user.update_date = now
                session.add(user)
                await session.commit()
                action = "updated"

            role_id = int(account.get("role_id", 4))
            membership = (
                await session.execute(
                    select(UserOrganization).where(
                        UserOrganization.user_id == user.id,
                        UserOrganization.org_id == org.id,
                    )
                )
            ).scalars().first()
            if membership is None:
                session.add(
                    UserOrganization(
                        user_id=user.id,
                        org_id=org.id,
                        role_id=role_id,
                        creation_date=now,
                        update_date=now,
                    )
                )
            else:
                membership.role_id = role_id
                session.add(membership)
            await session.commit()

            print(f"{action:8} id={user.id:<3} role={role_id} {email}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: seed-users.py <accounts.json>")
    asyncio.run(main(sys.argv[1]))
