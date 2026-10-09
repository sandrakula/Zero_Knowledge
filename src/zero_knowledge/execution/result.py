"""Результат одного изолированного запуска кода (ZEROK-3)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CodeExecutionResult:
    """Исход одного запуска произвольного кода в песочнице.

    ``exit_code`` равен ``None``, когда процесс был остановлен по таймауту и
    итоговый код завершения недоступен. ``timed_out`` при этом ``True``.
    """

    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: float
