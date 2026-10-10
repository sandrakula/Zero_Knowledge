"""Детерминированная валидация вопросов, сгенерированных провайдером."""

from __future__ import annotations

import json
from uuid import UUID

from pydantic import Field, TypeAdapter, ValidationError

from zero_knowledge.schemas import (
    BaseSchema,
    SolutionQuestion,
    SolutionQuestionKind,
    SolutionQuestionnaire,
)

from .errors import QuestionsInvalidError


class _QuestionDraft(BaseSchema):
    """Транспортный объект вопроса: без ``order`` (его назначает сервис)."""

    kind: SolutionQuestionKind
    text: str = Field(..., min_length=1)
    target: str = ""
    rationale: str = ""


class _QuestionnaireDraft(BaseSchema):
    questions: list[_QuestionDraft]


_questionnaire_adapter = TypeAdapter(_QuestionnaireDraft)


def parse_and_validate_questions(
    raw_response: str, answer_id: UUID
) -> SolutionQuestionnaire:
    """Разобрать JSON провайдера и вернуть канонический набор вопросов.

    ``order`` присваивается по позиции вопроса в массиве, ``answer_id`` —
    сервисом; модель их не генерирует.
    """

    try:
        payload = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError) as error:
        raise QuestionsInvalidError(f"response is not valid JSON: {error}") from error

    try:
        draft = _questionnaire_adapter.validate_python(payload)
    except ValidationError as error:
        raise QuestionsInvalidError(
            f"response violates the question schema: {error}"
        ) from error

    questions = [
        SolutionQuestion(
            order=index,
            kind=item.kind,
            text=item.text,
            target=item.target,
            rationale=item.rationale,
        )
        for index, item in enumerate(draft.questions)
    ]
    return SolutionQuestionnaire(answer_id=answer_id, questions=questions)
