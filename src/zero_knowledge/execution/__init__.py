"""ZEROK-3: изолированное исполнение кода в Docker-песочнице.

Публичный интерфейс:

- :class:`DockerSandbox` — низкоуровневый запуск произвольного кода
  (пользовательский код и эталоны ZEROK-4);
- :class:`DockerIsolatedExecutionRunner` — реализация границы
  ``IsolatedExecutionRunner`` из ZEROK-4 (``verify_reference``);
- :class:`CodeExecutionResult` — результат запуска;
- :class:`SandboxUnavailableError` — песочница недоступна (инфраструктура).
"""

from __future__ import annotations

from .result import CodeExecutionResult
from .runner import DockerIsolatedExecutionRunner
from .sandbox import DEFAULT_IMAGE, DockerSandbox, SandboxUnavailableError

__all__ = [
    "DEFAULT_IMAGE",
    "CodeExecutionResult",
    "DockerIsolatedExecutionRunner",
    "DockerSandbox",
    "SandboxUnavailableError",
]
