"""Схемы персонального пути обучения (Roadmap)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import BaseSchema, Identified, Timestamped
from .enums import Difficulty, LearningGoalStatus, RoadmapStepStatus, RoadmapStepType


class Recommendation(BaseSchema):
    """Объяснимая рекомендация (п. 21 спецификации).

    Описывает не только предлагаемое действие, но и причину, по которой
    система его предлагает, — чтобы студент мог влиять на свой путь.
    """

    action: str = Field(..., min_length=1, description="Предлагаемое действие")
    rationale: str = Field(..., min_length=1, description="Объяснение, почему предложено именно это действие")
    skill_ids: list[str] = Field(default_factory=list, description="Затрагиваемые навыки")


class RoadmapStep(BaseSchema):
    """Шаг персонального пути (п. 6–7 спецификации)."""

    id: UUID = Field(..., description="Идентификатор шага")
    order: int = Field(..., ge=0, description="Порядок шага в пути")
    step_type: RoadmapStepType = Field(..., description="Тип шага")
    title: str = Field(..., min_length=1, description="Название шага")
    description: str = Field(default="", description="Описание шага")
    skill_ids: list[str] = Field(default_factory=list, description="Целевые навыки шага")
    difficulty: Difficulty = Field(..., description="Сложность шага")
    task_ids: list[UUID] = Field(default_factory=list, description="Задачи, назначенные на шаг")
    status: RoadmapStepStatus = Field(default=RoadmapStepStatus.PENDING, description="Статус шага")
    rationale: str = Field(default="", description="Объяснение выбора шага (п. 21)")


class Roadmap(Identified, Timestamped):
    """Персональный путь обучения студента (п. 6, 27 спецификации).

    Формируется после диагностики и пересматривается по мере изменения
    профиля знаний; ``version`` растёт при каждом пересмотре плана.
    """

    student_id: UUID = Field(..., description="Идентификатор студента")
    goal: str = Field(..., min_length=1, description="Цель обучения (п. 27, шаг 1)")
    goal_status: LearningGoalStatus = Field(default=LearningGoalStatus.DEFINED, description="Статус цели")
    based_on_profile_id: UUID | None = Field(default=None, description="Профиль знаний, на основе которого построен план")
    steps: list[RoadmapStep] = Field(default_factory=list, description="Упорядоченные шаги пути")
    recommendations: list[Recommendation] = Field(default_factory=list, description="Объяснимые рекомендации")
    version: int = Field(default=1, ge=1, description="Версия плана (растёт при пересмотре)")
