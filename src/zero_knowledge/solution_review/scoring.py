"""Детерминированная оценка понимания по решению студента.

Оценка учитывает правильность ответа и факт/уровень использованных подсказок
(п. 25–26 спецификации): верный ответ с полными подсказками не равен
самостоятельному владению материалом.
"""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import (
    Answer,
    Hint,
    HintUsage,
    MasteryLevel,
    UnderstandingAssessment,
)

_EXPERT_INDEPENDENCE = 0.95
_PROFICIENT_INDEPENDENCE = 0.8
_DEVELOPING_INDEPENDENCE = 0.4


def compute_independence(hints: Sequence[Hint]) -> float:
    """Самостоятельность как ``1 - сумма штрафов подсказок``, в диапазоне [0, 1]."""

    penalty = sum(hint.independence_penalty for hint in hints)
    return max(0.0, min(1.0, 1.0 - penalty))


def assess_understanding(
    answer: Answer, hints: Sequence[Hint]
) -> UnderstandingAssessment:
    """Построить оценку понимания из корректности ответа и использованных подсказок."""

    independence = compute_independence(hints)
    understanding = _understanding_level(answer.is_correct, independence)
    return UnderstandingAssessment(
        is_correct=answer.is_correct,
        independence=round(independence, 4),
        understanding=understanding,
        hints_used=_hint_usage(hints),
        rationale=_build_rationale(answer, hints, independence, understanding),
    )


def _hint_usage(hints: Sequence[Hint]) -> list[HintUsage]:
    return [
        HintUsage(
            hint_id=hint.id,
            level=hint.level,
            independence_penalty=hint.independence_penalty,
        )
        for hint in hints
    ]


def _understanding_level(is_correct: bool | None, independence: float) -> MasteryLevel:
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


def _build_rationale(
    answer: Answer,
    hints: Sequence[Hint],
    independence: float,
    understanding: MasteryLevel,
) -> str:
    if answer.is_correct is True:
        correctness = "верно"
    elif answer.is_correct is False:
        correctness = "неверно"
    else:
        correctness = "корректность не определена"

    if hints:
        levels = ", ".join(hint.level.value for hint in hints)
        hint_text = f"использовано подсказок {len(hints)} ({levels})"
    else:
        hint_text = "подсказки не использованы"

    return (
        f"Ответ: {correctness}. {hint_text}. "
        f"Самостоятельность: {independence:.2f}. Понимание: {understanding.value}."
    )
