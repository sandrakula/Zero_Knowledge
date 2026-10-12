"""Демо ZEROK-6: профиль знаний и roadmap по итогам диагностики.

Работает без ключа DeepSeek: поясняющий текст отдаёт детерминированный
FakeProvider. С флагом ``--live`` и ключом ``DEEPSEEK_API_KEY`` используется
реальный ``DeepSeekClient``.

Запуск:

    python scripts/demo_profile_roadmap.py
    python scripts/demo_profile_roadmap.py --live
"""

from __future__ import annotations

import argparse
import json
from uuid import UUID

from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.profile import ProfileRoadmapService, TaskOutcome
from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    CognitiveDepth,
    Difficulty,
    Discipline,
    Hint,
    HintLevel,
    Task,
    TaskType,
)

STUDENT_ID = UUID("00000000-0000-4000-8000-000000000001")
GOAL = "Подготовка к собеседованию по алгоритмам"


class FakeProvider:
    """Детерминированный провайдер для запуска без ключа."""

    def __init__(self) -> None:
        self._next = 0

    def generate(self, prompt: str) -> str:
        del prompt
        self._next += 1
        return json.dumps(
            {
                "profile_summary": (
                    "Студент уверенно решает простые задачи по рекурсии без "
                    "подсказок, но на сложной задаче опирался на полную "
                    "подсказку, поэтому самостоятельность по рекурсии низкая. "
                    "Сортировки решены с подсказкой — тема освоена частично."
                ),
                "recommendation_rationales": [
                    "Простые задачи по рекурсии решены верно, но сложная "
                    "потребовала полной подсказки — сначала закрепить базу.",
                    "Сортировки решены с подсказкой — нужна практика без "
                    "подсказок.",
                ],
            }
        )


def _task(topic: str, difficulty: Difficulty) -> Task:
    return Task(
        title="diagnostic",
        discipline=Discipline.ALGORITHMS,
        task_type=TaskType.PROGRAMMING,
        statement="read stdin and print it",
        difficulty=difficulty,
        cognitive_depth=CognitiveDepth.APPLICATION,
        topic_ids=[topic],
    )


def _answer(task: Task, is_correct: bool) -> Answer:
    return Answer(
        task_id=task.id,
        student_id=STUDENT_ID,
        format=AnswerFormat.TEXT,
        content="solution",
        is_correct=is_correct,
    )


def _hint(task: Task, penalty: float) -> Hint:
    return Hint(
        task_id=task.id,
        level=HintLevel.FULL_EXPLANATION,
        content="hint",
        independence_penalty=penalty,
    )


def _build_outcomes() -> list[TaskOutcome]:
    easy = _task("recursion", Difficulty.EASY)
    hard = _task("recursion", Difficulty.HARD)
    sorting = _task("sorting", Difficulty.MEDIUM)

    return [
        # easy recursion, верно, без подсказок -> expert / independence 1.0
        TaskOutcome(task=easy, answer=_answer(easy, True), hints=[]),
        # hard recursion, верно, но с полной подсказкой -> novice / independence 0.0
        TaskOutcome(
            task=hard,
            answer=_answer(hard, True),
            hints=[_hint(hard, 1.0)],
        ),
        # sorting, верно, с подсказкой 0.5 -> developing / independence 0.5
        TaskOutcome(
            task=sorting,
            answer=_answer(sorting, True),
            hints=[_hint(sorting, 0.5)],
        ),
    ]


def _run(provider: object) -> None:
    service = ProfileRoadmapService(provider)
    result = service.build(STUDENT_ID, GOAL, _build_outcomes())

    print("Резюме профиля (LLM):")
    print(f"  {result.profile_summary}\n")

    print("Профиль знаний:")
    for skill_id, assessment in result.profile.skills.items():
        print(
            f"  {skill_id}: mastery={assessment.mastery.value}, "
            f"independence={assessment.independence}, "
            f"evidence={assessment.evidence_count}"
        )
    print(f"  strengths    = {result.profile.strengths or '—'}")
    print(f"  weaknesses   = {result.profile.weaknesses or '—'}")
    print(f"  needs_review = {result.profile.needs_review or '—'}\n")

    print("Roadmap:")
    for step in result.roadmap.steps:
        print(
            f"  [{step.order}] {step.step_type.value} ({step.difficulty.value}): "
            f"{step.title} -> навыки={step.skill_ids}"
        )
    print()

    print("Рекомендации:")
    for recommendation in result.roadmap.recommendations:
        print(f"  • {recommendation.action}")
        print(f"      почему: {recommendation.rationale}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live",
        action="store_true",
        help="использовать реальный DeepSeekClient (нужен DEEPSEEK_API_KEY)",
    )
    args = parser.parse_args()

    provider = DeepSeekClient() if args.live else FakeProvider()
    try:
        _run(provider)
    finally:
        if isinstance(provider, DeepSeekClient):
            provider.close()


if __name__ == "__main__":
    main()
