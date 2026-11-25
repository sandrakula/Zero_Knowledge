"""Stats aggregation for the cabinet: КПД, courses, leaderboards.

Everything is computed from existing progress rows plus the two small tables
introduced for the programme (defenses and self-reported contests). No nightly
jobs: period-scoped SQL + a Python scoring pass.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.stats import ContestEntry, DefenseRecord
from src.db.trail_steps import TrailStep
from src.db.users import PublicUser, User
from src.security.org_auth import get_user_org_role
from src.services.stats.metric import ScoreBreakdown, compute_score

PERIOD_DAYS = {"week": 7, "month": 30}
VALID_PERIODS = ("week", "month", "all")


def _now() -> datetime:
    return datetime.now()


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        try:
            dt = datetime.strptime(raw[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _week_key(dt: datetime) -> tuple[int, int]:
    iso = dt.isocalendar()
    return (iso[0], iso[1])


def _start_for(period: str) -> Optional[datetime]:
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail="period must be week, month or all")
    days = PERIOD_DAYS.get(period)
    return _now() - timedelta(days=days) if days else None


def _total_weeks(period: str, start: Optional[datetime], earliest: Optional[datetime]) -> float:
    if period == "week":
        return 1.0
    if period == "month":
        return 30.0 / 7.0
    if not earliest:
        return 1.0
    return max(1.0, (_now() - earliest).days / 7.0)


async def _resolve_org(db: AsyncSession, org_id: int) -> Organization:
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _resolve_course(db: AsyncSession, org_id: int, course_uuid: str) -> Course:
    course = (
        await db.execute(
            select(Course).where(
                Course.course_uuid == course_uuid, Course.org_id == org_id
            )
        )
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


class _Scope:
    """One leaderboard scope (organization or a single course)."""

    def __init__(self) -> None:
        self.solved: dict[int, int] = {}
        self.defenses: dict[int, int] = {}
        self.contests: dict[int, int] = {}
        self.weeks: dict[int, set[tuple[int, int]]] = {}
        self.earliest: dict[int, datetime] = {}

    def note_activity(self, user_id: int, when: Optional[datetime]) -> None:
        if not when:
            return
        self.weeks.setdefault(user_id, set()).add(_week_key(when))
        previous = self.earliest.get(user_id)
        if previous is None or when < previous:
            self.earliest[user_id] = when


async def _collect_scope(
    db: AsyncSession,
    org_id: int,
    period: str,
    course_id: Optional[int] = None,
    include_contests: bool = True,
) -> _Scope:
    start = _start_for(period)
    scope = _Scope()

    steps_stmt = select(TrailStep.user_id, TrailStep.creation_date).where(
        TrailStep.org_id == org_id, TrailStep.complete == True  # noqa: E712
    )
    if course_id is not None:
        steps_stmt = steps_stmt.where(TrailStep.course_id == course_id)
    if start is not None:
        steps_stmt = steps_stmt.where(TrailStep.creation_date >= start.isoformat(sep=" "))

    for user_id, created in (await db.execute(steps_stmt)).all():
        dt = _parse_dt(created)
        if dt is None:
            continue
        scope.solved[user_id] = scope.solved.get(user_id, 0) + 1
        scope.note_activity(user_id, dt)

    defense_stmt = select(DefenseRecord.user_id, DefenseRecord.confirmed_at).where(
        DefenseRecord.org_id == org_id
    )
    if course_id is not None:
        defense_stmt = defense_stmt.where(DefenseRecord.course_id == course_id)
    if start is not None:
        defense_stmt = defense_stmt.where(
            DefenseRecord.confirmed_at >= start.isoformat(sep=" ")
        )

    for user_id, confirmed in (await db.execute(defense_stmt)).all():
        dt = _parse_dt(confirmed)
        scope.defenses[user_id] = scope.defenses.get(user_id, 0) + 1
        scope.note_activity(user_id, dt)

    if include_contests:
        contest_stmt = select(ContestEntry.user_id, ContestEntry.happened_on).where(
            ContestEntry.org_id == org_id
        )
        if start is not None:
            contest_stmt = contest_stmt.where(
                ContestEntry.happened_on >= start.date().isoformat()
            )
        for user_id, happened_on in (await db.execute(contest_stmt)).all():
            scope.contests[user_id] = scope.contests.get(user_id, 0) + 1
            # Self-reported contests do NOT feed regularity.

    return scope


def _score_for(scope: _Scope, user_id: int, period: str, include_contests: bool) -> ScoreBreakdown:
    solved = scope.solved.get(user_id, 0)
    defenses = scope.defenses.get(user_id, 0)
    contests = scope.contests.get(user_id, 0)
    weeks = scope.weeks.get(user_id, set())
    total = _total_weeks(period, None, scope.earliest.get(user_id))
    return compute_score(
        active_weeks=len(weeks),
        total_weeks=total,
        defenses=defenses,
        solved=solved,
        contests=contests,
        include_contests=include_contests,
    )


async def _names(db: AsyncSession, user_ids: list[int]) -> dict[int, User]:
    if not user_ids:
        return {}
    rows = (
        await db.execute(select(User).where(User.id.in_(user_ids)))
    ).scalars().all()
    return {int(user.id): user for user in rows if user.id is not None}


def _user_public(user: Optional[User]) -> dict:
    if user is None:
        return {"user_id": 0, "name": "Unknown", "username": ""}
    name = " ".join(
        part for part in [user.first_name or "", user.last_name or ""] if part
    ).strip() or user.username
    return {"user_id": int(user.id or 0), "name": name, "username": user.username}


def _ranked(
    scope: _Scope, period: str, include_contests: bool
) -> list[tuple[int, ScoreBreakdown]]:
    user_ids = set(scope.solved) | set(scope.defenses) | set(scope.contests)
    scored = [
        (user_id, _score_for(scope, user_id, period, include_contests))
        for user_id in user_ids
    ]
    scored.sort(
        key=lambda item: (
            -item[1].score,
            -item[1].defense_count,
            -item[1].solved_count,
            item[0],
        )
    )
    return scored


async def get_my_stats(
    db: AsyncSession,
    org_id: int,
    current_user: PublicUser,
    period: str = "month",
    course_uuid: Optional[str] = None,
) -> dict:
    await _resolve_org(db, org_id)
    scope = await _collect_scope(db, org_id, period)
    breakdown = _score_for(scope, int(current_user.id or 0), period, True)

    org_ranked = _ranked(scope, period, True)
    org_rank = next(
        (index + 1 for index, (user_id, _) in enumerate(org_ranked) if user_id == current_user.id),
        None,
    )
    org_names = await _names(db, [user_id for user_id, _ in org_ranked])

    course_block = None
    if course_uuid:
        course = await _resolve_course(db, org_id, course_uuid)
        course_scope = await _collect_scope(
            db, org_id, period, course_id=int(course.id or 0), include_contests=False
        )
        course_breakdown = _score_for(
            course_scope, int(current_user.id or 0), period, False
        )
        course_ranked = _ranked(course_scope, period, False)
        course_rank = next(
            (
                index + 1
                for index, (user_id, _) in enumerate(course_ranked)
                if user_id == current_user.id
            ),
            None,
        )
        course_block = {
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "score": course_breakdown.score,
            "rank": course_rank,
            "participants": len(course_ranked),
            "breakdown": course_breakdown.__dict__,
        }

    return {
        "period": period,
        "score": breakdown.score,
        "breakdown": breakdown.__dict__,
        "rank": org_rank,
        "participants": len(org_ranked),
        "top": [
            {
                "rank": index + 1,
                "score": item.score,
                "defenses": item.defense_count,
                "solved": item.solved_count,
                **_user_public(org_names.get(user_id)),
            }
            for index, (user_id, item) in enumerate(org_ranked[:10])
        ],
        "course": course_block,
    }


async def get_leaderboard(
    db: AsyncSession,
    org_id: int,
    current_user: PublicUser,
    period: str = "month",
    course_uuid: Optional[str] = None,
    limit: int = 20,
) -> dict:
    await _resolve_org(db, org_id)
    include_contests = course_uuid is None
    course_id = None
    if course_uuid:
        course = await _resolve_course(db, org_id, course_uuid)
        course_id = int(course.id or 0)

    scope = await _collect_scope(
        db, org_id, period, course_id=course_id, include_contests=include_contests
    )
    ranked = _ranked(scope, period, include_contests)
    names = await _names(db, [user_id for user_id, _ in ranked])

    items = []
    me = None
    for index, (user_id, item) in enumerate(ranked):
        entry = {
            "rank": index + 1,
            "score": item.score,
            "defenses": item.defense_count,
            "solved": item.solved_count,
            "contests": item.contest_count,
            "regularity": item.components.get("regularity", 0),
            **_user_public(names.get(user_id)),
        }
        if index < limit:
            items.append(entry)
        if user_id == current_user.id:
            me = entry

    return {
        "period": period,
        "scope": "course" if course_uuid else "organization",
        "course_uuid": course_uuid,
        "participants": len(ranked),
        "items": items,
        "me": me,
    }


async def _require_instructor(
    db: AsyncSession, org_id: int, current_user: PublicUser, course: Optional[Course]
) -> None:
    role = await get_user_org_role(int(current_user.id or 0), org_id, db)
    is_admin = bool(getattr(current_user, "is_superadmin", False)) or (
        role is not None and (role.id == 1 or role.role_uuid == "role_global_admin")
    )
    if is_admin:
        return
    is_instructor = role is not None and role.role_uuid == "role_global_instructor"
    if not is_instructor or course is None:
        raise HTTPException(
            status_code=403, detail="Only the course instructor or an admin can do that"
        )
    authored = (
        await db.execute(
            select(ResourceAuthor.id).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == current_user.id,
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
            )
        )
    ).first()
    if not authored:
        raise HTTPException(status_code=403, detail="You do not teach this course")


async def create_defense(
    db: AsyncSession,
    org_id: int,
    current_user: PublicUser,
    *,
    user_id: Optional[int] = None,
    email: Optional[str] = None,
    course_uuid: Optional[str] = None,
    assignment_uuid: Optional[str] = None,
    note: str = "",
) -> dict:
    await _resolve_org(db, org_id)
    course = (
        await _resolve_course(db, org_id, course_uuid) if course_uuid else None
    )
    await _require_instructor(db, org_id, current_user, course)

    target: Optional[User] = None
    if user_id:
        target = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    elif email:
        target = (
            await db.execute(select(User).where(User.email == email.strip().lower()))
        ).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="Student not found")

    now = str(datetime.now())
    record = DefenseRecord(
        user_id=int(target.id or 0),
        org_id=org_id,
        course_id=int(course.id) if course and course.id else None,
        confirmed_by=int(current_user.id or 0),
        confirmed_at=now,
        note=note or "",
        creation_date=now,
        update_date=now,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return {
        "id": record.id,
        "user_id": record.user_id,
        "confirmed_at": record.confirmed_at,
    }


async def create_contest(
    db: AsyncSession,
    org_id: int,
    current_user: PublicUser,
    *,
    title: str = "",
    happened_on: Optional[str] = None,
) -> dict:
    await _resolve_org(db, org_id)
    when = happened_on or _now().date().isoformat()
    try:
        datetime.fromisoformat(when[:10])
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="happened_on must be YYYY-MM-DD")

    now = str(datetime.now())
    entry = ContestEntry(
        user_id=int(current_user.id or 0),
        org_id=org_id,
        title=(title or "").strip()[:200],
        happened_on=when[:10],
        creation_date=now,
        update_date=now,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return {"id": entry.id, "happened_on": entry.happened_on, "title": entry.title}


async def list_my_contests(
    db: AsyncSession, org_id: int, current_user: PublicUser, period: str = "month"
) -> dict:
    await _resolve_org(db, org_id)
    start = _start_for(period)
    stmt = select(ContestEntry).where(
        ContestEntry.org_id == org_id, ContestEntry.user_id == current_user.id
    )
    if start is not None:
        stmt = stmt.where(ContestEntry.happened_on >= start.date().isoformat())
    rows = (
        await db.execute(stmt.order_by(ContestEntry.happened_on.desc()))
    ).scalars().all()
    return {
        "items": [
            {"id": row.id, "title": row.title, "happened_on": row.happened_on}
            for row in rows
        ]
    }


async def delete_my_contest(
    db: AsyncSession, org_id: int, current_user: PublicUser, contest_id: int
) -> dict:
    row = (
        await db.execute(
            select(ContestEntry).where(
                ContestEntry.id == contest_id,
                ContestEntry.org_id == org_id,
                ContestEntry.user_id == current_user.id,
            )
        )
    ).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest entry not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}
