"""Тесты разбора решения: скоринг, валидация вопросов и сервис."""

from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    CognitiveDepth,
    Difficulty,
    Discipline,
    Hint,
    HintLevel,
    MasteryLevel,
    Task,
    TaskType,
)
from zero_knowledge.solution_review import (
    QuestionsInvalidError,
    SolutionReviewAttemptsExhaustedError,
    SolutionReviewService,
    assess_understanding,
    compute_independence,
    parse_and_validate_questions,
)
from zero_knowledge.task_generation.errors import ProviderUnavailableError


def make_task() -> Task:
    return Task(
        title="Count nodes",
        discipline=Discipline.ALGORITHMS,
        task_type=TaskType.PROGRAMMING,
        statement="Write a function that counts the nodes in a binary tree.",
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )


def make_answer(task: Task, *, is_correct: bool | None = None) -> Answer:
    return Answer(
        task_id=task.id,
        student_id=uuid4(),
        format=AnswerFormat.CODE,
        content="def count_nodes(root):\n    return 1 + count_nodes(root)",
        is_correct=is_correct,
    )


def make_hint(task: Task, *, level: HintLevel = HintLevel.NUDGE, penalty: float = 0.1) -> Hint:
    return Hint(
        task_id=task.id,
        level=level,
        content="Think about the base case.",
        independence_penalty=penalty,
    )


def _questions_json() -> str:
    return json.dumps(
        {
            "questions": [
                {
                    "kind": "error_detection",
                    "text": "What happens when root is None?",
                    "target": "line 1",
                    "rationale": "check the base case",
                },
                {
                    "kind": "strategy",
                    "text": "Why do you recurse on root itself?",
                    "target": "",
                    "rationale": "spot infinite recursion",
                },
            ]
        }
    )


# --- scoring ---


def test_compute_independence_no_hints_is_one() -> None:
    assert compute_independence([]) == 1.0


def test_compute_independence_subtracts_penalties() -> None:
    task = make_task()
    hints = [
        make_hint(task, penalty=0.3),
        make_hint(task, level=HintLevel.IDEA, penalty=0.2),
    ]
    assert compute_independence(hints) == pytest.approx(0.5)


def test_compute_independence_clamps_at_zero() -> None:
    task = make_task()
    hints = [
        make_hint(task, penalty=0.6),
        make_hint(task, penalty=0.6),
    ]
    assert compute_independence(hints) == 0.0


def test_assessment_correct_without_hints_is_expert() -> None:
    task = make_task()
    assessment = assess_understanding(make_answer(task, is_correct=True), [])
    assert assessment.understanding is MasteryLevel.EXPERT
    assert assessment.independence == 1.0
    assert assessment.hints_used == []


def test_assessment_correct_with_heavy_hints_is_degraded() -> None:
    task = make_task()
    hints = [make_hint(task, level=HintLevel.FULL_EXPLANATION, penalty=0.8)]
    assessment = assess_understanding(make_answer(task, is_correct=True), hints)
    assert assessment.understanding is MasteryLevel.NOVICE
    assert assessment.independence == pytest.approx(0.2)
    assert assessment.hints_used[0].level is HintLevel.FULL_EXPLANATION


def test_assessment_incorrect_is_novice_even_without_hints() -> None:
    task = make_task()
    assessment = assess_understanding(make_answer(task, is_correct=False), [])
    assert assessment.understanding is MasteryLevel.NOVICE
    assert assessment.independence == 1.0


def test_assessment_unchecked_correctness_is_unknown() -> None:
    task = make_task()
    assessment = assess_understanding(make_answer(task, is_correct=None), [])
    assert assessment.understanding is MasteryLevel.UNKNOWN


# --- validation ---


def test_parse_questions_assigns_order_and_answer_id() -> None:
    answer_id = uuid4()
    questionnaire = parse_and_validate_questions(_questions_json(), answer_id)
    assert questionnaire.answer_id == answer_id
    assert [q.order for q in questionnaire.questions] == [0, 1]
    assert [q.kind.value for q in questionnaire.questions] == [
        "error_detection",
        "strategy",
    ]


def test_parse_questions_rejects_invalid_json() -> None:
    with pytest.raises(QuestionsInvalidError):
        parse_and_validate_questions("not json", uuid4())


def test_parse_questions_rejects_unknown_kind() -> None:
    raw = json.dumps({"questions": [{"kind": "bogus", "text": "Why?"}]})
    with pytest.raises(QuestionsInvalidError):
        parse_and_validate_questions(raw, uuid4())


def test_parse_questions_rejects_missing_text() -> None:
    raw = json.dumps({"questions": [{"kind": "strategy"}]})
    with pytest.raises(QuestionsInvalidError):
        parse_and_validate_questions(raw, uuid4())


def test_parse_questions_rejects_extra_fields() -> None:
    raw = json.dumps(
        {"questions": [{"kind": "strategy", "text": "Why?", "surprise": 1}]}
    )
    with pytest.raises(QuestionsInvalidError):
        parse_and_validate_questions(raw, uuid4())


# --- service ---


class _FakeProvider:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        del prompt
        self.calls += 1
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_service_produces_questions_and_assessment() -> None:
    task = make_task()
    answer = make_answer(task, is_correct=True)
    provider = _FakeProvider([_questions_json()])

    review = SolutionReviewService(provider).review(task, answer, [])

    assert len(review.questions) == 2
    assert review.assessment.understanding is MasteryLevel.EXPERT
    assert review.answer_id == answer.id
    assert review.task_id == task.id
    assert provider.calls == 1


def test_service_retries_on_invalid_content_then_succeeds() -> None:
    task = make_task()
    answer = make_answer(task, is_correct=True)
    provider = _FakeProvider(["not json", _questions_json()])

    service = SolutionReviewService(provider, max_attempts=3)
    review = service.review(task, answer, [])

    assert len(review.questions) == 2
    assert provider.calls == 2
    assert service.attempts_used == 2


def test_service_exhausts_attempts_on_persistent_invalid_content() -> None:
    task = make_task()
    answer = make_answer(task, is_correct=True)
    provider = _FakeProvider(["nope", "nope"])

    service = SolutionReviewService(provider, max_attempts=2)
    with pytest.raises(SolutionReviewAttemptsExhaustedError) as caught:
        service.review(task, answer, [])

    assert provider.calls == 2
    assert service.attempts_used == 2
    assert isinstance(caught.value.last_error, QuestionsInvalidError)


def test_service_stops_immediately_on_provider_unavailable() -> None:
    task = make_task()
    answer = make_answer(task, is_correct=True)
    provider = _FakeProvider([ProviderUnavailableError("down")])

    service = SolutionReviewService(provider, max_attempts=3)
    with pytest.raises(ProviderUnavailableError):
        service.review(task, answer, [])

    assert provider.calls == 1  # infra error is not retried


# --- integration with DeepSeekClient ---


def test_deepseek_response_becomes_solution_review() -> None:
    def handler(request):
        body = json.dumps({"choices": [{"message": {"content": _questions_json()}}]})
        return httpx.Response(200, text=body, request=request)

    client = DeepSeekClient(api_key="test-key", transport=httpx.MockTransport(handler))
    task = make_task()
    answer = make_answer(task, is_correct=False)
    hints = [make_hint(task, level=HintLevel.STEP, penalty=0.5)]

    review = SolutionReviewService(client).review(task, answer, hints)

    assert len(review.questions) == 2
    assert review.assessment.understanding is MasteryLevel.NOVICE
    assert review.assessment.independence == pytest.approx(0.5)
    assert len(review.assessment.hints_used) == 1
