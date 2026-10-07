"""Общие базовые модели и примеси для всех схем данных."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    """Текущее время в UTC — единый источник времени для всех схем."""
    return datetime.now(timezone.utc)


class BaseSchema(BaseModel):
    """Базовые настройки, общие для всех схем платформы.

    - ``extra="forbid"`` — неизвестные поля отклоняются, чтобы ошибки
      в контрактах данных обнаруживались сразу.
    - ``populate_by_name=True`` — поля можно заполнять по имени атрибута.
    - ``validate_assignment=True`` — повторная валидация при изменении полей.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        validate_assignment=True,
    )


class Identified(BaseSchema):
    """Схема с уникальным идентификатором сущности."""

    id: UUID = Field(
        default_factory=uuid4,
        description="Уникальный идентификатор сущности (UUID v4)",
    )


class Timestamped(BaseSchema):
    """Схема с временем создания и последнего изменения."""

    created_at: datetime = Field(
        default_factory=utc_now,
        description="Время создания (UTC)",
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        description="Время последнего изменения (UTC)",
    )
