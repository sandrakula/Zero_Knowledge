"""Attendance, category deadlines and manual validation CRUD."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.progress import Attendance, CategoryCompletion, CategoryDeadline


async def record_attendance(user_id: int, db_session: AsyncSession) -> dict:
    today = date.today().isoformat()
    existing = (
        await db_session.execute(
            select(Attendance).where(
                Attendance.user_id == user_id,
                Attendance.attendance_date == today,
            )
        )
    ).scalars().first()
    if existing is None:
        row = Attendance(user_id=user_id, attendance_date=today, created_at=str(datetime.now()))
        db_session.add(row)
        await db_session.commit()
        return {"attendance_date": today, "recorded": True}
    return {"attendance_date": today, "recorded": False}


async def list_deadlines(db_session: AsyncSession) -> list[dict]:
    rows = (await db_session.execute(select(CategoryDeadline))).scalars().all()
    return [{"category": r.category, "deadline": r.deadline, "note": r.note} for r in rows]


async def set_deadline(
    category: str, deadline: Optional[str], note: str, db_session: AsyncSession
) -> dict:
    row = (
        await db_session.execute(
            select(CategoryDeadline).where(CategoryDeadline.category == category)
        )
    ).scalars().first()
    if row is None:
        row = CategoryDeadline(category=category, deadline=deadline, note=note, updated_at=str(datetime.now()))
        db_session.add(row)
    else:
        row.deadline = deadline
        row.note = note
        row.updated_at = str(datetime.now())
    await db_session.commit()
    return {"category": category, "deadline": deadline, "note": note}


async def set_completion(
    user_id: int,
    category: str,
    validation_status: Optional[str],
    checked_by: Optional[str],
    dosdacha: bool,
    db_session: AsyncSession,
) -> dict:
    row = (
        await db_session.execute(
            select(CategoryCompletion).where(
                CategoryCompletion.user_id == user_id,
                CategoryCompletion.category == category,
            )
        )
    ).scalars().first()
    if row is None:
        row = CategoryCompletion(
            user_id=user_id,
            category=category,
            validation_status=validation_status,
            checked_by=checked_by,
            dosdacha=dosdacha,
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        db_session.add(row)
    else:
        row.validation_status = validation_status
        row.checked_by = checked_by
        row.dosdacha = dosdacha
        row.updated_at = str(datetime.now())
    await db_session.commit()
    return {
        "user_id": user_id,
        "category": category,
        "validation_status": validation_status,
        "checked_by": checked_by,
        "dosdacha": dosdacha,
    }
