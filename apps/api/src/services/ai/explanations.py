"""AI assessment of a learner's explanation of their own CODE solution."""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.services.ai.llm import generate, model_for_tier

logger = logging.getLogger(__name__)

MAX_EXPLANATION_CHARS = 5000
MAX_CODE_CHARS = 20000
MAX_PROMPT_EXAMPLES = 3

SYSTEM_PROMPT = """You are an experienced programming teacher assessing whether a student understands their own solution.

You receive the task statement, the student's source code, and the student's explanation of that code. Judge the explanation against the code and the task. Do not require a specific writing style.

Rubric (total 100):
- Approach and correctness of the described idea: 40
- Key implementation steps are actually covered: 25
- Edge cases, constraints, and complexity are considered: 20
- Clarity and precision: 15

Scoring guidance:
- 85-100: accurate, complete, shows real understanding.
- 65-84: mostly correct, misses a meaningful detail.
- 40-64: partially correct, vague, or contains a misconception.
- 0-39: wrong, empty, or restates the code without explaining it.

Rules:
- Never provide a full corrected solution. Point at what is missing and ask a guiding question.
- Feedback must be constructive, specific, and short (2-4 sentences).
- List at most 4 strengths and at most 4 gaps, each one short phrase.
- Reply in the language of the student's explanation.
- If the explanation is off-topic, say so and score it low."""


class ExplanationAssessment(BaseModel):
    score: int = Field(ge=0, le=100)
    level: Literal["weak", "partial", "good", "excellent"]
    feedback: str = Field(min_length=1, max_length=4000)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


def _clip(value: object, limit: int) -> str:
    text = "" if value is None else str(value)
    return text[:limit]


def _public_examples(contents: dict[str, Any]) -> str:
    cases = contents.get("test_cases") or []
    if not isinstance(cases, list):
        return ""
    lines: list[str] = []
    for case in cases:
        if not isinstance(case, dict) or case.get("hidden"):
            continue
        stdin = _clip(case.get("stdin"), 400)
        expected = _clip(case.get("expectedStdout") or case.get("expected_stdout"), 400)
        lines.append(f"Input:\n{stdin}\nExpected output:\n{expected}")
        if len(lines) >= MAX_PROMPT_EXAMPLES:
            break
    return "\n\n".join(lines)


def _build_user_prompt(
    *,
    task_title: str,
    task_description: str,
    task_hint: str,
    contents: dict[str, Any],
    source_code: str,
    explanation: str,
) -> str:
    parts = [
        f"Task title: {_clip(task_title, 300)}",
        f"Task statement:\n{_clip(task_description, 4000)}",
    ]
    if task_hint:
        parts.append(f"Hint shown to the student:\n{_clip(task_hint, 1500)}")
    examples = _public_examples(contents)
    if examples:
        parts.append(f"Public examples:\n{examples}")
    parts.append(f"Student's code:\n```\n{_clip(source_code, MAX_CODE_CHARS)}\n```")
    parts.append(f"Student's explanation:\n{_clip(explanation, MAX_EXPLANATION_CHARS)}")
    return "\n\n".join(parts)


def _level_for(score: int) -> str:
    if score >= 85:
        return "excellent"
    if score >= 65:
        return "good"
    if score >= 40:
        return "partial"
    return "weak"


async def assess_explanation(
    *,
    task_title: str,
    task_description: str,
    task_hint: str,
    contents: dict[str, Any],
    source_code: str,
    explanation: str,
    model_name: str | None = None,
) -> dict[str, Any]:
    """Return a normalized assessment dict for storage."""
    result: ExplanationAssessment = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=_build_user_prompt(
            task_title=task_title,
            task_description=task_description,
            task_hint=task_hint,
            contents=contents,
            source_code=source_code,
            explanation=explanation,
        ),
        system_prompt=SYSTEM_PROMPT,
        output_type=ExplanationAssessment,
        max_tokens=900,
        temperature=0.2,
        timeout=60.0,
    )
    score = max(0, min(int(result.score), 100))
    return {
        "score": score,
        "level": _level_for(score),
        "feedback": result.feedback.strip(),
        "strengths": [s.strip() for s in result.strengths if s and s.strip()][:4],
        "gaps": [g.strip() for g in result.gaps if g and g.strip()][:4],
    }
