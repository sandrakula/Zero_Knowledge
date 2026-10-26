"""Account binding and proxy submission to the Informatics judge."""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.informatics_link import InformaticsLink
from src.db.informatics_submission import InformaticsSubmission
from src.db.problems import Problem
from src.db.users import PublicUser
from src.services.informatics import client
from src.services.webhooks.crypto import decrypt_secret, encrypt_secret

POLL_INTERVAL_SECONDS = 2.0
POLL_MAX_SECONDS = 90.0


async def _get_link(user_id: int, db_session: AsyncSession) -> InformaticsLink | None:
    return (
        await db_session.execute(
            select(InformaticsLink).where(InformaticsLink.user_id == user_id)
        )
    ).scalars().first()


async def get_link_status(user_id: int, db_session: AsyncSession) -> dict:
    link = await _get_link(user_id, db_session)
    if not link:
        return {"linked": False}
    return {
        "linked": True,
        "informatics_user_id": link.informatics_user_id,
        "informatics_username": link.informatics_username,
        "last_error": link.last_error,
    }


async def link_account(
    user: PublicUser,
    session_cookie: str,
    db_session: AsyncSession,
) -> dict:
    """Verify an Informatics session and bind it to the user (upsert)."""
    session_cookie = (session_cookie or "").strip()
    if not session_cookie:
        raise HTTPException(status_code=400, detail="Session cookie is required")

    try:
        identity = await asyncio.to_thread(client.verify_session, session_cookie)
    except client.InformaticsError as exc:
        raise HTTPException(status_code=400, detail=f"Informatics session invalid: {exc}")

    now = str(datetime.now())
    link = await _get_link(int(user.id), db_session)
    if link is None:
        link = InformaticsLink(
            user_id=int(user.id),
            session_cookie=encrypt_secret(session_cookie),
            informatics_user_id=identity["informatics_user_id"],
            informatics_username=identity["informatics_username"],
            last_error=None,
            created_at=now,
            updated_at=now,
        )
        db_session.add(link)
    else:
        link.session_cookie = encrypt_secret(session_cookie)
        link.informatics_user_id = identity["informatics_user_id"]
        link.informatics_username = identity["informatics_username"]
        link.last_error = None
        link.updated_at = now
    await db_session.commit()
    await db_session.refresh(link)
    return {
        "linked": True,
        "informatics_user_id": link.informatics_user_id,
        "informatics_username": link.informatics_username,
    }


async def unlink_account(user_id: int, db_session: AsyncSession) -> None:
    link = await _get_link(user_id, db_session)
    if link is not None:
        await db_session.delete(link)
        await db_session.commit()


def _decrypt_cookie(link: InformaticsLink) -> str:
    try:
        return decrypt_secret(link.session_cookie)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail="Could not decrypt Informatics session"
        ) from exc


async def _record_submission(
    user_id: int,
    problem_id: int,
    verdict: dict,
    db_session: AsyncSession,
) -> None:
    """Upsert the latest verdict for (user, problem) so statistics can aggregate it."""
    from sqlmodel import select as _select

    category = (
        await db_session.execute(
            _select(Problem.category).where(
                Problem.source_id == str(problem_id),
                Problem.source_name == "Informatics",
            )
        )
    ).scalars().first() or ""

    now = str(datetime.now())
    row = (
        await db_session.execute(
            select(InformaticsSubmission).where(
                InformaticsSubmission.user_id == user_id,
                InformaticsSubmission.problem_id == problem_id,
            )
        )
    ).scalars().first()
    if row is None:
        row = InformaticsSubmission(
            user_id=user_id,
            problem_id=problem_id,
            category=category,
            informatics_run_id=int(verdict.get("run_id") or 0),
            status=int(verdict.get("status") or 0),
            tests=int(verdict.get("tests") or 0),
            score=int(verdict.get("score") or 0),
            solved=bool(verdict.get("solved")),
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
    else:
        row.category = category
        row.informatics_run_id = int(verdict.get("run_id") or 0)
        row.status = int(verdict.get("status") or 0)
        row.tests = int(verdict.get("tests") or 0)
        row.score = int(verdict.get("score") or 0)
        row.solved = bool(verdict.get("solved"))
        row.updated_at = now
    await db_session.commit()


async def submit_and_grade(
    user: PublicUser,
    problem_id: int,
    our_lang_id: int,
    source_code: str,
    db_session: AsyncSession,
) -> dict:
    """Submit code to Informatics on the student's behalf and return the verdict."""
    if not source_code or not source_code.strip():
        raise HTTPException(status_code=400, detail="source_code is required")

    informatics_lang = client.OUR_TO_INFORMATICS_LANG.get(our_lang_id)
    if informatics_lang is None:
        raise HTTPException(status_code=400, detail=f"Unsupported language id {our_lang_id}")

    link = await _get_link(int(user.id), db_session)
    if link is None:
        raise HTTPException(
            status_code=400,
            detail="Informatics account is not linked. Link it in your profile first.",
        )
    cookie = _decrypt_cookie(link)

    try:
        run_id = await asyncio.to_thread(
            client.submit, problem_id, informatics_lang, source_code, cookie
        )
    except client.InformaticsError as exc:
        message = str(exc)
        if "duplicate" in message.lower():
            # Identical source already submitted: re-read that run's verdict.
            verdict = await asyncio.to_thread(
                client.get_run, problem_id, None, link.informatics_user_id, cookie
            )
            if verdict is not None:
                await _clear_error(link, db_session)
                verdict["solved"] = verdict["status"] in client.SOLVED_STATUSES
                await _record_submission(int(user.id), problem_id, verdict, db_session)
                return verdict
        await _mark_error(link, db_session, message)
        raise HTTPException(status_code=502, detail=f"Informatics submit failed: {exc}")

    # Poll for the final verdict.
    elapsed = 0.0
    while elapsed < POLL_MAX_SECONDS:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS
        try:
            verdict = await asyncio.to_thread(
                client.get_run, problem_id, run_id, link.informatics_user_id, cookie
            )
        except client.InformaticsError:
            continue
        if verdict is not None:
            await _clear_error(link, db_session)
            verdict["solved"] = verdict["status"] in client.SOLVED_STATUSES
            await _record_submission(int(user.id), problem_id, verdict, db_session)
            return verdict

    raise HTTPException(status_code=504, detail="Informatics verdict timed out")


async def _mark_error(link: InformaticsLink, db_session: AsyncSession, message: str) -> None:
    link.last_error = message
    link.updated_at = str(datetime.now())
    db_session.add(link)
    await db_session.commit()


async def _clear_error(link: InformaticsLink, db_session: AsyncSession) -> None:
    if link.last_error is not None:
        link.last_error = None
        link.updated_at = str(datetime.now())
        db_session.add(link)
        await db_session.commit()
