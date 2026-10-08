"""Typed failures exposed by the ZEROK-4 service."""

from __future__ import annotations


class Zerok4Error(Exception):
    """Base class for expected ZEROK-4 failures."""


class GeneratedBlockInvalidError(Zerok4Error):
    """The provider response cannot be parsed as a valid task block."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class ReferenceSolutionFailedError(Zerok4Error):
    """A real isolated run showed that a reference solution fails its tests."""

    def __init__(
        self, task_id: str, reason: str = "reference solution failed generated tests"
    ) -> None:
        self.task_id = task_id
        self.reason = reason
        super().__init__(f"task {task_id}: {reason}")


class ProviderUnavailableError(Zerok4Error):
    """The ZEROK-1/AI provider cannot generate a response."""


class IsolatedExecutionUnavailableError(Zerok4Error):
    """The real ZEROK-3 isolated execution service is unavailable."""


class ReferenceNotExecutedError(IsolatedExecutionUnavailableError):
    """Validation stopped because only a non-executing stub is configured."""


class AttemptsExhaustedError(Zerok4Error):
    """All configured generation attempts produced content failures."""

    def __init__(
        self,
        attempts: int,
        last_error: GeneratedBlockInvalidError | ReferenceSolutionFailedError,
    ) -> None:
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(f"generation failed after {attempts} attempts: {last_error}")
