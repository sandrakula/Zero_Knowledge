"""Combine a CODE task's test grade with the learner's explanation score."""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.task_explanations import TaskExplanation


def explanation_weight(task) -> int:
    contents = task.contents or {}
    raw = contents.get("explanation_weight") or 0
    try:
        weight = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, min(weight, 100))


def combine_with_explanation(task, code_grade: int, explanation: TaskExplanation | None) -> tuple[int, str]:
    """Return (grade, note). Without a graded explanation the code grade is kept."""
    weight = explanation_weight(task)
    if weight <= 0 or explanation is None or explanation.status != "GRADED":
        return int(code_grade), ""
    if explanation.ai_score is None:
        return int(code_grade), ""
    score = max(0, min(int(explanation.ai_score), 100))
    combined = round(int(code_grade) * (100 - weight) / 100 + score * weight / 100)
    max_grade = int(task.max_grade_value or 100)
    combined = max(0, min(combined, max_grade))
    note = f" (code {int(code_grade)} x {100 - weight}% + explanation {score} x {weight}%)"
    return combined, note


async def latest_graded_explanation(
    db_session: AsyncSession, task_id: int, user_id: int
) -> TaskExplanation | None:
    return (
        await db_session.execute(
            select(TaskExplanation).where(
                TaskExplanation.assignment_task_id == task_id,
                TaskExplanation.user_id == user_id,
                TaskExplanation.status == "GRADED",
            )
        )
    ).scalars().first()
