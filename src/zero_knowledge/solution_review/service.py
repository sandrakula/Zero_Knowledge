"""Ограниченный разбор решения: вопросы AI + детерминированная оценка."""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import Answer, Hint, SolutionReview, Task
from zero_knowledge.task_generation.errors import ProviderUnavailableError

from .errors import (
    QuestionsInvalidError,
    SolutionReviewAttemptsExhaustedError,
)
from .ports import SolutionQuestionProvider
from .prompt import build_solution_questions_prompt
from .scoring import assess_understanding
from .validation import parse_and_validate_questions


class SolutionReviewService:
    """Сформировать по решению вопросы и оценку понимания.

    Оценка понимания вычисляется детерминированно (корректность ответа +
    использованные подсказки) и не зависит от AI. Вопросы генерирует
    провайдер; содержательные дефекты расходуют попытку, а недоступность
    провайдера останавливает разбор сразу (повторная генерация её не чинит).
    """

    def __init__(
        self, provider: SolutionQuestionProvider, *, max_attempts: int = 3
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._provider = provider
        self._max_attempts = max_attempts
        self._attempts_used = 0

    @property
    def attempts_used(self) -> int:
        """Число попыток генерации вопросов в последнем вызове."""

        return self._attempts_used

    def review(
        self, task: Task, answer: Answer, hints: Sequence[Hint]
    ) -> SolutionReview:
        assessment = assess_understanding(answer, hints)
        prompt = build_solution_questions_prompt(task, answer, hints)

        last_error: QuestionsInvalidError | None = None
        self._attempts_used = 0
        for attempt in range(1, self._max_attempts + 1):
            self._attempts_used = attempt
            raw_response = self._request_provider(prompt)
            try:
                questionnaire = parse_and_validate_questions(
                    raw_response, answer.id
                )
            except QuestionsInvalidError as error:
                last_error = error
                continue

            return SolutionReview(
                answer_id=answer.id,
                task_id=task.id,
                questions=questionnaire.questions,
                assessment=assessment,
            )

        assert last_error is not None
        raise SolutionReviewAttemptsExhaustedError(self._max_attempts, last_error)

    def _request_provider(self, prompt: str) -> str:
        try:
            return self._provider.generate(prompt)
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError(
                "solution question provider failed"
            ) from error
