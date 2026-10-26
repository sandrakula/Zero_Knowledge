"""Progress statistics over Informatics submissions + attendance + deadlines."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.informatics_submission import InformaticsSubmission
from src.db.problems import Problem
from src.db.progress import Attendance, CategoryCompletion, CategoryDeadline
from src.db.users import User
from src.services.informatics.categories import CATEGORY_NAMES, CATEGORY_ORDER, CATEGORY_TOTALS


def _display_name(user: User) -> str:
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


def _date_of(created_at: str) -> str:
    """Extract YYYY-MM-DD from an imported date or a full timestamp."""
    return (created_at or "")[:10]


async def get_my_dashboard(user_id: int, db_session: AsyncSession) -> dict:
    """A learner's personal statistics, mirroring the User Stats template."""
    today = date.today()
    week_ago = (today - timedelta(days=7)).isoformat()
    month_ago = (today - timedelta(days=30)).isoformat()

    subs = (
        await db_session.execute(
            select(InformaticsSubmission).where(InformaticsSubmission.user_id == user_id)
        )
    ).scalars().all()
    solved_subs = [s for s in subs if s.solved]
    total_solved = len(solved_subs)
    solved_week = sum(1 for s in solved_subs if _date_of(s.created_at) >= week_ago)
    solved_month = sum(1 for s in solved_subs if _date_of(s.created_at) >= month_ago)

    # Average per day: total over the days elapsed since the first solved task.
    first_day = min((_date_of(s.created_at) for s in solved_subs), default=today.isoformat())
    try:
        days_active = max(1, (today - date.fromisoformat(first_day)).days + 1)
    except ValueError:
        days_active = 1
    avg_per_day = round(total_solved / days_active, 2)

    # Rank among all users by total solved.
    all_subs = (await db_session.execute(select(InformaticsSubmission))).scalars().all()
    solved_by_user: dict[int, int] = defaultdict(int)
    for s in all_subs:
        if s.solved:
            solved_by_user[s.user_id] += 1
    rank = 1 + sum(1 for u, n in solved_by_user.items() if n > total_solved)

    attendances = (
        await db_session.execute(
            select(Attendance).where(Attendance.user_id == user_id)
        )
    ).scalars().all()
    attendance_total = len(attendances)
    attendance_week = sum(1 for a in attendances if a.attendance_date >= week_ago)

    # Per-category progress (totals from the authoritative category table).
    solved_by_cat: dict[str, int] = defaultdict(int)
    for s in solved_subs:
        if s.category:
            solved_by_cat[s.category] += 1
    per_category = [
        {
            "code": code,
            "name": CATEGORY_NAMES.get(code, code),
            "total": CATEGORY_TOTALS.get(code, 0),
            "solved": solved_by_cat.get(code, 0),
            "percent": round(solved_by_cat.get(code, 0) / (CATEGORY_TOTALS.get(code, 1) or 1) * 100),
        }
        for code in CATEGORY_ORDER
    ]

    # Top-5 of the Order (by weekly solved), with a 7-day average.
    users = {u.id: _display_name(u) for u in (await db_session.execute(select(User))).scalars().all()}
    weekly_by_user: dict[int, int] = defaultdict(int)
    for s in all_subs:
        if s.solved and _date_of(s.created_at) >= week_ago:
            weekly_by_user[s.user_id] += 1
    top5 = [
        {"name": users.get(uid, "?"), "weekly": n, "avg_day": round(n / 7, 2)}
        for uid, n in sorted(weekly_by_user.items(), key=lambda kv: -kv[1])[:5]
    ]

    return {
        "me": {
            "total_solved": total_solved,
            "solved_week": solved_week,
            "solved_month": solved_month,
            "avg_per_day": avg_per_day,
            "rank": rank,
            "total_students": len(solved_by_user),
            "attendance_total": attendance_total,
            "attendance_week": attendance_week,
        },
        "top5": top5,
        "per_category": per_category,
    }


async def get_statistics(db_session: AsyncSession) -> dict:
    users = (await db_session.execute(select(User))).scalars().all()
    subs = (await db_session.execute(select(InformaticsSubmission))).scalars().all()
    attendances = (await db_session.execute(select(Attendance))).scalars().all()
    deadlines_rows = (await db_session.execute(select(CategoryDeadline))).scalars().all()
    completions = (await db_session.execute(select(CategoryCompletion))).scalars().all()

    # Category totals from the authoritative category table (833-task curriculum).
    deadlines = {d.category: d.deadline for d in deadlines_rows}

    solved_by_user: dict[int, int] = defaultdict(int)
    solved_by_cat_user: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for sub in subs:
        if sub.solved:
            solved_by_user[sub.user_id] += 1
            if sub.category:
                solved_by_cat_user[sub.user_id][sub.category] += 1

    attendance_by_user: dict[int, int] = defaultdict(int)
    for a in attendances:
        attendance_by_user[a.user_id] += 1

    validation: dict[int, dict[str, dict]] = defaultdict(dict)
    for c in completions:
        validation[c.user_id][c.category] = {
            "validation_status": c.validation_status,
            "checked_by": c.checked_by,
            "dosdacha": c.dosdacha,
        }

    categories = [
        {
            "code": code,
            "name": CATEGORY_NAMES.get(code, code),
            "total": CATEGORY_TOTALS.get(code, 0),
            "deadline": deadlines.get(code),
        }
        for code in CATEGORY_ORDER
    ]

    today = date.today().isoformat()
    students = []
    overdue = []
    for u in users:
        cats = {
            cat["code"]: solved_by_cat_user.get(u.id, {}).get(cat["code"], 0)
            for cat in categories
        }
        students.append(
            {
                "user_id": u.id,
                "name": _display_name(u),
                "username": u.username,
                "solved": solved_by_user.get(u.id, 0),
                "attendance": attendance_by_user.get(u.id, 0),
                "by_category": cats,
                "validation": validation.get(u.id, {}),
            }
        )
        # Overdue: deadline passed and not all problems solved.
        for cat in categories:
            dl = cat["deadline"]
            total = cat["total"]
            if dl and dl < today and cats[cat["code"]] < total:
                overdue.append(
                    {
                        "user_id": u.id,
                        "name": _display_name(u),
                        "category": cat["code"],
                        "category_name": cat["name"],
                        "deadline": dl,
                        "solved": cats[cat["code"]],
                        "total": total,
                    }
                )
    students.sort(key=lambda s: (-s["solved"], s["name"]))

    return {"categories": categories, "students": students, "overdue": overdue}
