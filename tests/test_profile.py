"""Тесты ZEROK-6: эвристика профиля/roadmap и сервис с LLM (network-free)."""

from __future__ import annotations

import json
from collections.abc import Sequence
from uuid import UUID

import pytest

from zero_knowledge.profile import (
    ExplanationInvalidError,
    ProfileAttemptsExhaustedError,
    ProfileRoadmapService,
    TaskOutcome,
    build_profile,
    build_recommendation_drafts,
    build_roadmap_steps,
)
from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    CognitiveDepth,
    Difficulty,
    Discipline,
    Hint,
    HintLevel,
    MasteryLevel,
    RoadmapStepType,
    Task,
    TaskType,
    UnderstandingAssessment,
)
from zero_knowledge.task_generation.errors import ProviderUnavailableError

STUDENT_ID = UUID("00000000-0000-4000-8000-000000000001")


def make_task(
    *,
    topic_ids: Sequence[str],
    discipline: Discipline = Discipline.ALGORITHMS,
    difficulty: Difficulty = Difficulty.EASY,
    cognitive_depth: CognitiveDepth = CognitiveDepth.APPLICATION,
) -> Task:
    return Task(
        title="diagnostic",
        discipline=discipline,
        task_type=TaskType.PROGRAMMING,
        statement="read stdin and print it",
        difficulty=difficulty,
        cognitive_depth=cognitive_depth,
        topic_ids=list(topic_ids),
    )


def make_answer(task: Task, is_correct: bool | None) -> Answer:
    return Answer(
        task_id=task.id,
        student_id=STUDENT_ID,
        format=AnswerFormat.TEXT,
        content="answer",
        is_correct=is_correct,
    )


def make_hint(task: Task, *, penalty: float = 1.0) -> Hint:
    return Hint(
        task_id=task.id,
        level=HintLevel.FULL_EXPLANATION,
        content="hint",
        independence_penalty=penalty,
    )


def make_outcome(
    task: Task,
    *,
    is_correct: bool | None,
    hints: Sequence[Hint] = (),
    assessment: UnderstandingAssessment | None = None,
) -> TaskOutcome:
    return TaskOutcome(
        task=task,
        answer=make_answer(task, is_correct),
        hints=hints,
        assessment=assessment,
    )


class QueueProvider:
    def __init__(self, *responses: str) -> None:
        self._responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        self.calls += 1
        return self._responses.pop(0)


def explanation_json(count: int) -> str:
    return json.dumps(
        {
            "profile_summary": "Ученик освоил базовые темы.",
            "recommendation_rationales": [f"reason {i}" for i in range(1, count + 1)],
        }
    )


# --- эвристика профиля ---


def test_empty_outcomes_build_empty_profile() -> None:
    profile = build_profile(STUDENT_ID, [])

    assert profile.student_id == STUDENT_ID
    assert profile.skills == {}
    assert profile.strengths == []
    assert profile.weaknesses == []
    assert profile.needs_review == []
    assert build_roadmap_steps(profile) == []
    assert build_recommendation_drafts(profile) == []


def test_correct_without_hints_is_expert_and_strong() -> None:
    task = make_task(topic_ids=["recursion"])
    profile = build_profile(STUDENT_ID, [make_outcome(task, is_correct=True)])

    assessment = profile.skills["recursion"]
    assert assessment.mastery == MasteryLevel.EXPERT
    assert assessment.independence == 1.0
    assert assessment.evidence_count == 1
    assert profile.strengths == ["recursion"]
    assert profile.weaknesses == []
    assert profile.needs_review == []


def test_correct_with_full_hint_lowers_mastery_and_independence() -> None:
    task = make_task(topic_ids=["recursion"])
    outcome = make_outcome(task, is_correct=True, hints=[make_hint(task, penalty=1.0)])
    profile = build_profile(STUDENT_ID, [outcome])

    assessment = profile.skills["recursion"]
    assert assessment.independence == 0.0
    assert assessment.mastery == MasteryLevel.NOVICE
    assert profile.strengths == []
    assert profile.weaknesses == ["recursion"]
    assert profile.needs_review == ["recursion"]


def test_incorrect_without_hints_is_novice() -> None:
    task = make_task(topic_ids=["recursion"])
    profile = build_profile(STUDENT_ID, [make_outcome(task, is_correct=False)])

    assessment = profile.skills["recursion"]
    assert assessment.independence == 1.0
    assert assessment.mastery == MasteryLevel.NOVICE
    assert profile.weaknesses == ["recursion"]
    assert profile.needs_review == ["recursion"]


def test_aggregation_uses_weakest_mastery_and_mean_independence() -> None:
    easy = make_task(
        topic_ids=["recursion"],
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )
    hard = make_task(
        topic_ids=["recursion"],
        difficulty=Difficulty.HARD,
        cognitive_depth=CognitiveDepth.ANALYSIS,
    )
    outcomes = [
        make_outcome(easy, is_correct=True),  # expert, independence 1.0
        make_outcome(
            hard, is_correct=True, hints=[make_hint(hard, penalty=1.0)]
        ),  # novice, independence 0.0
    ]
    profile = build_profile(STUDENT_ID, outcomes)

    assessment = profile.skills["recursion"]
    assert assessment.mastery == MasteryLevel.NOVICE
    assert assessment.independence == 0.5
    assert assessment.evidence_count == 2
    assert assessment.cognitive_depth == CognitiveDepth.ANALYSIS


def test_topic_ids_fallback_to_discipline() -> None:
    task = make_task(topic_ids=[], discipline=Discipline.PROGRAMMING)
    profile = build_profile(STUDENT_ID, [make_outcome(task, is_correct=True)])

    assert "programming" in profile.skills


def test_uses_understanding_assessment_when_provided() -> None:
    task = make_task(topic_ids=["recursion"])
    assessment = UnderstandingAssessment(
        is_correct=True,
        independence=0.6,
        understanding=MasteryLevel.DEVELOPING,
        hints_used=[],
        rationale="ok",
    )
    outcome = make_outcome(task, is_correct=True, assessment=assessment)
    profile = build_profile(STUDENT_ID, [outcome])

    result = profile.skills["recursion"]
    assert result.independence == 0.6
    assert result.mastery == MasteryLevel.DEVELOPING


# --- roadmap и рекомендации ---


def test_roadmap_steps_by_mastery() -> None:
    novice = make_task(topic_ids=["a"], difficulty=Difficulty.EASY)
    developing_task = make_task(topic_ids=["b"], difficulty=Difficulty.MEDIUM)
    strong = make_task(topic_ids=["c"], difficulty=Difficulty.HARD)

    outcomes = [
        make_outcome(novice, is_correct=False),  # novice
        make_outcome(
            developing_task,
            is_correct=True,
            hints=[make_hint(developing_task, penalty=0.5)],
        ),  # developing (independence 0.5)
        make_outcome(strong, is_correct=True),  # expert
    ]
    profile = build_profile(STUDENT_ID, outcomes)

    steps = build_roadmap_steps(profile)

    assert [step.step_type for step in steps] == [
        RoadmapStepType.STUDY,
        RoadmapStepType.PRACTICE,
        RoadmapStepType.TRANSFER,
    ]
    assert steps[0].skill_ids == ["a"]
    assert steps[0].difficulty == Difficulty.EASY
    assert steps[1].skill_ids == ["b"]
    assert steps[1].difficulty == Difficulty.MEDIUM
    assert steps[2].skill_ids == ["c"]
    assert steps[2].difficulty == Difficulty.HARD


def test_recommendation_drafts_reflect_mastery() -> None:
    novice = make_task(topic_ids=["a"])
    developing_task = make_task(topic_ids=["b"])
    strong = make_task(topic_ids=["c"])

    profile = build_profile(
        STUDENT_ID,
        [
            make_outcome(novice, is_correct=False),
            make_outcome(
                developing_task,
                is_correct=True,
                hints=[make_hint(developing_task, penalty=0.5)],
            ),
            make_outcome(strong, is_correct=True),
        ],
    )

    drafts = build_recommendation_drafts(profile)

    assert [draft.action for draft in drafts] == [
        "Повторить тему a",
        "Допрактиковать тему b",
        "Дать задачу на перенос по теме c",
    ]
    assert [draft.skill_ids for draft in drafts] == [["a"], ["b"], ["c"]]


# --- сервис с LLM ---


def test_service_builds_result_with_llm_text() -> None:
    task = make_task(topic_ids=["recursion"])
    provider = QueueProvider(explanation_json(1))
    service = ProfileRoadmapService(provider)

    result = service.build(
        STUDENT_ID,
        "Подготовиться к собеседованию",
        [make_outcome(task, is_correct=True)],
    )

    assert result.profile_summary == "Ученик освоил базовые темы."
    assert result.roadmap.student_id == STUDENT_ID
    assert result.roadmap.goal == "Подготовиться к собеседованию"
    assert result.roadmap.based_on_profile_id == result.profile.id
    assert len(result.roadmap.recommendations) == 1
    recommendation = result.roadmap.recommendations[0]
    assert recommendation.action == "Дать задачу на перенос по теме recursion"
    assert recommendation.rationale == "reason 1"
    assert recommendation.skill_ids == ["recursion"]
    assert provider.calls == 1
    assert service.attempts_used == 1


def test_service_retries_invalid_then_accepts_valid() -> None:
    task = make_task(topic_ids=["recursion"])
    provider = QueueProvider("not-json", explanation_json(1))
    service = ProfileRoadmapService(provider)

    result = service.build(STUDENT_ID, "goal", [make_outcome(task, is_correct=True)])

    assert result.profile_summary == "Ученик освоил базовые темы."
    assert provider.calls == 2
    assert service.attempts_used == 2


def test_service_exhausts_attempts_on_always_invalid() -> None:
    task = make_task(topic_ids=["recursion"])
    provider = QueueProvider("bad", "still bad", "also bad")
    service = ProfileRoadmapService(provider, max_attempts=3)

    with pytest.raises(ProfileAttemptsExhaustedError) as caught:
        service.build(STUDENT_ID, "goal", [make_outcome(task, is_correct=True)])

    assert caught.value.attempts == 3
    assert isinstance(caught.value.last_error, ExplanationInvalidError)
    assert provider.calls == 3


def test_service_wrong_rationale_count_is_content_error() -> None:
    task = make_task(topic_ids=["a"])
    task2 = make_task(topic_ids=["b"])
    bad = json.dumps(
        {
            "profile_summary": "summary",
            "recommendation_rationales": ["only one"],
        }
    )
    provider = QueueProvider(bad, bad)
    service = ProfileRoadmapService(provider, max_attempts=2)

    with pytest.raises(ProfileAttemptsExhaustedError) as caught:
        service.build(
            STUDENT_ID,
            "goal",
            [
                make_outcome(task, is_correct=True),
                make_outcome(task2, is_correct=True),
            ],
        )

    assert caught.value.attempts == 2
    assert isinstance(caught.value.last_error, ExplanationInvalidError)


def test_service_provider_unavailable_is_not_retried() -> None:
    class UnavailableProvider:
        def __init__(self) -> None:
            self.calls = 0

        def generate(self, prompt: str) -> str:
            del prompt
            self.calls += 1
            raise ProviderUnavailableError("timeout")

    task = make_task(topic_ids=["recursion"])
    provider = UnavailableProvider()
    service = ProfileRoadmapService(provider, max_attempts=3)

    with pytest.raises(ProviderUnavailableError, match="timeout"):
        service.build(STUDENT_ID, "goal", [make_outcome(task, is_correct=True)])

    assert provider.calls == 1


def test_service_without_recommendations_skips_llm() -> None:
    provider = QueueProvider("should-not-be-called")
    service = ProfileRoadmapService(provider)

    result = service.build(STUDENT_ID, "goal", [])

    assert result.roadmap.recommendations == []
    assert (
        result.profile_summary == "Недостаточно данных для построения профиля знаний."
    )
    assert provider.calls == 0
