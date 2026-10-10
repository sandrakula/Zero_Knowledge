"""Typed failures exposed by the solution review service."""

from __future__ import annotations


class SolutionReviewError(Exception):
    """Base class for expected solution review failures."""


class QuestionsInvalidError(SolutionReviewError):
    """The provider response cannot be parsed as valid solution questions."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class SolutionReviewAttemptsExhaustedError(SolutionReviewError):
    """All configured question-generation attempts produced content failures."""

    def __init__(self, attempts: int, last_error: QuestionsInvalidError) -> None:
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(
            f"question generation failed after {attempts} attempts: {last_error}"
        )
