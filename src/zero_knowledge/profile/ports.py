"""Граница интеграции для LLM-текста профиля и roadmap (ZEROK-1)."""

from __future__ import annotations

from typing import Protocol


class ExplanationProvider(Protocol):
    """Провайдер, возвращающий поясняющий текст как JSON-строку.

    Реализации переводят transport/auth/timeout ошибки в
    :class:`ProviderUnavailableError`; ``DeepSeekClient`` удовлетворяет
    протоколу напрямую.
    """

    def generate(self, prompt: str) -> str: ...
