"""Детерминированная валидация поясняющего текста, сгенерированного LLM."""

from __future__ import annotations

import json
from typing import Annotated

from pydantic import Field, TypeAdapter, ValidationError

from zero_knowledge.schemas import BaseSchema

from .errors import ExplanationInvalidError


class _ExplanationDraft(BaseSchema):
    """Транспортный объект ответа LLM.

    ``recommendation_rationales`` содержит ровно столько строк, сколько
    черновиков рекомендаций передано в промпт; сервис сверяет длину.
    """

    profile_summary: str = Field(..., min_length=1)
    recommendation_rationales: list[Annotated[str, Field(min_length=1)]]


_explanation_adapter = TypeAdapter(_ExplanationDraft)


def parse_and_validate_explanation(
    raw_response: str, expected_count: int
) -> _ExplanationDraft:
    """Разобрать JSON провайдера и проверить число rationale."""

    try:
        payload = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError) as error:
        raise ExplanationInvalidError(f"response is not valid JSON: {error}") from error

    try:
        draft = _explanation_adapter.validate_python(payload)
    except ValidationError as error:
        raise ExplanationInvalidError(
            f"response violates the explanation schema: {error}"
        ) from error

    if len(draft.recommendation_rationales) != expected_count:
        raise ExplanationInvalidError(
            f"expected {expected_count} recommendation rationales, "
            f"got {len(draft.recommendation_rationales)}"
        )

    return draft
