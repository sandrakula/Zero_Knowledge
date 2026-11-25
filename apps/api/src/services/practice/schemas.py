"""Request/response models for the practice curriculum API."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class TopicCurriculum(BaseModel):
    chapter_uuid: str = Field(min_length=1, max_length=64)
    topic_key: Optional[str] = Field(default=None, max_length=128)
    section: Optional[str] = Field(default=None, max_length=200)
    module: Optional[str] = Field(default=None, max_length=200)
    level: Optional[int] = Field(default=None, ge=1, le=3)
    prerequisites: Optional[list[str]] = None
    credit: Optional[dict[str, float]] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=600)
    order: Optional[int] = Field(default=None, ge=0, le=100_000)

    @field_validator("prerequisites")
    @classmethod
    def _clean_prerequisites(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            key = str(item).strip()
            if key and key not in cleaned:
                cleaned.append(key[:128])
        if len(cleaned) > 50:
            raise ValueError("at most 50 prerequisites per topic")
        return cleaned

    @field_validator("credit")
    @classmethod
    def _clean_credit(cls, value: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
        if value is None:
            return None
        cleaned: dict[str, float] = {}
        for key, weight in value.items():
            topic = str(key).strip()
            if not topic:
                continue
            cleaned[topic[:128]] = round(max(0.0, min(1.0, float(weight))), 3)
        if len(cleaned) > 50:
            raise ValueError("at most 50 credit weights per topic")
        return cleaned


class TaskMetaUpdate(BaseModel):
    task_uuid: str = Field(min_length=1, max_length=64)
    topic_key: Optional[str] = Field(default=None, max_length=128)
    level: Optional[int] = Field(default=None, ge=1, le=3)
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=600)


class CurriculumUpdate(BaseModel):
    topics: list[TopicCurriculum] = Field(default_factory=list)
    tasks: list[TaskMetaUpdate] = Field(default_factory=list)

    @field_validator("topics")
    @classmethod
    def _limit_topics(cls, value: list[TopicCurriculum]) -> list[TopicCurriculum]:
        if len(value) > 500:
            raise ValueError("at most 500 topics per request")
        return value

    @field_validator("tasks")
    @classmethod
    def _limit_tasks(cls, value: list[TaskMetaUpdate]) -> list[TaskMetaUpdate]:
        if len(value) > 5000:
            raise ValueError("at most 5000 tasks per request")
        return value


class BankTaskUpdate(BaseModel):
    task_uuid: str = Field(min_length=1, max_length=64)
    topic_key: Optional[str] = Field(default=None, max_length=128)
    level: Optional[int] = Field(default=None, ge=1, le=3)
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=600)


class BankTasksUpdate(BaseModel):
    tasks: list[BankTaskUpdate] = Field(default_factory=list)

    @field_validator("tasks")
    @classmethod
    def _limit_updates(cls, value: list[BankTaskUpdate]) -> list[BankTaskUpdate]:
        if len(value) > 500:
            raise ValueError("at most 500 tasks per request")
        return value
