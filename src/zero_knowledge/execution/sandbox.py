"""Docker-песочница для изолированного запуска произвольного кода (ZEROK-3).

Код исполняется в отдельном контейнере с жёсткими ограничениями:

- процесс не root (``--user 10001:10001``);
- нет сети (``--network none``);
- корневая файловая система и рабочая директория только на чтение
  (``--read-only`` + read-only bind mount), писать можно лишь в отдельный
  ``tmpfs`` каталог ``/tmp``;
- сброшены все capabilities и запрещено их повышение
  (``--cap-drop ALL``, ``--security-opt no-new-privileges``);
- лимиты памяти, CPU и числа процессов;
- таймаут исполнения на стороне хоста; по истечении контейнер
  принудительно останавливается.

Таймаут здесь — дополнение, а не основная защита: изоляцию обеспечивают
сами ограничения контейнера, а таймаут лишь добивает зависший или слишком
долгий код.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import uuid

from .result import CodeExecutionResult

DEFAULT_IMAGE = "zero-knowledge/sandbox:latest"
DEFAULT_MEMORY = "128m"
DEFAULT_CPUS = 1.0
DEFAULT_PIDS_LIMIT = 64
DEFAULT_TMPFS_SIZE = "16m"
DEFAULT_TIMEOUT = 10.0
DEFAULT_NETWORK = "none"
DEFAULT_USER = "10001:10001"

_MAX_STDOUT_BYTES = 256 * 1024
_MAX_STDERR_BYTES = 256 * 1024

_INFRASTRUCTURE_EXIT_CODES = {125, 126, 127}
_INFRASTRUCTURE_MARKERS = (
    "cannot connect",
    "is the docker daemon running",
    "no such image",
    "pull access denied",
    "error response from daemon",
    "permission denied while trying to connect",
    "docker: ",
)


class SandboxUnavailableError(Exception):
    """Песочница недоступна (нет docker, демон не запущен, образ отсутствует)."""


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


class DockerSandbox:
    """Запуск произвольного кода в изолированном Docker-контейнере.

    Один и тот же механизм обслуживает два сценария: исполнение кода
    студента и прогон эталонных решений с тестами (ZEROK-4).
    """

    def __init__(
        self,
        *,
        image: str | None = None,
        memory: str | None = None,
        cpus: float | None = None,
        pids_limit: int | None = None,
        tmpfs_size: str | None = None,
        timeout: float | None = None,
        network: str | None = None,
        user: str | None = None,
    ) -> None:
        self._image = image or os.environ.get("ZK_SANDBOX_IMAGE", DEFAULT_IMAGE)
        self._memory = memory or os.environ.get("ZK_SANDBOX_MEMORY", DEFAULT_MEMORY)
        self._cpus = (
            cpus if cpus is not None else _env_float("ZK_SANDBOX_CPUS", DEFAULT_CPUS)
        )
        self._pids_limit = (
            pids_limit
            if pids_limit is not None
            else _env_int("ZK_SANDBOX_PIDS_LIMIT", DEFAULT_PIDS_LIMIT)
        )
        self._tmpfs_size = tmpfs_size or os.environ.get(
            "ZK_SANDBOX_TMPFS_SIZE", DEFAULT_TMPFS_SIZE
        )
        self._timeout = (
            timeout
            if timeout is not None
            else _env_float("ZK_SANDBOX_TIMEOUT", DEFAULT_TIMEOUT)
        )
        self._network = network or os.environ.get("ZK_SANDBOX_NETWORK", DEFAULT_NETWORK)
        self._user = user or os.environ.get("ZK_SANDBOX_USER", DEFAULT_USER)

    @property
    def image(self) -> str:
        return self._image

    def execute(
        self,
        source: str,
        *,
        input_data: str = "",
        timeout: float | None = None,
        memory: str | None = None,
        cpus: float | None = None,
        pids_limit: int | None = None,
    ) -> CodeExecutionResult:
        """Выполнить ``source`` как Python-программу и вернуть результат.

        ``input_data`` подаётся программе на стандартный ввод. Инфраструктурные
        сбои (нет docker, демон недоступен, образ не найден) поднимают
        :class:`SandboxUnavailableError`; всё, что происходит внутри
        контейнера, возвращается как :class:`CodeExecutionResult`.
        """

        workdir = tempfile.mkdtemp(prefix="zk-sandbox-")
        container_name = f"zk-sandbox-{uuid.uuid4().hex[:12]}"
        main_path = os.path.join(workdir, "main.py")
        try:
            with open(main_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(source)
            os.chmod(main_path, 0o644)
            os.chmod(workdir, 0o755)

            command = self._build_command(
                container_name, workdir, memory, cpus, pids_limit
            )
            effective_timeout = timeout if timeout is not None else self._timeout

            started = time.monotonic()
            try:
                process = subprocess.Popen(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                stdout_bytes, stderr_bytes = process.communicate(
                    input=input_data.encode("utf-8"),
                    timeout=effective_timeout,
                )
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                self._force_remove(container_name)
                return CodeExecutionResult(
                    exit_code=None,
                    stdout="",
                    stderr="",
                    timed_out=True,
                    duration_ms=(time.monotonic() - started) * 1000,
                )
            except FileNotFoundError as error:
                raise SandboxUnavailableError(
                    "docker CLI is not available on PATH"
                ) from error
            except OSError as error:
                raise SandboxUnavailableError(
                    f"failed to start docker container: {error}"
                ) from error

            duration_ms = (time.monotonic() - started) * 1000
            exit_code = process.returncode
            stdout = stdout_bytes.decode("utf-8", errors="replace")[:_MAX_STDOUT_BYTES]
            stderr = stderr_bytes.decode("utf-8", errors="replace")[:_MAX_STDERR_BYTES]

            if self._is_infrastructure_failure(exit_code, stderr):
                raise SandboxUnavailableError(
                    f"docker run failed (exit {exit_code}): {stderr[:400]}"
                )

            return CodeExecutionResult(
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                timed_out=False,
                duration_ms=duration_ms,
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _build_command(
        self,
        container_name: str,
        workdir: str,
        memory: str | None,
        cpus: float | None,
        pids_limit: int | None,
    ) -> list[str]:
        effective_memory = memory or self._memory
        return [
            "docker",
            "run",
            "--rm",
            "--interactive",
            "--name",
            container_name,
            "--network",
            self._network,
            "--read-only",
            "--tmpfs",
            f"/tmp:rw,noexec,nosuid,size={self._tmpfs_size}",
            "--memory",
            effective_memory,
            "--memory-swap",
            effective_memory,
            "--cpus",
            str(cpus if cpus is not None else self._cpus),
            "--pids-limit",
            str(pids_limit if pids_limit is not None else self._pids_limit),
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--env",
            "PYTHONDONTWRITEBYTECODE=1",
            "--env",
            "PYTHONUNBUFFERED=1",
            "--env",
            "HOME=/tmp",
            "--user",
            self._user,
            "--volume",
            f"{workdir}:/work:ro",
            "--workdir",
            "/work",
            self._image,
            "python",
            "/work/main.py",
        ]

    def _force_remove(self, container_name: str) -> None:
        try:
            subprocess.run(
                ["docker", "rm", "-f", container_name],
                capture_output=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return

    @staticmethod
    def _is_infrastructure_failure(exit_code: int | None, stderr: str) -> bool:
        if exit_code in _INFRASTRUCTURE_EXIT_CODES:
            return True
        lowered = stderr.lower()
        return any(marker in lowered for marker in _INFRASTRUCTURE_MARKERS)
