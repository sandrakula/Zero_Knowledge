"""Схема набора задач (TaskSet) — диагностический или проверочный тест."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import BaseSchema, Identified, Timestamped
from .enums import TaskSetPurpose


class TaskSetItem(BaseSchema):
    """Ссылка на задачу внутри набора с её позицией."""

    task_id: UUID = Field(..., description="Идентификатор задачи")
    order: int = Field(default=0, ge=0, description="Порядок задачи в наборе")


class TaskSet(Identified, Timestamped):
    """Диагностический или проверочный тест (п. 5 спецификации).

    Упорядоченный набор задач, используемый для начальной диагностики,
    промежуточной проверки понимания или итоговой оценки.
    """

    title: str = Field(..., min_length=1, max_length=200, description="Название набора/теста")
    purpose: TaskSetPurpose = Field(..., description="Назначение набора")
    description: str = Field(default="", description="Описание набора")
    items: list[TaskSetItem] = Field(default_factory=list, description="Упорядоченные задачи набора")
    time_limit_seconds: int | None = Field(default=None, ge=0, description="Общий лимит времени, сек; None — без лимита")
