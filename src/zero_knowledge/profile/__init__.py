"""ZEROK-6: профиль знаний и roadmap по итогам диагностики.

Публичный интерфейс:

- :class:`ProfileRoadmapService` — собирает профиль + roadmap + поясняющий
  текст (LLM);
- :func:`build_profile`, :func:`build_roadmap_steps`,
  :func:`build_recommendation_drafts` — детерминированная эвристика без LLM;
- :class:`TaskOutcome`, :class:`ProfileRoadmapResult` — вход/выход модуля.
"""

from __future__ import annotations

from .errors import (
    ExplanationInvalidError,
    ProfileAttemptsExhaustedError,
    ProfileError,
)
from .heuristics import (
    RecommendationDraft,
    build_profile,
    build_recommendation_drafts,
    build_roadmap_steps,
)
from .models import ProfileRoadmapResult, TaskOutcome
from .ports import ExplanationProvider
from .service import ProfileRoadmapService

__all__ = [
    "ExplanationInvalidError",
    "ExplanationProvider",
    "ProfileAttemptsExhaustedError",
    "ProfileError",
    "ProfileRoadmapResult",
    "ProfileRoadmapService",
    "RecommendationDraft",
    "TaskOutcome",
    "build_profile",
    "build_recommendation_drafts",
    "build_roadmap_steps",
]
