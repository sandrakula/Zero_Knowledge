"""Small integration boundaries for work owned by ZEROK-1 and ZEROK-3."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from zero_knowledge.schemas import ReferenceSolution, Task, TestCase


class TaskGenerationProvider(Protocol):
    """Adapter for ZEROK-1.

    Implementations return the provider's structured response as JSON text and
    translate transport/authentication/time-out failures to
    :class:`ProviderUnavailableError`.
    """

    def generate(self, prompt: str) -> str: ...


class IsolatedExecutionRunner(Protocol):
    """Adapter for ZEROK-3.

    A successful return means that *real isolated execution* ran ``solution``
    against every supplied test. Implementations raise
    ``ReferenceSolutionFailedError`` for a content failure and
    ``IsolatedExecutionUnavailableError`` for infrastructure failures.
    """

    def verify_reference(
        self,
        task: Task,
        solution: ReferenceSolution,
        tests: Sequence[TestCase],
    ) -> None: ...
