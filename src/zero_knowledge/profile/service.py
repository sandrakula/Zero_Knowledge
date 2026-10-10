"""Сервис ZEROK-6: профиль знаний + roadmap с поясняющим текстом."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from zero_knowledge.schemas import Recommendation, Roadmap
from zero_knowledge.task_generation.errors import ProviderUnavailableError

from .errors import ExplanationInvalidError, ProfileAttemptsExhaustedError
from .heuristics import (
    build_profile,
    build_recommendation_drafts,
    build_roadmap_steps,
)
from .models import ProfileRoadmapResult, TaskOutcome
from .ports import ExplanationProvider
from .prompt import build_explanation_prompt
from .validation import parse_and_validate_explanation


class ProfileRoadmapService:
    """Собрать профиль и roadmap по итогам диагностики.

    Профиль, шаги и действия рекомендаций вычисляются детерминированно;
    LLM дописывает только поясняющий текст: краткое резюме профиля и
    ``rationale`` для каждой рекомендации. Ключ провайдера в сервис не
    попадает — провайдер передаётся готовым (``DeepSeekClient``).
    """

    def __init__(self, provider: ExplanationProvider, *, max_attempts: int = 3) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._provider = provider
        self._max_attempts = max_attempts
        self._attempts_used = 0

    @property
    def attempts_used(self) -> int:
        """Число попыток генерации текста в последнем вызове."""

        return self._attempts_used

    def build(
        self,
        student_id: UUID,
        goal: str,
        outcomes: Sequence[TaskOutcome],
    ) -> ProfileRoadmapResult:
        profile = build_profile(student_id, outcomes)
        steps = build_roadmap_steps(profile)
        drafts = build_recommendation_drafts(profile)

        if not drafts:
            roadmap = Roadmap(
                student_id=student_id,
                goal=goal,
                based_on_profile_id=profile.id,
                steps=steps,
                recommendations=[],
            )
            return ProfileRoadmapResult(
                profile=profile,
                roadmap=roadmap,
                profile_summary=_default_summary(profile),
            )

        prompt = build_explanation_prompt(profile, steps, drafts, goal)

        last_error: ExplanationInvalidError | None = None
        self._attempts_used = 0
        for attempt in range(1, self._max_attempts + 1):
            self._attempts_used = attempt
            raw_response = self._request_provider(prompt)
            try:
                explanation = parse_and_validate_explanation(raw_response, len(drafts))
            except ExplanationInvalidError as error:
                last_error = error
                continue

            recommendations = [
                Recommendation(
                    action=draft.action,
                    rationale=rationale,
                    skill_ids=draft.skill_ids,
                )
                for draft, rationale in zip(
                    drafts, explanation.recommendation_rationales
                )
            ]
            roadmap = Roadmap(
                student_id=student_id,
                goal=goal,
                based_on_profile_id=profile.id,
                steps=steps,
                recommendations=recommendations,
            )
            return ProfileRoadmapResult(
                profile=profile,
                roadmap=roadmap,
                profile_summary=explanation.profile_summary,
            )

        assert last_error is not None
        raise ProfileAttemptsExhaustedError(self._max_attempts, last_error)

    def _request_provider(self, prompt: str) -> str:
        try:
            return self._provider.generate(prompt)
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError(
                "profile explanation provider failed"
            ) from error


def _default_summary(profile: object) -> str:
    skills = getattr(profile, "skills", None)
    if not skills:
        return "Недостаточно данных для построения профиля знаний."
    return "Профиль знаний сформирован по результатам диагностики."
