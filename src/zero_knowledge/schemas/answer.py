"""Схема ответа студента (Answer)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from .common import Identified, Timestamped
from .enums import AnswerFormat, AnswerStatus, ConfidenceLevel


class Answer(Identified, Timestamped):
    """Ответ студента на задачу (п. 11, 19 спецификации).

    Фиксирует не только содержание ответа, но и процесс решения: номер
    попытки, использованные подсказки и самооценку уверенности. Эти данные
    нужны для оценки самостоятельности и калибровки самооценки.
    """

    task_id: UUID = Field(..., description="Задача, на которую дан ответ")
    student_id: UUID = Field(..., description="Идентификатор студента")
    attempt_number: int = Field(default=1, ge=1, description="Номер попытки")

    format: AnswerFormat = Field(..., description="Формат ответа")
    content: str = Field(default="", description="Содержимое ответа (текст/код/число)")
    code_language: str | None = Field(default=None, description="Язык программирования (для ответа в виде кода)")
    chosen_options: list[str] = Field(default_factory=list, description="Выбранные варианты (для ответа с выбором)")

    used_hint_ids: list[UUID] = Field(default_factory=list, description="Подсказки, использованные при решении")
    confidence: ConfidenceLevel | None = Field(default=None, description="Самооценка уверенности (п. 19)")

    status: AnswerStatus = Field(default=AnswerStatus.PENDING, description="Статус проверки ответа")
    is_correct: bool | None = Field(default=None, description="Итоговая корректность (после проверки)")
    score: float | None = Field(default=None, ge=0.0, le=1.0, description="Нормализованная оценка (0..1)")
    feedback: str | None = Field(default=None, description="Обратная связь студенту")
    execution_log: str | None = Field(default=None, description="Лог выполнения (для программных задач)")

    @model_validator(mode="after")
    def _check_not_empty(self) -> "Answer":
        """Ответ не должен быть полностью пустым."""
        if not self.content.strip() and not self.chosen_options:
            raise ValueError("Ответ не может быть пустым: заполните content или chosen_options")
        return self
