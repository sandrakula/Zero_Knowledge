"""Типизированные ошибки модуля профиля и roadmap (ZEROK-6)."""

from __future__ import annotations


class ProfileError(Exception):
    """База ожидаемых ошибок ZEROK-6."""


class ExplanationInvalidError(ProfileError):
    """Ответ провайдера нельзя разобрать как корректный поясняющий текст."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class ProfileAttemptsExhaustedError(ProfileError):
    """Все попытки генерации поясняющего текста дали содержательные ошибки."""

    def __init__(self, attempts: int, last_error: ExplanationInvalidError) -> None:
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(
            f"explanation generation failed after {attempts} attempts: {last_error}"
        )
