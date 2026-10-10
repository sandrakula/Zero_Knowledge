"""Промпт для генерации вопросов AI к решению студента."""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import Answer, Hint, SolutionQuestionKind, Task


def build_solution_questions_prompt(
    task: Task, answer: Answer, hints: Sequence[Hint]
) -> str:
    """Построить промпт, который просит диагностические вопросы по решению."""

    kinds = ", ".join(kind.value for kind in SolutionQuestionKind)
    answer_text = answer.content.strip() or " ".join(answer.chosen_options)
    hint_text = _format_hints(hints)

    return (
        "You are a Socratic tutor. A student submitted the solution below. Ask "
        "3-5 diagnostic questions that help the student find and fix their own "
        "mistakes instead of revealing the answer.\n\n"
        f"Task:\n{task.statement}\n\n"
        f"Student answer:\n{answer_text}\n\n"
        f"Used hints: {hint_text}\n\n"
        'Return exactly one JSON object and nothing else (no Markdown, no prose) '
        "of the form:\n"
        '{"questions": [{"kind": "<value>", "text": "<question>", '
        '"target": "<step or line, or empty string>", '
        '"rationale": "<why this question>"}]}\n\n'
        f'Allowed "kind" values: {kinds}.\n'
        'Every question requires "kind" and "text"; "target" and "rationale" are '
        "optional. Do not include an order field. Return JSON only."
    )


def _format_hints(hints: Sequence[Hint]) -> str:
    if not hints:
        return "none"
    return "; ".join(
        f"{hint.level.value} (independence_penalty={hint.independence_penalty})"
        for hint in hints
    )
