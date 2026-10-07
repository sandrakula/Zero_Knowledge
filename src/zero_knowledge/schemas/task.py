"""Схема учебной задачи (Task)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import Field

from .common import Identified, Timestamped
from .enums import CognitiveDepth, Difficulty, Discipline, TaskType


class Task(Identified, Timestamped):
    """Учебная задача — центральная сущность контента платформы.

    Покрывает как диагностические вопросы, так и полноценные программные
    задачи (п. 5, 11 спецификации). Ссылки на подсказки, эталонное решение
    и тест-кейсы хранятся в виде идентификаторов соответствующих сущностей.
    """

    title: str = Field(..., min_length=1, max_length=200, description="Краткий заголовок задачи")
    discipline: Discipline = Field(..., description="Предметное направление")
    task_type: TaskType = Field(..., description="Тип задания")
    statement: str = Field(..., min_length=1, description="Условие задачи")
    difficulty: Difficulty = Field(..., description="Уровень сложности")
    cognitive_depth: CognitiveDepth = Field(..., description="Требуемая глубина понимания")

    topic_ids: list[str] = Field(default_factory=list, description="Связанные темы/навыки (skill_ids)")
    tags: list[str] = Field(default_factory=list, description="Дополнительные теги для поиска")
    prerequisites: list[str] = Field(default_factory=list, description="Необходимые предварительные навыки (skill_ids)")

    is_transfer: bool = Field(default=False, description="Является ли задачей на перенос (п. 15)")
    is_project: bool = Field(default=False, description="Относится ли к комплексному проекту (п. 22)")

    allowed_attempts: int | None = Field(default=None, ge=1, description="Лимит попыток; None — без ограничения")
    time_limit_seconds: int | None = Field(default=None, ge=0, description="Лимит времени на решение, сек; None — без лимита")

    hint_ids: list[UUID] = Field(default_factory=list, description="Идентификаторы доступных подсказок")
    solution_id: UUID | None = Field(default=None, description="Идентификатор эталонного решения")
    test_ids: list[UUID] = Field(default_factory=list, description="Идентификаторы тест-кейсов (для программных задач)")

    metadata: dict[str, Any] = Field(default_factory=dict, description="Расширяемые метаданные задачи")
