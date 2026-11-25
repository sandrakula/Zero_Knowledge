"""Pure adaptive-practice math: mastery, reviews and feed selection."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.services.practice import adaptive


NOW = datetime(2026, 11, 24, 12, 0, 0)


def test_sigmoid_and_logit_roundtrip() -> None:
    for value in (-3.0, -1.0, 0.0, 1.0, 3.0):
        assert abs(adaptive.logit(adaptive.sigmoid(value)) - value) < 1e-6


def test_single_perfect_attempt_is_helpful_but_not_overconfident() -> None:
    mastery, confidence = adaptive.weighted_mastery([(1.0, 1.0, NOW)], NOW)
    assert 0.6 < mastery < 0.7
    assert 0.2 < confidence < 0.35


def test_repeated_perfect_attempts_build_mastery() -> None:
    observations = [(1.0, 1.0, NOW) for _ in range(5)]
    mastery, confidence = adaptive.weighted_mastery(observations, NOW)
    assert mastery > 0.85
    assert confidence > 0.75


def test_old_success_decays_towards_prior() -> None:
    recent_success = adaptive.weighted_mastery([(1.0, 1.0, NOW)], NOW)[0]
    old_success = adaptive.weighted_mastery(
        [(1.0, 1.0, NOW - timedelta(days=120))], NOW
    )[0]
    assert old_success < recent_success
    assert old_success < 0.55


def test_empty_observations_mean_zero_mastery() -> None:
    assert adaptive.weighted_mastery([], NOW) == (0.0, 0.0)


def test_next_review_schedule() -> None:
    assert adaptive.next_review_days(0.4, True) == 1
    assert adaptive.next_review_days(0.6, True) == 3
    assert adaptive.next_review_days(0.8, True) == 10
    assert adaptive.next_review_days(0.9, True) == 30
    assert adaptive.next_review_days(0.97, True) == 90
    assert adaptive.next_review_days(0.97, False) == 1


def test_expected_success_for_new_learner_is_near_half() -> None:
    assert 0.4 < adaptive.expected_success(0.0, -1.0, 0.0) < 0.6
    assert adaptive.expected_success(0.95, 1.0, 1.0) > 0.8


def _candidate(**overrides) -> adaptive.Candidate:
    values = dict(
        task_uuid="task_1",
        topic_key="topic_a",
        level=1,
        difficulty=-1.0,
        mastery=0.0,
        confidence=0.0,
        attempts=0,
        next_review_at="",
        prereq_ready=True,
        task_type="CODE",
    )
    values.update(overrides)
    return adaptive.Candidate(**values)


def test_feed_skips_topics_whose_prerequisites_are_not_ready() -> None:
    candidates = [
        _candidate(task_uuid="ready", topic_key="a"),
        _candidate(task_uuid="blocked", topic_key="b", prereq_ready=False),
    ]
    picks = adaptive.select_feed(candidates, limit=5, now=NOW, strict_prereq=True)
    assert [pick.candidate.task_uuid for pick in picks] == ["ready"]

    relaxed = adaptive.select_feed(
        candidates, limit=5, now=NOW, strict_prereq=False
    )
    assert {pick.candidate.task_uuid for pick in relaxed} == {"ready", "blocked"}


def test_feed_due_review_beats_a_new_easy_task() -> None:
    candidates = [
        _candidate(task_uuid="new", topic_key="a"),
        _candidate(
            task_uuid="review",
            topic_key="b",
            level=2,
            difficulty=0.0,
            mastery=0.7,
            confidence=0.6,
            attempts=3,
            next_review_at=(NOW - timedelta(days=2)).isoformat(),
        ),
    ]
    picks = adaptive.select_feed(candidates, limit=2, now=NOW)
    assert picks[0].candidate.task_uuid == "review"
    assert picks[0].reason == "review"


def test_feed_caps_tasks_per_topic_and_is_deterministic() -> None:
    candidates = [
        _candidate(task_uuid=f"a{index}", topic_key="a") for index in range(5)
    ] + [_candidate(task_uuid="b1", topic_key="b")]
    first = adaptive.select_feed(candidates, limit=2, now=NOW, max_per_topic=2)
    second = adaptive.select_feed(
        list(reversed(candidates)), limit=2, now=NOW, max_per_topic=2
    )
    assert len(first) == 2
    assert all(pick.candidate.topic_key == "a" for pick in first)
    assert [pick.candidate.task_uuid for pick in first] == [
        pick.candidate.task_uuid for pick in second
    ]


def test_short_course_fills_the_daily_feed_from_one_topic() -> None:
    candidates = [
        _candidate(task_uuid=f"a{index}", topic_key="a") for index in range(5)
    ]
    picks = adaptive.select_feed(candidates, limit=5, now=NOW, max_per_topic=2)
    assert len(picks) == 5
    assert len({pick.candidate.task_uuid for pick in picks}) == 5


def test_mastered_topics_are_not_served_without_a_review_date() -> None:
    candidates = [
        _candidate(
            task_uuid="mastered",
            mastery=0.95,
            confidence=0.9,
            attempts=10,
        )
    ]
    assert adaptive.select_feed(candidates, limit=5, now=NOW) == []


def test_solved_task_waits_for_its_review_date() -> None:
    future = _candidate(
        task_uuid="solved",
        mastery=0.7,
        confidence=0.6,
        attempts=2,
        last_passed=True,
        next_review_at=(NOW + timedelta(days=10)).isoformat(),
    )
    assert adaptive.select_feed([future], limit=5, now=NOW) == []

    due = _candidate(
        task_uuid="solved",
        mastery=0.7,
        confidence=0.6,
        attempts=2,
        last_passed=True,
        next_review_at=(NOW - timedelta(days=1)).isoformat(),
    )
    picks = adaptive.select_feed([due], limit=5, now=NOW)
    assert [pick.reason for pick in picks] == ["review"]


def test_xp_grows_with_level() -> None:
    assert adaptive.xp_for_level(1) == 10
    assert adaptive.xp_for_level(2) == 15
    assert adaptive.xp_for_level(3) == 20
