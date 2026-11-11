from types import SimpleNamespace
from typing import Any

from src.services.ai.explanations import _level_for, _public_examples
from src.services.courses.activities.explanations_grade import (
    combine_with_explanation,
    explanation_weight,
)


def _task(weight: object = 0, max_grade: int = 100):
    return SimpleNamespace(
        contents={"explanation_weight": weight},
        max_grade_value=max_grade,
    )


def _explanation(score=70, status="GRADED") -> Any:
    return SimpleNamespace(ai_score=score, status=status)


class TestExplanationWeight:
    def test_missing_weight_is_off(self):
        assert explanation_weight(SimpleNamespace(contents={})) == 0

    def test_weight_is_clamped(self):
        assert explanation_weight(_task(weight=250)) == 100
        assert explanation_weight(_task(weight=-10)) == 0

    def test_bad_weight_is_ignored(self):
        assert explanation_weight(_task(weight="not-a-number")) == 0


class TestCombineWithExplanation:
    def test_off_keeps_code_grade(self):
        grade, note = combine_with_explanation(_task(0), 80, _explanation(10))
        assert (grade, note) == (80, "")

    def test_missing_explanation_keeps_code_grade(self):
        grade, note = combine_with_explanation(_task(30), 80, None)
        assert (grade, note) == (80, "")

    def test_ungraded_explanation_is_ignored(self):
        grade, note = combine_with_explanation(
            _task(30), 80, _explanation(10, status="PENDING")
        )
        assert (grade, note) == (80, "")

    def test_weighted_average(self):
        grade, note = combine_with_explanation(_task(30), 80, _explanation(70))
        assert grade == 77
        assert "explanation 70" in note

    def test_result_is_clamped_to_task_max(self):
        grade, _ = combine_with_explanation(_task(50, max_grade=100), 100, _explanation(100))
        assert grade == 100

    def test_low_explanation_can_lower_grade(self):
        grade, _ = combine_with_explanation(_task(50), 100, _explanation(0))
        assert grade == 50


class TestAssessmentHelpers:
    def test_level_boundaries(self):
        assert _level_for(100) == "excellent"
        assert _level_for(85) == "excellent"
        assert _level_for(84) == "good"
        assert _level_for(65) == "good"
        assert _level_for(64) == "partial"
        assert _level_for(40) == "partial"
        assert _level_for(39) == "weak"

    def test_public_examples_skip_hidden_and_cap_at_three(self):
        contents = {
            "test_cases": [
                {"stdin": "1", "expectedStdout": "1", "hidden": False},
                {"stdin": "hidden", "expectedStdout": "x", "hidden": True},
                {"stdin": "2", "expectedStdout": "2", "hidden": False},
                {"stdin": "3", "expectedStdout": "3", "hidden": False},
                {"stdin": "4", "expectedStdout": "4", "hidden": False},
            ]
        }
        text = _public_examples(contents)
        assert "hidden" not in text
        assert text.count("Input:") == 3
