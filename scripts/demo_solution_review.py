"""Разобрать решение студента: AI-вопросы + оценка понимания."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from zero_knowledge.llm import DeepSeekClient
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
from zero_knowledge.solution_review import (
    SolutionReviewAttemptsExhaustedError,
    SolutionReviewService,
)
from zero_knowledge.task_generation.errors import ProviderUnavailableError


def main() -> int:
    task = Task(
        title="Count tree nodes",
        discipline=Discipline.ALGORITHMS,
        task_type=TaskType.PROGRAMMING,
        statement=(
            "Write a function count_nodes(root) that returns the number of "
            "nodes in a binary tree."
        ),
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )
    answer = Answer(
        task_id=task.id,
        student_id=uuid4(),
        format=AnswerFormat.CODE,
        content=(
            "def count_nodes(root):\n"
            "    if root is None:\n"
            "        return 0\n"
            "    return 1 + count_nodes(root.left) + count_nodes(root.right)"
        ),
        is_correct=True,
    )
    hints = [
        Hint(
            task_id=task.id,
            level=HintLevel.FULL_EXPLANATION,
            content="Every subtree contributes 1 plus its children.",
            independence_penalty=0.8,
        ),
        Hint(
            task_id=task.id,
            level=HintLevel.NUDGE,
            content="Think about the empty tree.",
            independence_penalty=0.1,
        ),
    ]

    client = DeepSeekClient()
    service = SolutionReviewService(client, max_attempts=3)

    try:
        review = service.review(task, answer, hints)
    except ProviderUnavailableError as error:
        print(f"Solution review unavailable: {error}", file=sys.stderr)
        return 2
    except SolutionReviewAttemptsExhaustedError as error:
        print(f"Questions did not pass validation: {error}", file=sys.stderr)
        print(f"Attempts used: {service.attempts_used}", file=sys.stderr)
        return 3
    finally:
        client.close()

    print("=== QUESTIONS ===")
    for question in review.questions:
        print(f"{question.order + 1}. [{question.kind.value}] {question.text}")
        if question.target:
            print(f"   target: {question.target}")
        if question.rationale:
            print(f"   why: {question.rationale}")

    assessment = review.assessment
    print("\n=== ASSESSMENT ===")
    print(f"Correct: {assessment.is_correct}")
    print(f"Independence: {assessment.independence:.2f}")
    print(f"Understanding: {assessment.understanding.value}")
    print(f"Hints used: {len(assessment.hints_used)}")
    for usage in assessment.hints_used:
        print(f"  - {usage.level.value} (penalty {usage.independence_penalty})")
    print(f"Rationale: {assessment.rationale}")

    print("\n========================")
    print("Questions: SUCCESS" if review.questions else "Questions: EMPTY")
    print("Assessment: SUCCESS")
    print(f"Attempts used: {service.attempts_used}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
