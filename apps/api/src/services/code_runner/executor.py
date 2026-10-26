"""Docker-backed code execution.

Each submission runs in a fresh container with no network, a hard memory cap,
a CPU quota, a pid limit and dropped capabilities. The contract mirrors Judge0's
``POST /submissions`` response so the existing API (``code_execution.py`` and the
CODE grading path) needs no changes.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile

from .languages import get_language

logger = logging.getLogger("code_runner")

# Safety envelope for resource limits (independent of what the caller sends).
DEFAULT_CPU_SECONDS = 5.0
DEFAULT_MEMORY_KB = 128 * 1024
MAX_CPU_SECONDS = 15.0
MAX_MEMORY_KB = 512 * 1024
MAX_WALL_SECONDS = 60.0
MAX_OUTPUT_CHARS = 128 * 1024  # cap captured stdout/stderr before truncation
COMPILE_MEMORY_MB = 1024  # compilers need far more memory than the running program


class ExecutionError(Exception):
    """The sandbox itself failed (docker missing, image pull, daemon down)."""


def _clamp_cpu(cpu: float | None) -> float:
    if cpu is None:
        return DEFAULT_CPU_SECONDS
    return min(max(0.1, float(cpu)), MAX_CPU_SECONDS)


def _clamp_memory(memory_kb: int | None) -> int:
    if memory_kb is None:
        return DEFAULT_MEMORY_KB
    return min(max(16, int(memory_kb)), MAX_MEMORY_KB)


def _clamp_wall(cpu: float, wall: float | None) -> float:
    # Judge0 semantics: wall time defaults to a multiple of the CPU budget.
    default = min(cpu * 3.0 + 2.0, MAX_WALL_SECONDS)
    if wall is None:
        return default
    return min(max(1.0, float(wall)), MAX_WALL_SECONDS)


def _extract_additional_files(encoded: str, workdir: str) -> None:
    """Decode Judge0's base64-zip ``additional_files`` into the workdir."""
    if not encoded:
        return
    try:
        data = base64.b64decode(encoded)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(workdir)
    except Exception as exc:  # noqa: BLE001 - malformed input is a user error
        raise ExecutionError(f"invalid additional_files: {exc}") from exc


def _truncate(text: str | None, limit: int = MAX_OUTPUT_CHARS) -> str | None:
    if text is None:
        return None
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[truncated {len(text) - limit} chars]"


def _docker_base(workdir: str, cpu: float, mem_kb: int, wall: float) -> list[str]:
    mem_mb = max(8, mem_kb // 1024)
    return [
        "docker", "run", "--rm",
        "-i",  # keep stdin open for the program
        "-w", "/work",
        "-v", f"{workdir}:/work:rw",
        "--network", "none",
        "--memory", f"{mem_mb}m",
        "--memory-swap", f"{mem_mb}m",
        "--cpus", f"{cpu:.2f}",
        "--pids-limit", "256",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m",
        "--stop-timeout", "1",
    ]


def _run_container(args: list[str], stdin_data: bytes, timeout: float) -> subprocess.CompletedProcess:
    """Run docker with a Python-side backstop timeout (wall + 15s)."""
    try:
        return subprocess.run(
            args,
            input=stdin_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout + 15.0,
        )
    except FileNotFoundError as exc:
        raise ExecutionError("docker executable not found") from exc
    except subprocess.TimeoutExpired as exc:
        raise ExecutionError("docker run timed out") from exc


def _exit_to_status(exit_code: int) -> tuple[int, str]:
    """Map a container exit code to a Judge0 status id + description."""
    if exit_code == 0:
        return 3, "Accepted"
    if exit_code == 124:  # `timeout` sent TERM then KILL
        return 5, "Time Limit Exceeded"
    if exit_code == 137:  # SIGKILL: Docker OOM-kill in this setup
        return 5, "Memory Limit Exceeded"
    if exit_code == 139:  # 128 + SIGSEGV
        return 7, "Runtime Error (SIGSEGV)"
    if exit_code == 136:  # 128 + SIGFPE
        return 9, "Runtime Error (SIGFPE)"
    if exit_code == 134:  # 128 + SIGABRT
        return 10, "Runtime Error (SIGABRT)"
    return 11, "Runtime Error (NZEC)"


def execute(
    language_id: int,
    source_code: str,
    stdin: str = "",
    cpu_time_limit: float | None = None,
    memory_limit: int | None = None,
    wall_time_limit: float | None = None,
    additional_files: str | None = None,
) -> dict:
    """Execute a submission and return a Judge0-shaped result dict."""
    lang = get_language(language_id)
    if lang is None:
        return {
            "stdout": None,
            "stderr": None,
            "compile_output": None,
            "message": f"Language {language_id} is not supported by this runner",
            "time": "0.000",
            "memory": 0,
            "status": {"id": 14, "description": "Exec Format Error"},
            "language": {"id": language_id, "name": "Unknown"},
        }

    cpu = _clamp_cpu(cpu_time_limit)
    mem_kb = _clamp_memory(memory_limit)
    wall = _clamp_wall(cpu, wall_time_limit)

    workdir = tempfile.mkdtemp(prefix="coderun_")
    try:
        source_path = os.path.join(workdir, lang.filename)
        with open(source_path, "w", encoding="utf-8") as fh:
            fh.write(source_code)
        if additional_files:
            _extract_additional_files(additional_files, workdir)

        stdin_bytes = (stdin or "").encode("utf-8", errors="replace")

        compile_output = None
        if lang.compile_cmd:
            cmd = ["docker", "run", "--rm", "-w", "/work",
                   "-v", f"{workdir}:/work:rw", "--network", "none",
                   "--memory", f"{COMPILE_MEMORY_MB}m",
                   "--pids-limit", "256", "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges",
                   lang.image, "sh", "-c", lang.compile_cmd]
            comp = _run_container(cmd, b"", wall + 15.0)
            if comp.returncode != 0:
                compile_output = _truncate(
                    (comp.stderr or b"").decode("utf-8", errors="replace").strip()
                ) or "compilation failed"
                return {
                    "stdout": None,
                    "stderr": None,
                    "compile_output": compile_output,
                    "message": None,
                    "time": "0.000",
                    "memory": 0,
                    "status": {"id": 6, "description": "Compilation Error"},
                    "language": {"id": lang.id, "name": lang.name},
                }

        # Run step: wrap in the image's own `timeout` so wall-limit kills are
        # deterministic (exit 124), with Docker/Python timeouts as backstops.
        run_cmd = f"timeout {wall:.0f}s sh -c '{lang.run_cmd}'"
        cmd = _docker_base(workdir, cpu, mem_kb, wall) + [lang.image, "sh", "-c", run_cmd]
        started = time.monotonic()
        proc = _run_container(cmd, stdin_bytes, wall)
        elapsed = time.monotonic() - started

        stdout = _truncate(proc.stdout.decode("utf-8", errors="replace")) if proc.stdout else None
        stderr = _truncate(proc.stderr.decode("utf-8", errors="replace")) if proc.stderr else None
        status_id, status_desc = _exit_to_status(proc.returncode)

        return {
            "stdout": stdout,
            "stderr": stderr,
            "compile_output": None,
            "message": None,
            "time": f"{elapsed:.3f}",
            "memory": mem_kb if status_desc == "Memory Limit Exceeded" else 0,
            "status": {"id": status_id, "description": status_desc},
            "language": {"id": lang.id, "name": lang.name},
        }
    except ExecutionError as exc:
        return {
            "stdout": None,
            "stderr": None,
            "compile_output": None,
            "message": str(exc),
            "time": "0.000",
            "memory": 0,
            "status": {"id": 13, "description": "Internal Error"},
            "language": {"id": lang.id, "name": lang.name},
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _token() -> str:
    return str(uuid.uuid4())
