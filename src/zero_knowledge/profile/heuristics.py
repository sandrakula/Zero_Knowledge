"""Детерминированная эвристика профиля и roadmap (ZEROK-6).

Эвристика не зависит от AI и от модуля разбора решений: она умеет работать
как с готовой ``UnderstandingAssessment`` (ZEROK-5), так и с сырыми
``answer`` + ``hints``, когда оценка понимания не передана.

Правила:

- ``independence`` по навыку — среднее по задачам значение самостоятельности;
  самостоятельность по одной задаче = ``1 - сумма штрафов подсказок``
  (пороги совпадают с ``solution_review.scoring``).
- ``mastery`` по навыку — самый слабый уровень понимания среди задач навыка
  (консервативно: навык освоен не лучше, чем его самое слабое проявление).
- ``strengths`` / ``weaknesses`` / ``needs_review`` — классификация навыков
  по уровню освоения и самостоятельности.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID, uuid4

from zero_knowledge.schemas import (
    CognitiveDepth,
    Difficulty,
    KnowledgeProfile,
    MasteryLevel,
    RoadmapStep,
    RoadmapStepType,
    SkillAssessment,
    Task,
)

from .models import TaskOutcome

# Пороги согласованы с solution_review.scoring.
_EXPERT_INDEPENDENCE = 0.95
_PROFICIENT_INDEPENDENCE = 0.8
_DEVELOPING_INDEPENDENCE = 0.4
_STRENGTH_INDEPENDENCE = 0.8

_LEVEL_ORDER: dict[MasteryLevel, int] = {
    MasteryLevel.UNKNOWN: 0,
    MasteryLevel.NOVICE: 1,
    MasteryLevel.DEVELOPING: 2,
    MasteryLevel.PROFICIENT: 3,
    MasteryLevel.EXPERT: 4,
}

_COGNITIVE_ORDER: dict[CognitiveDepth, int] = {
    CognitiveDepth.RECOGNITION: 0,
    CognitiveDepth.COMPREHENSION: 1,
    CognitiveDepth.APPLICATION: 2,
    CognitiveDepth.ANALYSIS: 3,
    CognitiveDepth.EVALUATION: 4,
    CognitiveDepth.CREATION: 5,
}

_STRONG_MASTERY = {MasteryLevel.PROFICIENT, MasteryLevel.EXPERT}
_WEAK_MASTERY = {MasteryLevel.NOVICE, MasteryLevel.DEVELOPING}


@dataclass(frozen=True)
class RecommendationDraft:
    """Детерминированная рекомендация; LLM дописывает только rationale."""

    action: str
    skill_ids: list[str]


@dataclass(frozen=True)
class _SkillSignal:
    independence: float
    understanding: MasteryLevel
    cognitive_depth: CognitiveDepth


def build_profile(
    student_id: UUID, outcomes: Sequence[TaskOutcome]
) -> KnowledgeProfile:
    """Построить профиль знаний по итогам диагностики."""

    signals: dict[str, list[_SkillSignal]] = defaultdict(list)
    for outcome in outcomes:
        independence = _outcome_independence(outcome)
        understanding = _outcome_understanding(outcome, independence)
        for skill_id in _skill_ids(outcome.task):
            signals[skill_id].append(
                _SkillSignal(
                    independence=independence,
                    understanding=understanding,
                    cognitive_depth=outcome.task.cognitive_depth,
                )
            )

    skills = {
        skill_id: _build_skill_assessment(skill_id, items)
        for skill_id, items in sorted(signals.items())
    }

    strengths, weaknesses, needs_review = _classify(skills)

    return KnowledgeProfile(
        student_id=student_id,
        skills=skills,
        strengths=strengths,
        weaknesses=weaknesses,
        needs_review=needs_review,
    )


def build_roadmap_steps(profile: KnowledgeProfile) -> list[RoadmapStep]:
    """Построить короткий детерминированный список шагов по профилю."""

    skills = profile.skills
    steps: list[RoadmapStep] = []
    order = 0

    def add(
        step_type: RoadmapStepType,
        title: str,
        description: str,
        skill_ids: list[str],
        difficulty: Difficulty,
    ) -> None:
        nonlocal order
        steps.append(
            RoadmapStep(
                id=uuid4(),
                order=order,
                step_type=step_type,
                title=title,
                description=description,
                skill_ids=sorted(skill_ids),
                difficulty=difficulty,
            )
        )
        order += 1

    study = [
        skill_id
        for skill_id, assessment in skills.items()
        if assessment.mastery in {MasteryLevel.NOVICE, MasteryLevel.UNKNOWN}
    ]
    developing = [
        skill_id
        for skill_id, assessment in skills.items()
        if assessment.mastery == MasteryLevel.DEVELOPING
    ]
    strong = [
        skill_id
        for skill_id, assessment in skills.items()
        if assessment.mastery in _STRONG_MASTERY
    ]

    if study:
        add(
            RoadmapStepType.STUDY,
            "Разобрать основы",
            "Изучить базовые темы, где освоение минимально.",
            study,
            Difficulty.EASY,
        )
    if developing:
        add(
            RoadmapStepType.PRACTICE,
            "Потренировать навыки",
            "Отработать темы, которые освоены частично.",
            developing,
            Difficulty.MEDIUM,
        )
    if strong:
        add(
            RoadmapStepType.TRANSFER,
            "Задачи на перенос",
            "Применить сильные навыки в новых контекстах.",
            strong,
            Difficulty.HARD,
        )

    return steps


def build_recommendation_drafts(
    profile: KnowledgeProfile,
) -> list[RecommendationDraft]:
    """Построить черновики объяснимых рекомендаций (действие + навыки)."""

    drafts: list[RecommendationDraft] = []
    for skill_id, assessment in sorted(profile.skills.items()):
        if assessment.mastery in {MasteryLevel.NOVICE, MasteryLevel.UNKNOWN}:
            action = f"Повторить тему {skill_id}"
        elif assessment.mastery == MasteryLevel.DEVELOPING:
            action = f"Допрактиковать тему {skill_id}"
        elif assessment.independence < _STRENGTH_INDEPENDENCE:
            action = f"Решать задачи по теме {skill_id} без подсказок"
        else:
            action = f"Дать задачу на перенос по теме {skill_id}"
        drafts.append(RecommendationDraft(action=action, skill_ids=[skill_id]))
    return drafts


def _outcome_independence(outcome: TaskOutcome) -> float:
    if outcome.assessment is not None:
        return outcome.assessment.independence
    penalty = sum(hint.independence_penalty for hint in outcome.hints)
    return max(0.0, min(1.0, 1.0 - penalty))


def _outcome_understanding(outcome: TaskOutcome, independence: float) -> MasteryLevel:
    if outcome.assessment is not None:
        return outcome.assessment.understanding
    return _understanding_from_correctness(outcome.answer.is_correct, independence)


def _understanding_from_correctness(
    is_correct: bool | None, independence: float
) -> MasteryLevel:
    if is_correct is None:
        return MasteryLevel.UNKNOWN
    if is_correct is False:
        return MasteryLevel.NOVICE
    if independence >= _EXPERT_INDEPENDENCE:
        return MasteryLevel.EXPERT
    if independence >= _PROFICIENT_INDEPENDENCE:
        return MasteryLevel.PROFICIENT
    if independence >= _DEVELOPING_INDEPENDENCE:
        return MasteryLevel.DEVELOPING
    return MasteryLevel.NOVICE


def _skill_ids(task: Task) -> list[str]:
    """Навыки задачи; при пустом ``topic_ids`` используется дисциплина."""

    if task.topic_ids:
        return list(task.topic_ids)
    return [task.discipline.value]


def _build_skill_assessment(
    skill_id: str, items: Sequence[_SkillSignal]
) -> SkillAssessment:
    independence = round(sum(item.independence for item in items) / len(items), 4)
    mastery = min(
        items, key=lambda item: _LEVEL_ORDER[item.understanding]
    ).understanding
    cognitive_depth = max(
        items, key=lambda item: _COGNITIVE_ORDER[item.cognitive_depth]
    ).cognitive_depth

    return SkillAssessment(
        skill_id=skill_id,
        mastery=mastery,
        cognitive_depth=cognitive_depth,
        independence=independence,
        evidence_count=len(items),
    )


def _classify(
    skills: dict[str, SkillAssessment],
) -> tuple[list[str], list[str], list[str]]:
    strengths: list[str] = []
    weaknesses: list[str] = []
    needs_review: list[str] = []

    for skill_id, assessment in sorted(skills.items()):
        if (
            assessment.mastery in _STRONG_MASTERY
            and assessment.independence >= _STRENGTH_INDEPENDENCE
        ):
            strengths.append(skill_id)
        if assessment.mastery in _WEAK_MASTERY or (
            assessment.independence < _DEVELOPING_INDEPENDENCE
        ):
            weaknesses.append(skill_id)
        if assessment.mastery in _WEAK_MASTERY:
            needs_review.append(skill_id)

    return strengths, weaknesses, needs_review
