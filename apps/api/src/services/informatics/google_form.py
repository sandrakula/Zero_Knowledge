"""Google Forms submission for the «Хроники» solved-task tracker.

The public form «Внести решенную задачу в Хроники (2025-26)» is filled by
POSTing a urlencoded body to its ``formResponse`` action. The two questions
map to fixed ``entry.*`` ids and the respondent email is collected through
Google's built-in "collect email addresses" field (``emailAddress``), so it has
no per-question ``entry.*`` id of its own.

Blind spot: Google answers a successful POST with HTTP 200 even when it
silently rejects the row (a stale ``fbzx`` token, a regex mismatch, or a
blocked submission). A ``True`` return therefore means only "the request was
accepted by the server", not "a row was written"; there is no response payload
we can inspect to distinguish the two.
"""

from __future__ import annotations

import logging
import re

import httpx

logger = logging.getLogger(__name__)

FORM_ID = "1FAIpQLSdDuSDHtPGx6kQ7fnmqgD0CGhjJV4yJ1oTAPfhcZ3tk6GNSOA"
VIEWFORM_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform"
FORMRESPONSE_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/formResponse"

# Confirmed against the live form HTML (data-params): the two questions are
# identified by these fixed entry ids; email uses Google's collect-email field.
EMAIL_FIELD = "emailAddress"
TASK_ID_FIELD = "entry.8993807"
DATE_FIELD = "entry.17394566"

TIMEOUT = 10.0
MAX_ATTEMPTS = 4  # one initial POST plus up to 3 retries

_HEADERS = {"User-Agent": "Mozilla/5.0"}
_FBZX_RE = re.compile(r'name="fbzx" value="([^"]+)"')


async def submit_solved_task(
    email: str,
    task_id: str,
    date: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> bool:
    """POST a solved task to the «Хроники» form. Never raises.

    Returns True when the POST receives an accepted (2xx/3xx) HTTP response,
    False on any error. See the module docstring for the 200-but-rejected
    blind spot: True does not guarantee a row was actually written.
    """
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=TIMEOUT,
            follow_redirects=True,
            headers=_HEADERS,
        )
    try:
        # The fbzx token is per-session and rotates on every page load, so a
        # fresh GET to the viewform is required before the POST.
        try:
            viewform = await client.get(VIEWFORM_URL)
        except httpx.HTTPError as exc:
            logger.warning("google_form: viewform fetch failed: %s", exc)
            return False
        if not viewform.is_success:
            logger.warning(
                "google_form: viewform fetch got HTTP %s", viewform.status_code
            )
            return False
        match = _FBZX_RE.search(viewform.text)
        if match is None:
            logger.warning("google_form: no fbzx token found in viewform")
            return False

        data = {
            EMAIL_FIELD: email,
            TASK_ID_FIELD: task_id,
            DATE_FIELD: date,
            "fbzx": match.group(1),
        }
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await client.post(FORMRESPONSE_URL, data=data)
            except httpx.HTTPError as exc:
                logger.warning(
                    "google_form: POST attempt %d/%d failed: %s",
                    attempt,
                    MAX_ATTEMPTS,
                    exc,
                )
                continue
            if response.is_success or response.is_redirect:
                return True
            if response.status_code >= 500:
                logger.warning(
                    "google_form: POST attempt %d/%d got HTTP %s",
                    attempt,
                    MAX_ATTEMPTS,
                    response.status_code,
                )
                continue
            logger.warning("google_form: POST rejected: HTTP %s", response.status_code)
            return False
        return False
    except Exception:
        logger.exception("google_form: unexpected error submitting task %s", task_id)
        return False
    finally:
        if owns_client:
            await client.aclose()
