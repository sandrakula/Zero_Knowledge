"""Account binding and proxy submission to the Informatics judge."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.informatics_link import InformaticsLink
from src.db.informatics_submission import InformaticsSubmission
from src.db.informatics_task_map import InformaticsTaskMap
from src.db.users import PublicUser
from src.services.informatics import client
from src.services.informatics.google_form import submit_solved_task
from src.services.webhooks.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2.0
POLL_MAX_SECONDS = 90.0

# Best-effort Google Form submissions scheduled fire-and-forget. The set keeps a
# strong reference to each in-flight task so the event loop cannot garbage
# collect it before it runs; the done callback drops it and drains the result.
_PENDING_FORM_TASKS: set[asyncio.Task[bool]] = set()


def _forget_form_task(task: asyncio.Task[bool]) -> None:
    """Drop a finished form task and surface any exception it raised."""
    _PENDING_FORM_TASKS.discard(task)
    try:
        task.exception()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Informatics: background Google Form submission failed")


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
        "email": link.email,
        "last_error": link.last_error,
    }


async def link_account(
    user: PublicUser,
    username: str,
    password: str,
    email: str,
    db_session: AsyncSession,
) -> dict:
    """Verify Informatics credentials and bind the account to the user (upsert)."""
    username = (username or "").strip()
    email = (email or "").strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="Логин и пароль обязательны")
    if not email:
        raise HTTPException(status_code=400, detail="Email обязателен")

    try:
        session = await asyncio.to_thread(client.login, username, password)
    except client.InformaticsError as exc:
        raise HTTPException(status_code=400, detail=f"Не удалось войти в Informatics: {exc}")

    now = str(datetime.now())
    link = await _get_link(int(user.id), db_session)
    if link is None:
        link = InformaticsLink(
            user_id=int(user.id),
            username=username,
            password=encrypt_secret(password),
            email=email,
            informatics_user_id=session["informatics_user_id"],
            informatics_username=session["informatics_username"],
            last_error=None,
            created_at=now,
            updated_at=now,
        )
        db_session.add(link)
    else:
        link.username = username
        link.password = encrypt_secret(password)
        link.email = email
        link.informatics_user_id = session["informatics_user_id"]
        link.informatics_username = session["informatics_username"]
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


async def _login_session(link: InformaticsLink) -> dict:
    """Log in with the stored credentials and return a fresh session cookie."""
    try:
        username = link.username
        password = decrypt_secret(link.password)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail="Could not decrypt Informatics credentials"
        ) from exc
    try:
        return await asyncio.to_thread(client.login, username, password)
    except client.InformaticsError as exc:
        raise HTTPException(status_code=502, detail=f"Informatics login failed: {exc}") from exc


async def _record_submission(
    user_id: int,
    problem_id: int,
    verdict: dict,
    db_session: AsyncSession,
) -> None:
    """Upsert the latest verdict for (user, problem) so statistics can aggregate it."""
    mapping = (
        await db_session.execute(
            select(InformaticsTaskMap).where(
                InformaticsTaskMap.problem_id == problem_id
            )
        )
    ).scalars().first()
    category = (mapping.category if mapping else "") or ""
    task_id = (mapping.task_id if mapping else "") or ""

    link = await _get_link(user_id, db_session)
    email = (link.email or "").strip() if link else ""

    now = str(datetime.now())
    row = (
        await db_session.execute(
            select(InformaticsSubmission)
            .where(
                InformaticsSubmission.user_id == user_id,
                InformaticsSubmission.problem_id == problem_id,
            )
            .with_for_update()
        )
    ).scalars().first()

    was_solved = row.solved if row else False
    already_logged = row.logged_to_form if row else False
    new_solved = bool(verdict.get("solved"))
    first_solved_transition = (not was_solved) and new_solved and (not already_logged)
    should_log = first_solved_transition and bool(task_id) and bool(email)
    if first_solved_transition and not should_log:
        if not task_id:
            logger.warning(
                "Informatics: skipping Google Form log for problem %s: no task_id",
                problem_id,
            )
        if not email:
            logger.warning(
                "Informatics: skipping Google Form log for problem %s (user %s): no email",
                problem_id,
                user_id,
            )

    if row is None:
        row = InformaticsSubmission(
            user_id=user_id,
            problem_id=problem_id,
            category=category,
            informatics_run_id=int(verdict.get("run_id") or 0),
            status=int(verdict.get("status") or 0),
            tests=int(verdict.get("tests") or 0),
            score=int(verdict.get("score") or 0),
            solved=new_solved,
            logged_to_form=should_log,
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
        row.solved = new_solved
        if should_log:
            row.logged_to_form = True
        row.updated_at = now
    await db_session.commit()

    if should_log:
        date = datetime.now().strftime("%Y-%m-%d")
        task = asyncio.create_task(submit_solved_task(email, task_id, date))
        _PENDING_FORM_TASKS.add(task)
        task.add_done_callback(_forget_form_task)


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
    session = await _login_session(link)
    cookie = session["cookie"]

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
