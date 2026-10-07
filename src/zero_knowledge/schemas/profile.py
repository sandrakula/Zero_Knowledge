"""Схемы профиля знаний (KnowledgeProfile)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from .common import BaseSchema, Identified, Timestamped, utc_now
from .enums import CognitiveDepth, MasteryLevel, MisconceptionCause, MisconceptionStatus


class SkillAssessment(BaseSchema):
    """Многомерная оценка одного навыка (п. 25 спецификации).

    Отражает не только факт «знает / не знает», а восемь измерений
    компетентности. Доли ``0..1`` — нормированные показатели; ``calibration``
    лежит в диапазоне ``-1..1`` (отрицательное значение — завышенная
    самооценка, положительное — заниженная).
    """

    skill_id: str = Field(..., min_length=1, description="Идентификатор навыка/темы")
    mastery: MasteryLevel = Field(default=MasteryLevel.UNKNOWN, description="Степень освоения (mastery)")
    cognitive_depth: CognitiveDepth = Field(default=CognitiveDepth.RECOGNITION, description="Глубина понимания")

    independence: float = Field(default=0.0, ge=0.0, le=1.0, description="Способность работать без помощи")
    application: float = Field(default=0.0, ge=0.0, le=1.0, description="Применение в комплексных задачах")
    transfer: float = Field(default=0.0, ge=0.0, le=1.0, description="Перенос в новые контексты")
    retention: float = Field(default=0.0, ge=0.0, le=1.0, description="Устойчивость знания во времени")
    process_quality: float = Field(default=0.0, ge=0.0, le=1.0, description="Качество процесса решения")
    calibration: float = Field(default=0.0, ge=-1.0, le=1.0, description="Точность самооценки (-1..1)")

    evidence_count: int = Field(default=0, ge=0, description="Число зафиксированных наблюдений")
    last_assessed_at: datetime = Field(default_factory=utc_now, description="Время последней оценки (UTC)")


class Misconception(Identified, Timestamped):
    """Устойчивое заблуждение или ошибка (п. 9, 26 спецификации).

    ``created_at`` трактуется как момент обнаружения заблуждения.
    """

    student_id: UUID = Field(..., description="Идентификатор студента")
    skill_id: str = Field(..., min_length=1, description="Связанный навык")
    description: str = Field(..., min_length=1, description="Описание заблуждения")
    cause: MisconceptionCause = Field(..., description="Определённая причина ошибки")
    status: MisconceptionStatus = Field(default=MisconceptionStatus.ACTIVE, description="Статус работы с заблуждением")
    occurrences: int = Field(default=1, ge=1, description="Сколько раз проявилось")
    resolved_at: datetime | None = Field(default=None, description="Время устранения (UTC)")


class KnowledgeProfile(Identified, Timestamped):
    """Профиль знаний студента (п. 4, 20, 25 спецификации).

    Постоянно обновляемая модель компетенций: карта навыков, сильные и
    слабые стороны, темы для повторения и активные заблуждения.
    """

    student_id: UUID = Field(..., description="Идентификатор студента")
    skills: dict[str, SkillAssessment] = Field(default_factory=dict, description="Карта навыков: skill_id → оценка")
    misconceptions: list[Misconception] = Field(default_factory=list, description="Устойчивые заблуждения")
    strengths: list[str] = Field(default_factory=list, description="Сильные стороны (skill_ids)")
    weaknesses: list[str] = Field(default_factory=list, description="Слабые места (skill_ids)")
    needs_review: list[str] = Field(default_factory=list, description="Темы, требующие повторения (skill_ids)")
