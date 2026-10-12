"""Provider boundary used by ZEROK-6."""

from __future__ import annotations

from typing import Protocol


class LearningPathProvider(Protocol):
    """Return a structured provider response as JSON text."""

    def generate(self, prompt: str) -> str: ...
