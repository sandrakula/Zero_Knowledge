"""ZEROK-6 service tests."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from zero_knowledge.learning_path import (
    LearningPathAttemptsExhaustedError,
    LearningPathInvalidError,
    LearningPathService,
)
from zero_knowledge.schemas import KnowledgeProfile
from zero_knowledge.task_generation import ProviderUnavailableError


class QueueProvider:
    def __init__(self, *responses: str | Exception) -> None:
        self.responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        assert "Canonical" in prompt
        self.calls += 1
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


def test_profile_and_roadmap_use_canonical_schemas() -> None:
    student_id = uuid4()
    profile_id = uuid4()
    provider = QueueProvider(
        json.dumps(
            {
                "id": str(profile_id),
                "student_id": str(student_id),
                "skills": {
                    "python.io": {
                        "skill_id": "python.io",
                        "mastery": "proficient",
                        "cognitive_depth": "application",
                        "independence": 1,
                        "application": 0.8,
                        "evidence_count": 3,
                    }
                },
                "strengths": ["python.io"],
            }
        ),
        json.dumps(
            {
                "student_id": str(student_id),
                "goal": "Improve Python",
                "based_on_profile_id": str(profile_id),
                "steps": [
                    {
                        "id": str(uuid4()),
                        "order": 0,
                        "step_type": "practice",
                        "title": "Practise input/output",
                        "difficulty": "easy",
                    }
                ],
            }
        ),
    )
    service = LearningPathService(provider)

    profile = service.build_profile(student_id, "Three correct solutions")
    roadmap = service.build_roadmap(
        student_id,
        profile,
        goal="Improve Python",
        assessment_summary="proficient",
    )

    assert isinstance(profile, KnowledgeProfile)
    assert profile.skills["python.io"].mastery.value == "proficient"
    assert roadmap.based_on_profile_id == profile.id
    assert roadmap.steps[0].step_type.value == "practice"


def test_invalid_content_is_bounded() -> None:
    provider = QueueProvider("not json", "{}")
    with pytest.raises(LearningPathAttemptsExhaustedError) as caught:
        LearningPathService(provider, max_attempts=2).build_profile(uuid4(), "evidence")
    assert caught.value.attempts == 2
    assert provider.calls == 2


def test_wrong_student_is_rejected() -> None:
    provider = QueueProvider(json.dumps({"student_id": str(uuid4())}))
    with pytest.raises(LearningPathInvalidError, match="student_id"):
        LearningPathService(provider).build_profile(uuid4(), "evidence")


def test_provider_unavailable_is_not_retried() -> None:
    provider = QueueProvider(ProviderUnavailableError("down"))
    with pytest.raises(ProviderUnavailableError):
        LearningPathService(provider).build_profile(uuid4(), "evidence")
    assert provider.calls == 1
