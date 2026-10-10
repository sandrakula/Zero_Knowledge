"""Явный неисполняющий провайдер до подключения реального."""

from __future__ import annotations

from zero_knowledge.task_generation.errors import ProviderUnavailableError


class UnavailableSolutionQuestionProvider:
    """Чётко сообщает, что генератор вопросов не настроен, вместо имитации."""

    def generate(self, prompt: str) -> str:
        del prompt
        raise ProviderUnavailableError(
            "solution question provider is not configured"
        )
