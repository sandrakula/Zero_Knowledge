"""Bounded, schema-validated ZEROK-6 profile and roadmap generation."""

from __future__ import annotations

import json
from typing import TypeVar
from uuid import UUID

from pydantic import BaseModel, ValidationError

from zero_knowledge.schemas import KnowledgeProfile, Roadmap
from zero_knowledge.task_generation.errors import ProviderUnavailableError

from .errors import LearningPathAttemptsExhaustedError, LearningPathInvalidError
from .ports import LearningPathProvider
from .prompt import build_profile_prompt, build_roadmap_prompt

ModelT = TypeVar("ModelT", bound=BaseModel)


class LearningPathService:
    """Generate canonical ZEROK-6 entities through the ZEROK-1 provider."""

    def __init__(
        self, provider: LearningPathProvider, *, max_attempts: int = 3
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._provider = provider
        self._max_attempts = max_attempts

    def build_profile(self, student_id: UUID, observations: str) -> KnowledgeProfile:
        if not observations.strip():
            raise ValueError("observations must not be blank")
        prompt = build_profile_prompt(student_id, observations)
        profile = self._generate(prompt, KnowledgeProfile)
        if profile.student_id != student_id:
            raise LearningPathInvalidError(
                "profile student_id does not match the session"
            )
        return profile

    def build_roadmap(
        self,
        student_id: UUID,
        profile: KnowledgeProfile,
        *,
        goal: str,
        assessment_summary: str,
    ) -> Roadmap:
        if profile.student_id != student_id:
            raise ValueError("profile student_id does not match the session")
        prompt = build_roadmap_prompt(
            student_id,
            profile,
            goal=goal,
            assessment_summary=assessment_summary,
        )
        roadmap = self._generate(prompt, Roadmap)
        if roadmap.student_id != student_id:
            raise LearningPathInvalidError(
                "roadmap student_id does not match the session"
            )
        if roadmap.based_on_profile_id != profile.id:
            raise LearningPathInvalidError(
                "roadmap is not linked to the generated profile"
            )
        return roadmap

    def _generate(self, prompt: str, model: type[ModelT]) -> ModelT:
        last_error: LearningPathInvalidError | None = None
        for _attempt in range(1, self._max_attempts + 1):
            try:
                raw = self._provider.generate(prompt)
            except ProviderUnavailableError:
                raise
            except Exception as error:
                raise ProviderUnavailableError(
                    "learning path provider failed"
                ) from error

            try:
                return model.model_validate(json.loads(raw))
            except (json.JSONDecodeError, TypeError, ValidationError) as error:
                last_error = LearningPathInvalidError(
                    f"provider response violates {model.__name__}: {error}"
                )

        assert last_error is not None
        raise LearningPathAttemptsExhaustedError(self._max_attempts, last_error)
