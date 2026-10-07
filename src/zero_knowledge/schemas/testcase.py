"""Схема тест-кейса для автоматической проверки (TestCase)."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from .common import Identified, Timestamped


class TestCase(Identified, Timestamped):
    """Тест-кейс для автоматической проверки программного решения (п. 11).

    Описывает один вход и ожидаемый результат. Видимые тесты доступны
    студенту для самопроверки, скрытые — используются при итоговой оценке.
    """

    task_id: UUID = Field(..., description="Задача, к которой относится тест")
    description: str = Field(default="", description="Краткое описание проверяемого случая")
    input_data: str = Field(..., description="Входные данные (в формате, ожидаемом средой выполнения)")
    expected_output: str = Field(..., description="Ожидаемый вывод")
    is_hidden: bool = Field(default=True, description="Скрыт ли тест от студента")
    order: int = Field(default=0, ge=0, description="Порядок выполнения тестов")
    timeout_ms: int | None = Field(default=None, ge=1, description="Лимит времени выполнения, мс; None — без лимита")
    memory_mb: int | None = Field(default=None, ge=1, description="Лимит памяти, МБ; None — без лимита")
