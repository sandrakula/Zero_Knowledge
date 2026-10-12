"""Typed content failures exposed by the ZEROK-6 service."""

from __future__ import annotations


class LearningPathError(Exception):
    """Base class for expected ZEROK-6 content failures."""


class LearningPathInvalidError(LearningPathError):
    """The provider response does not match the canonical schema."""


class LearningPathAttemptsExhaustedError(LearningPathError):
    """All bounded attempts returned invalid content."""

    def __init__(self, attempts: int, last_error: LearningPathInvalidError) -> None:
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(
            f"learning path generation failed after {attempts} attempts: {last_error}"
        )
