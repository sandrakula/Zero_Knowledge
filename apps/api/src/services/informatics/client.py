"""HTTP client for the Informatics judge (informatics.msk.ru).

The platform treats Informatics as the authoritative judge for the course's
programming tasks: students write code here, we submit it on their behalf
(using their own bound session), and Informatics runs the hidden tests and
returns the verdict.

Endpoints (reverse-engineered from the statements module, all JSON):
- submit:            POST /py/problem/<id>/submit  (multipart: file + lang_id)
- list runs:         GET  /py/problem/<id>/filter-runs
- run source:        GET  /py/problem/run/<run_id>/source
- problem + languages: GET /py/problem/<id>/json
"""

from __future__ import annotations

import re
from typing import Any

import httpx

BASE = "https://informatics.msk.ru"
TIMEOUT = 30.0

# Our (Judge0) language id -> Informatics language id.
OUR_TO_INFORMATICS_LANG = {
    71: 27,   # Python 3 -> Python 3.9
    54: 3,    # C++ -> GNU C++ 11.2
    50: 2,    # C -> GNU C 11.2
    62: 18,   # Java -> Java JDK 15
}

# Source filename extension per Informatics language id (for the upload + editor).
LANG_EXT = {
    27: "py",
    3: "cpp",
    2: "c",
    18: "java",
}

# ejudge status ids that mean "still running / not yet a final verdict".
IN_PROGRESS_STATUSES = {11, 96, 98, 377}
# A submission is "solved" when the judge marks it accepted/counted.
SOLVED_STATUSES = {0, 8}


class InformaticsError(Exception):
    """A recoverable Informatics failure (bad session, network, non-final)."""


def _client(cookie: str) -> httpx.Client:
    return httpx.Client(
        base_url=BASE,
        timeout=TIMEOUT,
        follow_redirects=True,
        headers={
            "Cookie": f"MoodleSession={cookie}",
            "User-Agent": "Mozilla/5.0",
            "X-Requested-With": "XMLHttpRequest",
        },
    )


def verify_session(cookie: str) -> dict[str, Any]:
    """Confirm the session is logged in and return the Informatics identity.

    Raises ``InformaticsError`` when the session is invalid/expired.
    """
    with _client(cookie) as c:
        r = c.get("/")
    r.raise_for_status()
    text = r.text
    if "Вы зашли под именем" not in text:
        raise InformaticsError("session is not logged in")
    m_id = re.search(r"profile\.php\?id=(\d+)", text) or re.search(r"/user/view\.php\?id=(\d+)", text)
    if not m_id:
        raise InformaticsError("could not resolve Informatics user id")
    # Name is embedded in HTML; strip tags to read it cleanly.
    stripped = re.sub(r"<[^>]+>", " ", text)
    m_name = re.search(r"Вы зашли под именем\s+([^<(]+)", stripped)
    return {
        "informatics_user_id": int(m_id.group(1)),
        "informatics_username": (m_name.group(1).strip() if m_name else ""),
    }


def submit(problem_id: int, lang_id: int, source: str, cookie: str) -> int:
    """Submit source code and return the new run id."""
    ext = LANG_EXT.get(lang_id, "txt")
    filename = f"solution.{ext}"
    with _client(cookie) as c:
        r = c.post(
            f"/py/problem/{problem_id}/submit",
            data={"lang_id": str(lang_id)},
            files={"file": (filename, source.encode("utf-8"), "text/plain")},
        )
    if r.status_code != 200:
        raise InformaticsError(f"submit failed: HTTP {r.status_code} {r.text[:200]}")
    data = r.json()
    if data.get("status") != "success" or not data.get("data", {}).get("run_id"):
        raise InformaticsError(f"submit rejected: {r.text[:300]}")
    return int(data["data"]["run_id"])


def get_run(problem_id: int, run_id: int | None, informatics_user_id: int, cookie: str) -> dict[str, Any] | None:
    """Return the verdict for a run, or None while it is still in progress.

    When ``run_id`` is None the most recent run for the user is returned (used
    to re-read a duplicate submission's verdict).
    """
    with _client(cookie) as c:
        r = c.get(
            f"/py/problem/{problem_id}/filter-runs",
            params={
                "problem_id": problem_id,
                "from_timestamp": -1,
                "to_timestamp": -1,
                "user_id": informatics_user_id,
                "lang_id": -1,
                "status_id": -1,
                "statement_id": 0,
                "count": 10,
                "with_comment": "",
                "page": 1,
            },
        )
    if r.status_code != 200:
        raise InformaticsError(f"filter-runs failed: HTTP {r.status_code}")
    data = r.json()
    for run in data.get("data", []):
        if run_id is not None and run.get("id") != run_id:
            continue
        status = run.get("ejudge_status")
        if status in IN_PROGRESS_STATUSES:
            return None
        return {
            "run_id": run.get("id"),
            "status": status,
            "tests": run.get("ejudge_test_num"),
            "score": run.get("ejudge_score"),
            "lang_id": run.get("lang_id"),
        }
    return None


def get_source(run_id: int, cookie: str) -> str:
    """Fetch the submitted source code for a run (accepted solutions)."""
    with _client(cookie) as c:
        r = c.get(f"/py/problem/run/{run_id}/source")
    if r.status_code != 200:
        raise InformaticsError(f"source failed: HTTP {r.status_code}")
    data = r.json()
    return data.get("data", {}).get("source", "")


def get_problem_languages(problem_id: int) -> list[dict]:
    """Return the problem's allowed languages ([{id, name}, ...])."""
    with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"}) as c:
        r = c.get(f"{BASE}/py/problem/{problem_id}/json")
    r.raise_for_status()
    return r.json().get("languages", [])
