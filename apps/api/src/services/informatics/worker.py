"""Background worker for server-side Informatics submissions.

The worker is the only component that calls Informatics. It claims one attempt
at a time, keeps a short-lived in-memory login session per user, polls
``filter-runs`` with backoff, finalizes the verdict and credits the course task.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta

import httpx

from src.db.informatics import InformaticsProblem, InformaticsSubmission
from src.services.informatics import submissions
from src.services.informatics.client import (
    InformaticsAuthError,
    InformaticsClient,
    InformaticsError,
    InformaticsSubmitError,
)
from src.services.informatics.credit import credit_accepted_submission
from src.services.informatics.crypto import decrypt_secret
from src.services.informatics.ingest import get_account
from src.services.informatics.languages import (
    extension_for,
    is_supported_by_problem,
)
from src.services.informatics.verdicts import is_in_progress

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 10 * 60
POLL_TIMEOUT_SECONDS = 10 * 60
PROBLEM_CACHE_SECONDS = 24 * 60 * 60


class InformaticsWorker:
    def __init__(self, session_factory, *, worker_id: str | None = None) -> None:
        self._session_factory = session_factory
        self.worker_id = (worker_id or f"informatics-{uuid.uuid4()}")[:128]
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._sessions: dict[int, tuple[InformaticsClient, datetime]] = {}

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stopping = False
        self._task = asyncio.create_task(self._run(), name="informatics-worker")
        logger.info("Informatics worker started (%s)", self.worker_id)

    async def stop(self) -> None:
        self._stopping = True
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        for _user_id, (client, _expires) in list(self._sessions.items()):
            try:
                await client.close()
            except Exception:
                pass
        self._sessions.clear()
        logger.info("Informatics worker stopped")

    async def _run(self) -> None:
        while not self._stopping:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Informatics worker tick failed")
            await asyncio.sleep(1.0)

    async def run_once(self) -> None:
        async with self._session_factory() as db:
            await submissions.recover_expired_leases(db)
            row = await submissions.claim_next(db, self.worker_id)
            if row is not None:
                try:
                    await self._process_new(db, row)
                except Exception as exc:  # keep the worker alive
                    logger.exception("Informatics submission %s failed", row.submission_uuid)
                    await submissions.fail_or_retry(db, row, str(exc))
                return

            running = await submissions.claim_running(db, self.worker_id)
            if running is not None:
                try:
                    await self._process_running(db, running)
                except Exception as exc:
                    logger.exception(
                        "Informatics poll %s failed", running.submission_uuid
                    )
                    await submissions.fail_or_retry(db, running, str(exc))
                return

            await self._evict_sessions()

    # ── session cache ───────────────────────────────────────────────────────

    async def _client_for(self, account, *, force: bool = False) -> InformaticsClient:
        user_id = int(account.user_id)
        cached = self._sessions.get(user_id)
        now = datetime.now()
        if cached and not force and cached[1] > now:
            return cached[0]
        if cached:
            try:
                await cached[0].close()
            except Exception:
                pass
            self._sessions.pop(user_id, None)

        password = decrypt_secret(account.password_encrypted)
        session = (
            decrypt_secret(account.session_encrypted)
            if account.session_encrypted
            else ""
        )
        if not password and not session:
            raise InformaticsAuthError(
                "Stored Informatics credentials are unavailable"
            )
        client = InformaticsClient()
        if session:
            try:
                await client.use_session(session)
            except InformaticsAuthError:
                if not password:
                    raise
                await client.login(account.username, password)
        else:
            await client.login(account.username, password)
        self._sessions[user_id] = (
            client,
            now + timedelta(seconds=SESSION_TTL_SECONDS),
        )
        return client

    async def _drop_client(self, user_id: int) -> None:
        cached = self._sessions.pop(int(user_id), None)
        if cached:
            try:
                await cached[0].close()
            except Exception:
                pass

    async def _evict_sessions(self) -> None:
        now = datetime.now()
        for user_id, (client, expires) in list(self._sessions.items()):
            if expires <= now:
                try:
                    await client.close()
                except Exception:
                    pass
                self._sessions.pop(user_id, None)

    # ── problem cache ───────────────────────────────────────────────────────

    async def _ensure_problem(
        self, db, client: InformaticsClient, problem_id: int
    ) -> InformaticsProblem:
        problem = await db.get(InformaticsProblem, int(problem_id))
        now = datetime.now()
        if problem is not None and problem.fetched_at:
            try:
                fetched = datetime.fromisoformat(problem.fetched_at)
                if (now - fetched).total_seconds() < PROBLEM_CACHE_SECONDS:
                    return problem
            except ValueError:
                pass

        data = await client.get_problem(problem_id)
        if problem is None:
            problem = InformaticsProblem(problem_id=int(problem_id))
        problem.title = data.get("title") or problem.title
        problem.statement_md = data.get("statement_md") or problem.statement_md
        problem.languages = data.get("languages") or problem.languages
        problem.time_limit_ms = data.get("time_limit_ms") or problem.time_limit_ms
        problem.memory_limit_kb = (
            data.get("memory_limit_kb") or problem.memory_limit_kb
        )
        problem.raw = data.get("raw") or problem.raw
        problem.fetched_at = now.isoformat()
        db.add(problem)
        await db.commit()
        await db.refresh(problem)
        return problem

    # ── lifecycle ───────────────────────────────────────────────────────────

    async def _process_new(self, db, row: InformaticsSubmission) -> None:
        account = await get_account(db, int(row.user_id))
        if account is None or not account.password_encrypted:
            await submissions.fail_or_retry(
                db, row, "Informatics account is not linked", retryable=False
            )
            return

        try:
            client = await self._client_for(account)
        except InformaticsAuthError as exc:
            await submissions.fail_or_retry(db, row, str(exc), retryable=False)
            return

        problem = await self._ensure_problem(db, client, row.problem_id)
        if not is_supported_by_problem(row.language_our_id, problem.languages):
            await submissions.fail_or_retry(
                db,
                row,
                "This problem does not support the selected language",
                retryable=False,
            )
            return

        extension = extension_for(row.language_our_id) or "txt"
        try:
            result = await client.submit(
                row.problem_id,
                row.language_informatics_id,
                row.source_code,
                extension,
            )
        except InformaticsSubmitError as exc:
            await submissions.fail_or_retry(db, row, str(exc), retryable=True)
            return
        except (httpx.HTTPError, InformaticsError) as exc:
            await self._drop_client(int(row.user_id))
            await submissions.fail_or_retry(db, row, str(exc), retryable=True)
            return

        if result.duplicate:
            run = await client.get_run(
                row.problem_id, account.informatics_user_id, None
            )
            if run is None:
                await submissions.fail_or_retry(
                    db,
                    row,
                    "Informatics reported a duplicate but no run was found",
                    retryable=True,
                )
                return
            run_id = int(run.get("id") or 0)
            if not run_id:
                await submissions.fail_or_retry(
                    db, row, "Duplicate run has no id", retryable=True
                )
                return
            await submissions.mark_running(
                db, row, run_id, poll_delay=1, worker_id=self.worker_id
            )
            await self._finalize_if_done(db, row, run)
            return

        if not result.run_id:
            await submissions.fail_or_retry(
                db, row, "Informatics did not return a run id", retryable=True
            )
            return
        await submissions.mark_running(
            db, row, result.run_id, poll_delay=1, worker_id=self.worker_id
        )

    async def _process_running(self, db, row: InformaticsSubmission) -> None:
        account = await get_account(db, int(row.user_id))
        if account is None or not account.password_encrypted:
            await submissions.fail_or_retry(
                db, row, "Informatics account is no longer linked", retryable=False
            )
            return
        try:
            client = await self._client_for(account)
        except InformaticsAuthError as exc:
            await submissions.fail_or_retry(db, row, str(exc), retryable=False)
            return

        try:
            run = await client.get_run(
                row.problem_id, account.informatics_user_id, row.run_id
            )
        except (httpx.HTTPError, InformaticsError) as exc:
            await self._drop_client(int(row.user_id))
            await self._retry_or_timeout(db, row, str(exc))
            return

        if run is None:
            # A missing run can mean "not ready yet" or "the cached Moodle
            # session expired". Verify the session once and retry after a fresh
            # login; this is the single re-login the contract allows.
            session_ok = await client.verify_session()
            if not session_ok:
                await self._drop_client(int(row.user_id))
                try:
                    client = await self._client_for(account, force=True)
                    run = await client.get_run(
                        row.problem_id, account.informatics_user_id, row.run_id
                    )
                except (InformaticsAuthError, httpx.HTTPError, InformaticsError) as exc:
                    await self._retry_or_timeout(db, row, str(exc))
                    return

        if run is None:
            await self._retry_or_timeout(db, row, "Verdict is not available yet")
            return

        await self._finalize_if_done(db, row, run)

    async def _finalize_if_done(self, db, row: InformaticsSubmission, run: dict) -> None:
        ejudge_status = run.get("ejudge_status")
        try:
            status_int = int(ejudge_status) if ejudge_status is not None else None
        except (TypeError, ValueError):
            status_int = None

        if is_in_progress(status_int):
            await submissions.schedule_poll(
                db,
                row,
                submissions._poll_delay(int(row.attempt_count or 1)),
                worker_id=self.worker_id,
            )
            return

        finalized, solved = await submissions.finalize(db, row, run)
        if solved:
            try:
                await credit_accepted_submission(db, finalized)
            except Exception:
                logger.exception(
                    "Credit failed for Informatics submission %s",
                    finalized.submission_uuid,
                )


    async def _retry_or_timeout(self, db, row: InformaticsSubmission, error: str) -> None:
        try:
            created = datetime.fromisoformat(row.created_at)
            age = (datetime.now() - created).total_seconds()
        except ValueError:
            age = 0
        if age >= POLL_TIMEOUT_SECONDS:
            await submissions.fail_or_retry(
                db, row, f"TIMEOUT: {error}", retryable=False
            )
            return
        await submissions.schedule_poll(
            db,
            row,
            submissions._poll_delay(int(row.attempt_count or 1)),
            worker_id=self.worker_id,
        )


def worker_enabled() -> bool:
    if os.environ.get("TESTING") == "true":
        return False
    return os.environ.get("LEARNHOUSE_INFORMATICS_WORKER", "1") not in (
        "0",
        "false",
        "False",
    )


_worker: InformaticsWorker | None = None


def start_worker() -> InformaticsWorker | None:
    global _worker
    if not worker_enabled():
        return None
    if _worker is not None:
        return _worker
    from src.core.events.database import _async_session_factory

    _worker = InformaticsWorker(_async_session_factory)
    _worker.start()
    return _worker


async def stop_worker() -> None:
    global _worker
    if _worker is not None:
        await _worker.stop()
        _worker = None
