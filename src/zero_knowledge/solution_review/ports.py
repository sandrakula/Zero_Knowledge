"""Integration boundary for AI question generation (ZEROK-1)."""

from __future__ import annotations

from typing import Protocol


class SolutionQuestionProvider(Protocol):
    """Adapter that returns AI-generated questions about a solution as JSON text.

    Implementations return the provider's structured response as JSON text and
    translate transport/authentication/time-out failures to
    :class:`ProviderUnavailableError`.
    """

    def generate(self, prompt: str) -> str: ...
