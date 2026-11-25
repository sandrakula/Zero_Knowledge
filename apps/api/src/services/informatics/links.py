"""Account linking against informatics.msk.ru.

The password is encrypted before it touches the database and is never returned
by any endpoint. Linking logs in once to prove the credentials and to resolve
the public Informatics user id.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.informatics import InformaticsAccount, InformaticsLinkStatus
from src.services.informatics.client import InformaticsAuthError, InformaticsClient
from src.services.informatics.crypto import decrypt_secret, encrypt_secret
from src.services.informatics.ingest import ensure_account, get_account


class LinkError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now().isoformat()


def link_to_dict(account: InformaticsAccount | None) -> dict:
    if account is None:
        return {
            "linked": False,
            "status": InformaticsLinkStatus.UNVERIFIED.value,
            "informatics_user_id": 0,
            "informatics_username": "",
            "email": "",
            "last_verified_at": "",
            "last_error": "",
            "auth_method": "none",
            "has_password": False,
            "has_session": False,
        }
    has_password = bool(account.password_encrypted)
    has_session = bool(account.session_encrypted)
    return {
        "linked": bool(has_password or has_session),
        "status": account.status or InformaticsLinkStatus.UNVERIFIED.value,
        "informatics_user_id": account.informatics_user_id,
        "informatics_username": account.username,
        "email": account.email,
        "last_verified_at": account.last_verified_at,
        "last_error": account.last_error or "",
        "auth_method": (
            "password" if has_password else "session" if has_session else "none"
        ),
        "has_password": has_password,
        "has_session": has_session,
    }


async def link_account(
    db: AsyncSession,
    user_id: int,
    username: str,
    password: str,
    email: str = "",
) -> InformaticsAccount:
    username = (username or "").strip()
    password = password or ""
    email = (email or "").strip()
    if not username or not password:
        raise LinkError("Username and password are required")

    account = await ensure_account(db, user_id)
    try:
        async with InformaticsClient() as client:
            result = await client.login(username, password)
    except InformaticsAuthError as exc:
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = str(exc)
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError(str(exc)) from exc
    except Exception as exc:  # network/HTTP errors
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = f"Could not reach informatics.msk.ru: {exc.__class__.__name__}"
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError(
            "Could not reach informatics.msk.ru. Try again later."
        ) from exc

    now = _now()
    account.username = username
    account.email = email
    account.password_encrypted = encrypt_secret(password)
    account.informatics_user_id = result.informatics_user_id
    account.status = InformaticsLinkStatus.ACTIVE.value
    account.last_verified_at = now
    account.last_error = ""
    account.updated_at = now
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def link_session(
    db: AsyncSession,
    user_id: int,
    moodle_session: str,
    email: str = "",
) -> InformaticsAccount:
    """Connect a Google-only account by importing its MoodleSession cookie.

    The cookie is validated against informatics.msk.ru, encrypted at rest and
    never returned. It expires like any browser session, so the learner may need
    to repeat this after a long break.
    """
    cookie = (moodle_session or "").strip()
    if not cookie:
        raise LinkError("MoodleSession is required")

    account = await ensure_account(db, user_id)
    try:
        async with InformaticsClient() as client:
            result = await client.use_session(cookie)
    except InformaticsAuthError as exc:
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = str(exc)
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError(str(exc)) from exc
    except Exception as exc:  # network/HTTP errors
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = (
            f"Could not reach informatics.msk.ru: {exc.__class__.__name__}"
        )
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError(
            "Could not reach informatics.msk.ru. Try again later."
        ) from exc

    now = _now()
    account.session_encrypted = encrypt_secret(cookie)
    if email.strip():
        account.email = email.strip()
        if not account.username:
            account.username = email.strip()
    account.informatics_user_id = result.informatics_user_id
    account.status = InformaticsLinkStatus.ACTIVE.value
    account.last_verified_at = now
    account.last_error = ""
    account.updated_at = now
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def verify_account(db: AsyncSession, user_id: int) -> InformaticsAccount:
    account = await get_account(db, user_id)
    if account is None or not (
        account.password_encrypted or account.session_encrypted
    ):
        raise LinkError("Informatics account is not linked", status_code=404)

    password = (
        decrypt_secret(account.password_encrypted)
        if account.password_encrypted
        else ""
    )
    session = (
        decrypt_secret(account.session_encrypted)
        if account.session_encrypted
        else ""
    )
    if not password and not session:
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = "Stored Informatics credentials could not be decrypted"
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError("Stored Informatics credentials are no longer valid")

    try:
        async with InformaticsClient() as client:
            result = None
            if session:
                try:
                    result = await client.use_session(session)
                except InformaticsAuthError:
                    if not password:
                        raise
            if result is None and password:
                result = await client.login(account.username, password)
    except InformaticsAuthError as exc:
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = str(exc)
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError(str(exc)) from exc
    except Exception as exc:
        account.status = InformaticsLinkStatus.INVALID.value
        account.last_error = (
            f"Could not reach informatics.msk.ru: {exc.__class__.__name__}"
        )
        account.updated_at = _now()
        db.add(account)
        await db.commit()
        raise LinkError("Could not reach informatics.msk.ru") from exc

    now = _now()
    account.informatics_user_id = result.informatics_user_id
    account.status = InformaticsLinkStatus.ACTIVE.value
    account.last_verified_at = now
    account.last_error = ""
    account.updated_at = now
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def unlink_account(db: AsyncSession, user_id: int) -> None:
    account = await get_account(db, user_id)
    if account is not None:
        await db.delete(account)
        await db.commit()


async def unlink_server_account(db: AsyncSession, user_id: int) -> None:
    """Forget the stored password and MoodleSession cookie.

    The userscript token, if any, is left untouched so legacy script users can
    still post verdicts.
    """
    account = await get_account(db, user_id)
    if account is None:
        return
    account.password_encrypted = ""
    account.session_encrypted = ""
    account.email = ""
    account.status = InformaticsLinkStatus.UNVERIFIED.value
    account.last_verified_at = ""
    account.last_error = ""
    account.updated_at = _now()
    db.add(account)
    await db.commit()
