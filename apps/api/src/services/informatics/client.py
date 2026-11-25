"""Async HTTP adapter for informatics.msk.ru.

The adapter only speaks the protocol. It never touches the database, never logs
credentials/cookies and never follows arbitrary hosts: every URL is built from
the fixed base URL and integer ids.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

BASE_URL = "https://informatics.msk.ru"
USER_AGENT = "Mozilla/5.0"
LOGIN_TOKEN_RE = re.compile(
    r'name=["\']logintoken["\'][^>]*value=["\']([^"\']+)', re.IGNORECASE
)
PROFILE_ID_RE = re.compile(
    r"(?:profile\.php\?id=|/user/view\.php\?id=)(\d+)", re.IGNORECASE
)
LOGGED_IN_MARKER = "Вы зашли под именем"


class InformaticsError(Exception):
    """Base error safe to turn into a user-facing message."""


class InformaticsAuthError(InformaticsError):
    pass


class InformaticsSubmitError(InformaticsError):
    pass


@dataclass
class LoginResult:
    informatics_user_id: int
    username: str


@dataclass
class SubmitResult:
    run_id: int | None
    duplicate: bool
    raw: dict[str, Any]


class InformaticsClient:
    def __init__(
        self,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=httpx.Timeout(timeout, connect=10.0),
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            },
            follow_redirects=True,
            transport=transport,
        )

    async def __aenter__(self) -> "InformaticsClient":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def login(self, username: str, password: str) -> LoginResult:
        # The first request obtains the MoodleSession cookie and the login form.
        await self._client.get("/")
        page = await self._client.get("/login/index.php")
        page.raise_for_status()
        match = LOGIN_TOKEN_RE.search(page.text)
        if not match:
            raise InformaticsAuthError("login token not found")

        response = await self._client.post(
            "/login/index.php",
            data={
                "username": username,
                "password": password,
                "logintoken": match.group(1),
                "anchor": "",
            },
        )
        response.raise_for_status()

        if not self._client.cookies.get("MoodleSession"):
            raise InformaticsAuthError("login failed: no MoodleSession cookie")

        return await self._profile_from_home(username)

    async def use_session(self, moodle_session: str) -> LoginResult:
        """Authenticate with an existing MoodleSession cookie.

        Google-only Informatics accounts have no local password. The learner
        signs in through Google in their own browser, copies the MoodleSession
        cookie and hands it over once; we validate it here and the worker keeps
        using it until it expires.
        """
        cookie = (moodle_session or "").strip()
        if not cookie:
            raise InformaticsAuthError("empty MoodleSession")
        self._client.cookies.set(
            "MoodleSession", cookie, domain="informatics.msk.ru", path="/"
        )
        return await self._profile_from_home("")

    async def _profile_from_home(self, username: str = "") -> LoginResult:
        home = await self._client.get("/")
        home.raise_for_status()
        if LOGGED_IN_MARKER not in home.text:
            raise InformaticsAuthError("login failed: invalid credentials")

        profile = PROFILE_ID_RE.search(home.text)
        user_id = int(profile.group(1)) if profile else 0
        if not user_id:
            raise InformaticsAuthError("could not resolve informatics user id")

        return LoginResult(informatics_user_id=user_id, username=username)

    async def verify_session(self) -> bool:
        try:
            response = await self._client.get("/")
            return response.status_code == 200 and LOGGED_IN_MARKER in response.text
        except httpx.HTTPError:
            return False

    async def submit(
        self,
        problem_id: int,
        informatics_lang_id: int,
        source: str,
        extension: str,
    ) -> SubmitResult:
        response = await self._client.post(
            f"/py/problem/{int(problem_id)}/submit",
            data={"lang_id": int(informatics_lang_id)},
            files={
                "file": (
                    f"solution.{extension}",
                    source.encode("utf-8"),
                    "text/plain",
                )
            },
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        body = response.text
        if response.status_code != 200:
            raise InformaticsSubmitError(
                f"submit failed: HTTP {response.status_code} {body[:200]}"
            )
        if "duplicate" in body.lower():
            return SubmitResult(run_id=None, duplicate=True, raw={})

        try:
            payload = response.json()
        except ValueError as exc:
            raise InformaticsSubmitError(
                f"submit returned non-JSON: {body[:200]}"
            ) from exc

        data = payload.get("data") if isinstance(payload, dict) else None
        run_id = data.get("run_id") if isinstance(data, dict) else None
        if payload.get("status") != "success" or not run_id:
            raise InformaticsSubmitError(f"submit rejected: {body[:300]}")
        return SubmitResult(run_id=int(run_id), duplicate=False, raw=payload)

    async def get_run(
        self,
        problem_id: int,
        informatics_user_id: int,
        run_id: int | None = None,
    ) -> dict[str, Any] | None:
        response = await self._client.get(
            f"/py/problem/{int(problem_id)}/filter-runs",
            params={
                "problem_id": int(problem_id),
                "from_timestamp": -1,
                "to_timestamp": -1,
                "user_id": int(informatics_user_id),
                "lang_id": -1,
                "status_id": -1,
                "statement_id": 0,
                "count": 10,
                "with_comment": "",
                "page": 1,
            },
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError:
            return None

        raw = payload.get("data") if isinstance(payload, dict) else payload
        if isinstance(raw, dict):
            raw = raw.get("runs") or raw.get("data") or []
        if not isinstance(raw, list) or not raw:
            return None
        runs = [run for run in raw if isinstance(run, dict)]
        if not runs:
            return None
        if run_id is None:
            return runs[0]
        for run in runs:
            try:
                if int(run.get("id")) == int(run_id):
                    return run
            except (TypeError, ValueError):
                continue
        return None

    async def get_source(self, run_id: int) -> str:
        response = await self._client.get(
            f"/py/problem/run/{int(run_id)}/source",
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError:
            return ""
        data = payload.get("data") if isinstance(payload, dict) else None
        return str(data.get("source") or "") if isinstance(data, dict) else ""

    async def get_problem(self, problem_id: int) -> dict[str, Any]:
        response = await self._client.get(f"/py/problem/{int(problem_id)}/json")
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise InformaticsError("problem payload is not an object")

        languages = data.get("languages") or []
        if isinstance(languages, dict):
            languages = languages.get("languages") or []
        normalized_languages = []
        for item in languages if isinstance(languages, list) else []:
            if not isinstance(item, dict):
                continue
            try:
                normalized_languages.append(
                    {"id": int(item.get("id")), "name": str(item.get("name") or "")}
                )
            except (TypeError, ValueError):
                continue

        time_limit = data.get("time_limit")
        try:
            time_limit_ms = int(float(time_limit) * 1000) if time_limit else 0
        except (TypeError, ValueError):
            time_limit_ms = 0

        return {
            "problem_id": int(problem_id),
            "title": str(data.get("title") or data.get("name") or ""),
            "statement_md": str(data.get("statement") or ""),
            "languages": normalized_languages,
            "time_limit_ms": time_limit_ms,
            "memory_limit_kb": int(data.get("memory_limit") or 0),
            "raw": data,
        }

    async def get_problem_languages(self, problem_id: int) -> list[dict[str, Any]]:
        problem = await self.get_problem(problem_id)
        return list(problem.get("languages") or [])
