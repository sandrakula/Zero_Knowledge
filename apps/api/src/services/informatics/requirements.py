"""Course-level requirements for the Informatics userscript.

The bundled Informatics course is graded on informatics.msk.ru, and the only
way a verdict reaches the LMS is the browser userscript. A course can therefore
declare that every learner must connect an account and have a running script
before the LMS accepts their work.

The flag lives in ``course.extra_metadata["informatics"]["require_script"]``
and is opt-in per course, so no existing course or task changes behaviour.

"Ready" means two things, not one:

* ``connected``: the learner generated an ingest token;
* ``script_seen``: that exact token called ``/informatics/ping`` after it was
  created. This proves the script is installed and running in a browser; minting
  a token alone does not.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.services.informatics.ingest import get_account


def _json_value(value: Any) -> dict:
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value or {}


def course_requires_informatics(course: Course) -> bool:
    """Whether this course makes the Informatics userscript mandatory."""
    meta = _json_value(course.extra_metadata)
    block = meta.get("informatics") or {}
    if not isinstance(block, dict):
        return False
    return bool(block.get("require_script"))


def _script_seen(account) -> bool:
    """True when the *current* token has pinged the LMS.

    ``last_seen_at`` can predate a token rotation, so compare it with
    ``token_created_at``. Both are ISO strings written by the same code path,
    which sort lexicographically.
    """
    if account is None or not account.ingest_token_hash or not account.last_seen_at:
        return False
    if account.token_created_at and account.last_seen_at < account.token_created_at:
        return False
    return True


async def get_requirement(
    db: AsyncSession, user_id: int, course: Course
) -> dict:
    """Describe the learner's Informatics setup state for ``course``."""
    required = course_requires_informatics(course)
    account = await get_account(db, user_id)
    connected = bool(account and (account.ingest_token_hash or account.password_encrypted))
    script_seen = _script_seen(account)
    # The product path is login + password. A legacy userscript token alone is
    # not treated as a working connection: it cannot submit code and the
    # account page no longer offers it.
    server_linked = bool(
        account
        and account.status == "ACTIVE"
        and (account.password_encrypted or account.session_encrypted)
    )
    ready = (not required) or server_linked
    reason = "" if ready else "connect"

    return {
        "course_uuid": course.course_uuid,
        "required": required,
        "connected": connected,
        "script_seen": script_seen,
        "server_linked": server_linked,
        "ready": ready,
        "reason": reason,
        "last_seen_at": account.last_seen_at if account else "",
        "manage_url": "/account/informatics",
    }


async def ensure_informatics_ready(
    db: AsyncSession, user_id: int, course: Course
) -> None:
    """Block a learner's write until the Informatics login is connected.

    Instructors and API-token submissions are exempted by the caller; this
    function only knows about the learner's own account state.
    """
    requirement = await get_requirement(db, user_id, course)
    if requirement["ready"]:
        return

    raise HTTPException(
        status_code=403,
        detail={
            "code": "informatics_setup_required",
            "reason": requirement["reason"],
            "message": (
                "This course is graded on informatics.msk.ru. Connect your "
                "account (login and password) in Account → Informatics before "
                "submitting."
            ),
            "url": requirement["manage_url"],
        },
    )
