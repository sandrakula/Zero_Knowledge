"""ZEROK-3: реальный прогон эталонных решений в изолированной песочнице."""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import ReferenceSolution, Task, TestCase
from zero_knowledge.task_generation.errors import (
    IsolatedExecutionUnavailableError,
    ReferenceSolutionFailedError,
)

from .result import CodeExecutionResult
from .sandbox import DockerSandbox, SandboxUnavailableError


def _normalize_output(value: str) -> str:
    """Нормализовать вывод для сравнения: CRLF→LF и срезать хвостовые пробелы.

    Это сознательное допущение для PoC: судья не наказывает за лишние
    завершающие переводы строк/пробелы, но любые содержательные отличия
    внутри вывода считаются ошибкой.
    """

    return value.replace("\r\n", "\n").replace("\r", "\n").rstrip(" \t\n")


def _short(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


class DockerIsolatedExecutionRunner:
    """Реализация границы ``IsolatedExecutionRunner`` из ZEROK-4.

    Успешный возврат ``verify_reference`` означает, что эталонный код был
    реально исполнен в изоляции и прошёл все переданные тест-кейсы.
    Содержательные неудачи поднимают ``ReferenceSolutionFailedError``,
    недоступность песочницы — ``IsolatedExecutionUnavailableError``.
    """

    def __init__(self, sandbox: DockerSandbox | None = None) -> None:
        self._sandbox = sandbox or DockerSandbox()

    def verify_reference(
        self,
        task: Task,
        solution: ReferenceSolution,
        tests: Sequence[TestCase],
    ) -> None:
        if not solution.code or not solution.code.strip():
            raise ReferenceSolutionFailedError(
                str(task.id), "reference solution has no executable code"
            )

        for case in tests:
            result = self._run_case(solution.code, case)

            if result.timed_out:
                raise ReferenceSolutionFailedError(
                    str(task.id), f"reference timed out on test {case.id}"
                )
            if result.exit_code != 0:
                raise ReferenceSolutionFailedError(
                    str(task.id),
                    f"reference exited with code {result.exit_code} on test "
                    f"{case.id}: {_short(result.stderr)}",
                )
            if _normalize_output(result.stdout) != _normalize_output(
                case.expected_output
            ):
                raise ReferenceSolutionFailedError(
                    str(task.id), f"output mismatch on test {case.id}"
                )

    def _run_case(self, code: str, case: TestCase) -> CodeExecutionResult:
        try:
            return self._sandbox.execute(
                code,
                input_data=case.input_data,
                timeout=(case.timeout_ms / 1000.0) if case.timeout_ms else None,
                memory=(f"{case.memory_mb}m") if case.memory_mb else None,
            )
        except SandboxUnavailableError as error:
            raise IsolatedExecutionUnavailableError(str(error)) from error
