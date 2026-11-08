"""Best-effort Google Form logging on first transition to solved (no network)."""

import asyncio
from datetime import datetime

import pytest
from sqlmodel import select

from src.db.informatics_link import InformaticsLink
from src.db.informatics_submission import InformaticsSubmission
from src.db.informatics_task_map import InformaticsTaskMap
from src.services.informatics import links


def _solved_verdict() -> dict:
    return {"run_id": 42, "status": 0, "tests": 5, "score": 5, "solved": True}


async def _flush_form_tasks() -> None:
    """Await every fire-and-forget form task so assertions see the fake's calls."""
    pending = list(links._PENDING_FORM_TASKS)
    if pending:
        await asyncio.gather(*pending)


def _add_problem(db, problem_id: int, task_id: str | None) -> None:
    db.add(
        InformaticsTaskMap(
            problem_id=problem_id,
            task_id=(task_id or ""),
            category="CAT_001",
            title="T",
        )
    )


def _add_link(db, user_id: int, email: str) -> None:
    db.add(
        InformaticsLink(
            user_id=user_id,
            username="stu",
            password="enc",
            email=email,
            informatics_user_id=123,
            informatics_username="stu",
        )
    )


@pytest.mark.asyncio
async def test_first_solve_logs_exactly_once(db, regular_user, monkeypatch):
    problem_id = 1001
    _add_problem(db, problem_id, "TASK_1234")
    _add_link(db, regular_user.id, "  student@test.com  ")
    await db.commit()

    calls: list[tuple[str, str, str]] = []

    async def fake(email: str, task_id: str, date: str) -> None:
        calls.append((email, task_id, date))

    monkeypatch.setattr("src.services.informatics.links.submit_solved_task", fake)

    await links._record_submission(regular_user.id, problem_id, _solved_verdict(), db)
    await _flush_form_tasks()

    assert calls == [
        ("student@test.com", "TASK_1234", datetime.now().strftime("%Y-%m-%d"))
    ]
    # The flag is persisted in the same commit as the verdict (idempotency guard).
    row = (
        await db.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.user_id == regular_user.id,
                InformaticsSubmission.problem_id == problem_id,
            )
        )
    ).scalars().one()
    assert row.logged_to_form is True


@pytest.mark.asyncio
async def test_repeat_solve_does_not_log(db, regular_user, monkeypatch):
    problem_id = 1002
    _add_problem(db, problem_id, "TASK_1234")
    _add_link(db, regular_user.id, "student@test.com")
    db.add(
        InformaticsSubmission(
            user_id=regular_user.id,
            problem_id=problem_id,
            category="CAT_001",
            solved=True,
            logged_to_form=True,
        )
    )
    await db.commit()

    calls: list[tuple[str, str, str]] = []

    async def fake(email: str, task_id: str, date: str) -> None:
        calls.append((email, task_id, date))

    monkeypatch.setattr("src.services.informatics.links.submit_solved_task", fake)

    await links._record_submission(regular_user.id, problem_id, _solved_verdict(), db)
    await _flush_form_tasks()

    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "task_id, email",
    [("", "student@test.com"), ("TASK_1234", "")],
)
async def test_no_log_when_task_id_or_email_missing(
    db, regular_user, monkeypatch, task_id, email
):
    problem_id = 1003
    _add_problem(db, problem_id, task_id or None)
    _add_link(db, regular_user.id, email)
    await db.commit()

    calls: list[tuple[str, str, str]] = []

    async def fake(email: str, task_id: str, date: str) -> None:
        calls.append((email, task_id, date))

    monkeypatch.setattr("src.services.informatics.links.submit_solved_task", fake)

    await links._record_submission(regular_user.id, problem_id, _solved_verdict(), db)
    await _flush_form_tasks()

    assert calls == []
