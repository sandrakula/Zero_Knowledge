"""Схемы разбора решения и оценки понимания (SolutionReview)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import BaseSchema, Identified, Timestamped
from .enums import HintLevel, MasteryLevel, SolutionQuestionKind


class SolutionQuestion(BaseSchema):
    """Один диагностический вопрос к решению студента (п. 10 спецификации)."""

    order: int = Field(default=0, ge=0, description="Порядок вопроса в наборе")
    kind: SolutionQuestionKind = Field(..., description="Тип вопроса")
    text: str = Field(..., min_length=1, description="Текст вопроса")
    target: str = Field(default="", description="К чему относится вопрос (шаг/строка)")
    rationale: str = Field(default="", description="Зачем задан вопрос")


class SolutionQuestionnaire(BaseSchema):
    """Набор вопросов к одному решению студента."""

    answer_id: UUID = Field(..., description="Ответ/решение студента")
    questions: list[SolutionQuestion] = Field(
        default_factory=list, description="Вопросы студенту"
    )


class HintUsage(BaseSchema):
    """Факт использования одной подсказки и её уровень (п. 8, 25)."""

    hint_id: UUID = Field(..., description="Использованная подсказка")
    level: HintLevel = Field(..., description="Уровень подсказки")
    independence_penalty: float = Field(
        ..., ge=0.0, le=1.0, description="Штраф к самостоятельности (0..1)"
    )


class UnderstandingAssessment(BaseSchema):
    """Оценка понимания по одному решению (п. 25, 26 спецификации).

    Учитывает правильность ответа и факт/уровень использованных подсказок:
    корректный ответ с полными подсказками не равен самостоятельному
    владению материалом.
    """

    is_correct: bool | None = Field(..., description="Корректность ответа")
    independence: float = Field(..., ge=0.0, le=1.0, description="Самостоятельность (0..1)")
    understanding: MasteryLevel = Field(..., description="Итоговый уровень понимания")
    hints_used: list[HintUsage] = Field(
        default_factory=list, description="Использованные подсказки"
    )
    rationale: str = Field(default="", description="Объяснение оценки")


class SolutionReview(Identified, Timestamped):
    """Разбор одного решения: вопросы + оценка понимания (п. 10, 12, 25)."""

    answer_id: UUID = Field(..., description="Разобранный ответ")
    task_id: UUID = Field(..., description="Задача, к которой относится ответ")
    questions: list[SolutionQuestion] = Field(
        default_factory=list, description="Вопросы студенту"
    )
    assessment: UnderstandingAssessment = Field(..., description="Оценка понимания")
