"""Smoke-тесты схем данных платформы Zero Knowledge.

Проверяют, что все модели собираются, валидируют ограничения и
корректно сериализуются в JSON.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    AnswerStatus,
    CognitiveDepth,
    Difficulty,
    Discipline,
    Hint,
    HintLevel,
    KnowledgeProfile,
    MasteryLevel,
    Misconception,
    MisconceptionCause,
    Recommendation,
    ReferenceSolution,
    Roadmap,
    RoadmapStep,
    RoadmapStepStatus,
    RoadmapStepType,
    SkillAssessment,
    Task,
    TaskSet,
    TaskSetItem,
    TaskSetPurpose,
    TaskType,
    TestCase as VerificationCase,
)


# --- Task -----------------------------------------------------------------

def test_task_builds_and_serializes() -> None:
    task = Task(
        title="Сумма двух чисел",
        discipline=Discipline.ALGORITHMS,
        task_type=TaskType.PROGRAMMING,
        statement="Даны два целых числа a и b, верните a + b.",
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )
    data = task.model_dump(mode="json")
    assert data["task_type"] == "programming"
    assert data["difficulty"] == "easy"
    assert isinstance(data["id"], str)


def test_task_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        Task(
            title="x",
            discipline=Discipline.MATHEMATICS,
            task_type=TaskType.QUESTION,
            statement="s",
            difficulty=Difficulty.EASY,
            cognitive_depth=CognitiveDepth.RECOGNITION,
            unknown_field=True,  # type: ignore[call-arg]
        )


def test_task_requires_statement() -> None:
    with pytest.raises(ValidationError):
        Task(
            title="x",
            discipline=Discipline.MATHEMATICS,
            task_type=TaskType.QUESTION,
            difficulty=Difficulty.EASY,
            cognitive_depth=CognitiveDepth.RECOGNITION,
        )


# --- Answer ---------------------------------------------------------------

def test_answer_defaults_and_validation() -> None:
    answer = Answer(
        task_id=uuid4(),
        student_id=uuid4(),
        format=AnswerFormat.CODE,
        content="def f(a, b): return a + b",
        code_language="python",
    )
    assert answer.status == AnswerStatus.PENDING
    assert answer.attempt_number == 1


def test_answer_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        Answer(task_id=uuid4(), student_id=uuid4(), format=AnswerFormat.TEXT)


def test_answer_with_choice_is_valid() -> None:
    answer = Answer(
        task_id=uuid4(),
        student_id=uuid4(),
        format=AnswerFormat.CHOICE,
        chosen_options=["A", "C"],
    )
    assert answer.chosen_options == ["A", "C"]


# --- Hint / ReferenceSolution / TestCase ----------------------------------

def test_hint_builds() -> None:
    hint = Hint(task_id=uuid4(), level=HintLevel.NUDGE, content="Подумай о базовом случае.")
    assert hint.reveals_solution is False


def test_reference_solution_builds() -> None:
    solution = ReferenceSolution(
        task_id=uuid4(),
        approach="Итерация по массиву с накоплением суммы.",
        steps=[
            {
                "order": 0,
                "title": "Инициализация",
                "explanation": "Завести переменную суммы.",
            }
        ],
        final_answer="sum(a)",
        code="def f(a): return sum(a)",
        complexity="O(n)",
    )
    assert solution.steps[0].title == "Инициализация"


def test_test_case_hidden_by_default() -> None:
    case = VerificationCase(task_id=uuid4(), input_data="1 2", expected_output="3")
    assert case.is_hidden is True


# --- TaskSet --------------------------------------------------------------

def test_task_set_builds() -> None:
    task_id = uuid4()
    ts = TaskSet(
        title="Диагностика по алгоритмам",
        purpose=TaskSetPurpose.DIAGNOSTIC,
        items=[TaskSetItem(task_id=task_id, order=0)],
    )
    assert ts.items[0].task_id == task_id


# --- KnowledgeProfile -----------------------------------------------------

def test_skill_assessment_rejects_out_of_range() -> None:
    with pytest.raises(ValidationError):
        SkillAssessment(skill_id="recursion", independence=1.5)


def test_knowledge_profile_holds_skills() -> None:
    profile = KnowledgeProfile(student_id=uuid4())
    profile.skills["recursion"] = SkillAssessment(
        skill_id="recursion",
        mastery=MasteryLevel.DEVELOPING,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )
    assert "recursion" in profile.skills
    assert profile.skills["recursion"].mastery == MasteryLevel.DEVELOPING


def test_misconception_builds() -> None:
    m = Misconception(
        student_id=uuid4(),
        skill_id="recursion",
        description="Неверно выбирает условие остановки рекурсии.",
        cause=MisconceptionCause.CANNOT_APPLY,
    )
    assert m.status.value == "active"


# --- Roadmap --------------------------------------------------------------

def test_roadmap_roundtrip_json() -> None:
    roadmap = Roadmap(
        student_id=uuid4(),
        goal="Подготовка к собеседованию по алгоритмам",
        steps=[
            RoadmapStep(
                id=uuid4(),
                order=0,
                step_type=RoadmapStepType.STUDY,
                title="Базовые структуры данных",
                difficulty=Difficulty.EASY,
            )
        ],
        recommendations=[
            Recommendation(action="Повторить рекурсию", rationale="Трудности с условием остановки.")
        ],
    )
    data = roadmap.model_dump(mode="json")
    restored = Roadmap.model_validate(data)
    assert restored.goal == roadmap.goal
    assert restored.steps[0].status == RoadmapStepStatus.PENDING
    assert restored.recommendations[0].action == "Повторить рекурсию"
