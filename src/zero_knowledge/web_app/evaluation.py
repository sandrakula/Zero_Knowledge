"""Student-code evaluation through the existing ZEROK-3 Docker sandbox."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from zero_knowledge.execution import CodeExecutionResult
from zero_knowledge.schemas import TestCase


class CodeSandbox(Protocol):
    def execute(
        self,
        source: str,
        *,
        input_data: str = "",
        timeout: float | None = None,
        memory: str | None = None,
        cpus: float | None = None,
        pids_limit: int | None = None,
    ) -> CodeExecutionResult: ...


@dataclass(frozen=True, slots=True)
class Evaluation:
    state: str
    kind: str
    details: str
    execution_log: str | None = None

    @property
    def passed(self) -> bool:
        return self.state == "passed"


def _normalize_output(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").rstrip(" \t\n")


class StudentSolutionEvaluator:
    """Run every hidden test without exposing input or expected output."""

    def __init__(self, sandbox: CodeSandbox) -> None:
        self._sandbox = sandbox

    def evaluate(self, code: str, tests: Sequence[TestCase]) -> Evaluation:
        if not tests:
            return Evaluation(
                state="infrastructure_error",
                kind="missing_tests",
                details="Для задачи не настроены проверочные тесты.",
            )

        for index, case in enumerate(tests, start=1):
            result = self._sandbox.execute(
                code,
                input_data=case.input_data,
                timeout=(case.timeout_ms / 1000.0) if case.timeout_ms else None,
                memory=(f"{case.memory_mb}m") if case.memory_mb else None,
            )

            if result.timed_out:
                return Evaluation(
                    state="failed",
                    kind="timeout",
                    details=f"Превышен лимит времени на тесте {index}.",
                )
            if result.exit_code != 0:
                kind = (
                    "syntax_error"
                    if "SyntaxError" in result.stderr
                    else "runtime_error"
                )
                label = (
                    "Синтаксическая ошибка"
                    if kind == "syntax_error"
                    else "Ошибка выполнения"
                )
                log = result.stderr.strip()[-2000:]
                return Evaluation(
                    state="failed",
                    kind=kind,
                    details=f"{label} на тесте {index}.",
                    execution_log=log or None,
                )
            if _normalize_output(result.stdout) != _normalize_output(
                case.expected_output
            ):
                return Evaluation(
                    state="failed",
                    kind="incorrect_output",
                    details=f"Ответ не прошёл скрытый тест {index}.",
                )

        return Evaluation(
            state="passed",
            kind="passed",
            details=f"Пройдено тестов: {len(tests)}.",
        )
