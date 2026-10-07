"""Схема эталонного решения (ReferenceSolution)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import BaseSchema, Identified, Timestamped


class SolutionStep(BaseSchema):
    """Отдельный шаг эталонного решения."""

    order: int = Field(..., ge=0, description="Порядковый номер шага")
    title: str = Field(..., min_length=1, description="Заголовок шага")
    explanation: str = Field(..., min_length=1, description="Объяснение шага")
    code: str | None = Field(default=None, description="Фрагмент кода шага, если применимо")


class ReferenceSolution(Identified, Timestamped):
    """Эталонное решение задачи (п. 11–12 спецификации).

    Используется для разбора после решения, анализа ошибок и обучения.
    Содержит подход, пошаговое решение, итоговый ответ и альтернативные
    подходы для сравнения.
    """

    task_id: UUID = Field(..., description="Задача, к которой относится решение")
    approach: str = Field(..., min_length=1, description="Краткое описание подхода/стратегии решения")
    steps: list[SolutionStep] = Field(default_factory=list, description="Пошаговое решение")
    final_answer: str = Field(..., min_length=1, description="Итоговый ответ/вывод")
    code: str | None = Field(default=None, description="Полный эталонный код (для программных задач)")
    complexity: str | None = Field(default=None, description="Алгоритмическая сложность, напр. «O(n log n)»")
    alternative_approaches: list[str] = Field(default_factory=list, description="Альтернативные подходы (п. 5, сравнение)")
    explanation: str = Field(default="", description="Дополнительное объяснение для разбора типичных ошибок")
