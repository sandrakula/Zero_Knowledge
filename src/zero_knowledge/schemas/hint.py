"""Схема подсказки (Hint)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import Identified, Timestamped
from .enums import HintLevel


class Hint(Identified, Timestamped):
    """Подсказка к задаче (п. 8 спецификации).

    Подсказки упорядочены по уровням — от лёгкого намёка до полного
    объяснения — и не должны раскрывать готовое решение. Количество и
    уровень использованных подсказок учитываются при оценке
    самостоятельности студента.
    """

    task_id: UUID = Field(..., description="Задача, к которой относится подсказка")
    level: HintLevel = Field(..., description="Уровень подсказки (намёк → полное объяснение)")
    order: int = Field(default=0, ge=0, description="Порядок показа подсказок внутри задачи")
    content: str = Field(..., min_length=1, description="Текст подсказки")
    reveals_solution: bool = Field(default=False, description="Раскрывает ли подсказка решение целиком")
    independence_penalty: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Штраф к оценке самостоятельности за использование подсказки (0..1)",
    )
