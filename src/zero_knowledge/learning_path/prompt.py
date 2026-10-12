"""Prompts derived from the canonical ZEROK-2 schemas."""

from __future__ import annotations

import json
from uuid import UUID

from zero_knowledge.schemas import KnowledgeProfile, Roadmap


def _schema_json(model: type[KnowledgeProfile | Roadmap]) -> str:
    return json.dumps(
        model.model_json_schema(), ensure_ascii=False, separators=(",", ":")
    )


def build_profile_prompt(student_id: UUID, observations: str) -> str:
    return (
        "Build a preliminary knowledge profile from the diagnostic observations below. "
        "Use only evidence present in the observations. Cover the demonstrated skills, "
        "and do not invent successful results, hint usage, or misconceptions. Return "
        "exactly one JSON object and no Markdown. Use student_id="
        f"{student_id}. Use only enum values from the schema.\n\n"
        f"Observations:\n{observations}\n\n"
        "Canonical KnowledgeProfile JSON Schema:\n" + _schema_json(KnowledgeProfile)
    )


def build_roadmap_prompt(
    student_id: UUID,
    profile: KnowledgeProfile,
    *,
    goal: str,
    assessment_summary: str,
) -> str:
    profile_json = profile.model_dump_json(
        exclude={"misconceptions": {"__all__": {"student_id"}}}
    )
    return (
        "Build a concise personal learning roadmap from the validated knowledge profile "
        "and assessment summary below. Produce 3-5 ordered steps and explainable "
        "recommendations. Return exactly one JSON object and no Markdown. Use "
        f"student_id={student_id}, based_on_profile_id={profile.id}, and goal={goal!r}. "
        "Use only enum values from the schema.\n\n"
        f"Assessment summary:\n{assessment_summary}\n\n"
        f"Knowledge profile:\n{profile_json}\n\n"
        "Canonical Roadmap JSON Schema:\n" + _schema_json(Roadmap)
    )
