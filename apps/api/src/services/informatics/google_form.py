"""Google Forms submission for the «Хроники» solved-task tracker.

The public form «Внести решенную задачу в Хроники (2025-26)» is filled by
POSTing a urlencoded body to its ``formResponse`` action. Submitting it is more
than the two ``entry.*`` answers: Google's modern forms also require the hidden
anti-CSRF fields rendered on ``viewform`` (``fbzx``, ``tag``, ``partialResponse``,
``fvv``, ``pageHistory``, ``submissionTimestamp``). We fetch those from the live
page on every submission (``fbzx``/``tag`` rotate per page load) and replay them
verbatim together with the answers.

Important: this form is created in the Azati Google Workspace and **requires the
respondent to sign in** (it collects the Google account email via sign-in), so an
anonymous POST is rejected with 401. The ``email`` parameter is therefore not a
form field; it is kept for API compatibility. Opening the form to "Anyone with
the link" is a form-owner setting, not something this client can change.

Blind spot: Google answers a successful POST with HTTP 200 even when it
silently rejects the row (a stale token, a regex mismatch, or a blocked
submission). A ``True`` return therefore means only "the request was accepted by
the server", not "a row was written".
"""

from __future__ import annotations

import html as html_module
import logging
import re

import httpx

logger = logging.getLogger(__name__)

FORM_ID = "1FAIpQLSdDuSDHtPGx6kQ7fnmqgD0CGhjJV4yJ1oTAPfhcZ3tk6GNSOA"
VIEWFORM_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform"
FORMRESPONSE_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/formResponse"

# Confirmed against the live form HTML (FB_PUBLIC_LOAD_DATA_): the two questions
# are identified by these fixed entry ids. The respondent email is collected by
# Google via sign-in, not by an ``entry.*`` field.
TASK_ID_FIELD = "entry.8993807"
DATE_FIELD = "entry.17394566"

TIMEOUT = 10.0
MAX_ATTEMPTS = 4  # one initial POST plus up to 3 retries

_HEADERS = {"User-Agent": "Mozilla/5.0"}
_INPUT_RE = re.compile(r"<input[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(r'([\w:-]+)="([^"]*)"')


def _hidden_inputs(page_html: str) -> dict[str, str]:
    """Collect every ``<input type="hidden">`` name/value pair from the page."""
    fields: dict[str, str] = {}
    for tag in _INPUT_RE.findall(page_html):
        attrs = dict(_ATTR_RE.findall(tag))
        if attrs.get("type", "").lower() != "hidden":
            continue
        name = attrs.get("name")
        if not name:
            continue
        fields[html_module.unescape(name)] = html_module.unescape(attrs.get("value", ""))
    return fields


async def submit_solved_task(
    email: str,
    task_id: str,
    date: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> bool:
    """POST a solved task to the «Хроники» form. Never raises.

    Returns True when the POST receives an accepted (2xx/3xx) HTTP response,
    False on any error. See the module docstring for the 200-but-rejected blind
    spot and the sign-in restriction.
    """
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=TIMEOUT,
            follow_redirects=True,
            headers=_HEADERS,
        )
    try:
        # The fbzx/tag tokens are per-session and rotate on every page load, so a
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

        data = _hidden_inputs(viewform.text)
        if "fbzx" not in data:
            logger.warning("google_form: no fbzx token found in viewform")
            return False

        data[TASK_ID_FIELD] = task_id
        data[DATE_FIELD] = date

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
