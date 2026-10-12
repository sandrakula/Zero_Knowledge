"""Промпт для генерации поясняющего текста профиля и roadmap (LLM)."""

from __future__ import annotations

from collections.abc import Sequence

from zero_knowledge.schemas import KnowledgeProfile, RoadmapStep

from .heuristics import RecommendationDraft


def build_explanation_prompt(
    profile: KnowledgeProfile,
    steps: Sequence[RoadmapStep],
    drafts: Sequence[RecommendationDraft],
    goal: str,
) -> str:
    """Построить промпт: краткое резюме профиля и rationale к каждой рекомендации."""

    skills_text = _format_skills(profile)
    lists_text = _format_lists(profile)
    steps_text = _format_steps(steps)
    drafts_text = _format_drafts(drafts)

    return (
        "You are an educational tutor explaining a learner's knowledge profile "
        "and next steps. Write concise, specific Russian explanations that name "
        "concrete skills and avoid generic phrases.\n\n"
        f"Learning goal: {goal}\n\n"
        f"Knowledge profile:\n{skills_text}\n"
        f"{lists_text}\n"
        f"Planned roadmap steps:\n{steps_text}\n"
        f"Planned recommendations (keep this exact order):\n{drafts_text}\n\n"
        "Return exactly one JSON object and nothing else (no Markdown, no prose) "
        "of the form:\n"
        '{"profile_summary": "<2-4 sentence explanation of the profile>", '
        '"recommendation_rationales": ["<why recommendation 1>", '
        '"<why recommendation 2>", ...]}\n\n'
        f"recommendation_rationales must contain exactly {len(drafts)} strings "
        "in the same order as the planned recommendations. Return JSON only."
    )


def _format_skills(profile: KnowledgeProfile) -> str:
    lines = []
    for skill_id, assessment in sorted(profile.skills.items()):
        lines.append(
            f"- {skill_id}: mastery={assessment.mastery.value}, "
            f"independence={assessment.independence:.2f}, "
            f"evidence={assessment.evidence_count}"
        )
    return "\n".join(lines) if lines else "(no skills)"


def _format_lists(profile: KnowledgeProfile) -> str:
    return (
        f"Strengths: {', '.join(profile.strengths) or 'none'}\n"
        f"Weaknesses: {', '.join(profile.weaknesses) or 'none'}\n"
        f"Needs review: {', '.join(profile.needs_review) or 'none'}"
    )


def _format_steps(steps: Sequence[RoadmapStep]) -> str:
    lines = []
    for step in steps:
        skills = ", ".join(step.skill_ids) or "all"
        lines.append(
            f"- {step.step_type.value} ({step.difficulty.value}): "
            f"{step.title} [skills: {skills}]"
        )
    return "\n".join(lines) if lines else "(no steps)"


def _format_drafts(drafts: Sequence[RecommendationDraft]) -> str:
    lines = []
    for index, draft in enumerate(drafts, start=1):
        skills = ", ".join(draft.skill_ids) or "all"
        lines.append(f"{index}. {draft.action} [skills: {skills}]")
    return "\n".join(lines) if lines else "(no recommendations)"
