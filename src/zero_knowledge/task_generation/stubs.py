"""Explicit non-operational adapters for unconfigured/preview scenarios."""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import ReferenceSolution, Task, TestCase

from .errors import ProviderUnavailableError, ReferenceNotExecutedError


class UnavailableTaskGenerationProvider:
    """Fail clearly instead of pretending that a real AI provider exists."""

    def generate(self, prompt: str) -> str:
        del prompt
        raise ProviderUnavailableError(
            "ZEROK-1 task generation provider is not configured"
        )


class UnavailableExecutionRunner:
    """Never executes generated code and never reports it as verified."""

    def verify_reference(
        self,
        task: Task,
        solution: ReferenceSolution,
        tests: Sequence[TestCase],
    ) -> None:
        del task, solution, tests
        raise ReferenceNotExecutedError(
            "ZEROK-3 isolated runner is not configured; reference code was not executed"
        )
