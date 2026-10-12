"""Входные и выходные типы модуля профиля и roadmap (ZEROK-6)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from zero_knowledge.schemas import (
    Answer,
    Hint,
    KnowledgeProfile,
    Roadmap,
    Task,
    UnderstandingAssessment,
)


@dataclass(frozen=True)
class TaskOutcome:
    """Итог одной диагностической задачи.

    ``assessment`` — оценка понимания из модуля разбора решений (ZEROK-5).
    Когда она не передана, эвристика строит её сама из ``answer`` и ``hints``.
    """

    task: Task
    answer: Answer
    hints: Sequence[Hint] = ()
    assessment: UnderstandingAssessment | None = None


@dataclass(frozen=True)
class ProfileRoadmapResult:
    """Результат ZEROK-6: профиль + roadmap + поясняющий текст профиля."""

    profile: KnowledgeProfile
    roadmap: Roadmap
    profile_summary: str
