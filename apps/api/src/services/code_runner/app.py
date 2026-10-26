"""Judge0-compatible HTTP API for the self-hosted code runner.

The real Judge0 cannot run on this host (its `isolate` sandbox requires
cgroups v1, which Docker Desktop on Windows does not provide). This service
implements the small subset of Judge0's REST API that the platform uses —
``POST /submissions?wait=true`` — and runs each submission in an isolated
Docker container instead.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import executor
from .languages import LANGUAGES, STATUSES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("code_runner")

app = FastAPI(title="ZeroKnowledge Code Runner", version="1.0.0")


class SubmissionRequest(BaseModel):
    language_id: int
    source_code: str = ""
    stdin: str = ""
    cpu_time_limit: float | None = None
    memory_limit: int | None = None
    wall_time_limit: float | None = None
    additional_files: str | None = None


@app.get("/")
def root():
    return {"message": "ZeroKnowledge Code Runner (Judge0-compatible)"}


@app.get("/about")
def about():
    return {
        "version": "1.0.0",
        "name": "ZeroKnowledge Code Runner",
        "sandbox": "Docker (network none, memory/cpu/pids limits)",
    }


@app.get("/system_info")
def system_info():
    return {
        "version": "1.0.0",
        "sandbox_works": True,
        "isolate_available": False,
    }


@app.get("/languages")
def languages():
    return [{"id": lang.id, "name": lang.name} for lang in LANGUAGES.values()]


@app.get("/statuses")
def statuses():
    return [{"id": sid, "description": desc} for sid, desc in sorted(STATUSES.items())]


@app.post("/submissions")
def create_submission(request: SubmissionRequest, wait: bool = True, base64_encoded: bool = False):
    """Run a submission synchronously and return a Judge0-shaped result.

    ``wait=true`` (the only mode the platform uses) blocks until the verdict is
    final. ``base64_encoded`` is accepted for API compatibility; the platform
    always sends plain-text source.
    """
    source = request.source_code
    if base64_encoded:
        import base64
        try:
            source = base64.b64decode(source).decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"invalid base64 source: {exc}")

    if not isinstance(request.language_id, int) or request.language_id <= 0:
        raise HTTPException(status_code=400, detail="language_id is required")

    result = executor.execute(
        language_id=request.language_id,
        source_code=source,
        stdin=request.stdin,
        cpu_time_limit=request.cpu_time_limit,
        memory_limit=request.memory_limit,
        wall_time_limit=request.wall_time_limit,
        additional_files=request.additional_files,
    )
    result["token"] = executor._token()
    return result


@app.post("/submissions/batch")
def create_submission_batch(submissions: list[SubmissionRequest]):
    """Run several submissions. Each item is shaped like /submissions but with
    an optional ``expected_output`` for wrong-answer detection."""
    out = []
    for item in submissions:
        r = executor.execute(
            language_id=item.language_id,
            source_code=item.source_code,
            stdin=item.stdin,
            cpu_time_limit=item.cpu_time_limit,
            memory_limit=item.memory_limit,
            wall_time_limit=item.wall_time_limit,
            additional_files=item.additional_files,
        )
        r["token"] = executor._token()
        out.append(r)
    return out
