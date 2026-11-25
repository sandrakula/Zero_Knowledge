"""Explainable adaptive practice math.

Everything here is pure: no database, no clock of its own. The caller passes
``now`` so the day a learner studies is reproducible in tests.

The model is deliberately simple and inspectable:

* a learner's mastery of a topic is a recency-weighted average of graded
  attempts (half-life 21 days by default), shrunk towards 0.5 while there are
  few observations;
* a task's difficulty comes from the share of learners who passed it, with a
  cold-start prior from its level (L1 easy, L2 normal, L3 hard);
* the next task is chosen so the predicted chance of success sits around
  0.65..0.80 (desirable difficulty), with bonuses for overdue reviews, weak
  topics and a small stretch above the current level.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Optional, Sequence

DEFAULT_HALF_LIFE_DAYS = 21.0
DEFAULT_PRIOR = 0.5
DEFAULT_CONFIDENCE_SCALE = 3.0
TARGET_SUCCESS = 0.72
MASTERY_CEILING = 0.9
STRETCH_FLOOR = 0.55

LEVEL_PRIOR_DIFFICULTY = {1: -1.0, 2: 0.0, 3: 1.0}

# How much a signal is trusted when it updates mastery. Auto-checked code is
# the cleanest; a human grade is noisier and arrives later.
RELIABILITY = {
    "CODE": 1.0,
    "QUIZ": 0.9,
    "SHORT_ANSWER": 0.85,
    "NUMBER_ANSWER": 0.85,
    "FORM": 0.7,
    "FILE_SUBMISSION": 0.6,
    "CUSTOM": 0.6,
    "OTHER": 0.6,
}
DEFAULT_RELIABILITY = 0.6


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    exp_x = math.exp(x)
    return exp_x / (1.0 + exp_x)


def logit(p: float) -> float:
    p = clamp(p, 0.001, 0.999)
    return math.log(p / (1.0 - p))


def parse_dt(value: str | datetime | None) -> Optional[datetime]:
    """Parse the ISO strings used across the LMS; tolerate empty/broken ones."""
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        try:
            dt = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
        except (TypeError, ValueError):
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def level_prior(level: int | None) -> float:
    return LEVEL_PRIOR_DIFFICULTY.get(int(level or 1), 0.0)


def reliability_for(task_type: str | None) -> float:
    if not task_type:
        return DEFAULT_RELIABILITY
    key = str(task_type).split(".")[-1].upper()
    return RELIABILITY.get(key, DEFAULT_RELIABILITY)


def mastery_level(mastery: float) -> int:
    if mastery < 0.4:
        return 1
    if mastery < 0.75:
        return 2
    return 3


def weighted_mastery(
    observations: Iterable[tuple[float, float, datetime]],
    now: datetime,
    *,
    half_life_days: float = DEFAULT_HALF_LIFE_DAYS,
    prior: float = DEFAULT_PRIOR,
    confidence_scale: float = DEFAULT_CONFIDENCE_SCALE,
) -> tuple[float, float]:
    """Return ``(mastery, confidence)`` for a topic.

    ``observations`` are ``(score 0..1, reliability 0..1, graded_at)``. Older
    attempts weigh less; few attempts pull the result back towards ``prior``.
    """
    total_weight = 0.0
    weighted_score = 0.0
    half_life = max(0.5, float(half_life_days))
    for score, reliability, graded_at in observations:
        age_days = max(0.0, (now - graded_at).total_seconds() / 86400.0)
        weight = clamp(float(reliability), 0.05, 1.0) * (
            0.5 ** (age_days / half_life)
        )
        total_weight += weight
        weighted_score += weight * clamp(float(score))
    if total_weight <= 0:
        return 0.0, 0.0
    raw = weighted_score / total_weight
    confidence = 1.0 - math.exp(-total_weight / max(0.1, confidence_scale))
    mastery = prior + (raw - prior) * confidence
    return clamp(mastery), clamp(confidence)


def next_review_days(mastery: float, passed: bool) -> int:
    """Spacing schedule after one graded attempt."""
    if not passed or mastery < 0.5:
        return 1
    if mastery < 0.7:
        return 3
    if mastery < 0.85:
        return 10
    if mastery < 0.95:
        return 30
    return 90


def next_review_at(mastery: float, passed: bool, now: datetime) -> str:
    return iso(now + timedelta(days=next_review_days(mastery, passed)))


def expected_success(mastery: float, difficulty: float, confidence: float = 1.0) -> float:
    """Predicted chance of solving a task.

    A learner with thin evidence is pulled towards the neutral ability 0, so a
    brand-new account is not immediately served the hardest tasks.
    """
    ability = logit(clamp(mastery, 0.03, 0.97))
    ability *= 0.3 + 0.7 * clamp(confidence)
    return sigmoid(ability - float(difficulty))


def difficulty_from_pass_rate(passes: int, attempts: int) -> float:
    """Aggregate difficulty in logits; higher means harder."""
    if attempts <= 0:
        return 0.0
    pass_rate = clamp(passes / attempts, 0.05, 0.95)
    return clamp(-logit(pass_rate), -2.5, 2.5)


def update_difficulty(difficulty: float, score: float, *, rate: float = 0.1) -> float:
    """Incremental Elo update for an item, useful when replaying attempts."""
    expected = sigmoid(float(difficulty))
    return clamp(
        float(difficulty) + rate * (expected - clamp(float(score))), -2.5, 2.5
    )


@dataclass(frozen=True)
class Candidate:
    task_uuid: str
    topic_key: str
    level: int
    difficulty: float
    mastery: float
    confidence: float = 0.0
    attempts: int = 0
    next_review_at: str = ""
    prereq_ready: bool = True
    task_type: str = ""
    last_passed: bool = False
    last_attempt_at: str = ""


@dataclass(frozen=True)
class FeedPick:
    candidate: Candidate
    reason: str
    score: float
    expected: float


def _is_due(value: str, now: datetime) -> bool:
    due = parse_dt(value)
    return bool(due and due <= now)


def _reason_for(candidate: Candidate, now: datetime) -> Optional[str]:
    due = _is_due(candidate.next_review_at, now)
    # A task the learner already solved is only worth serving again when its
    # review date has come (the topic-level mastery alone would keep offering
    # it forever).
    if candidate.last_passed and not due:
        return None
    if due and candidate.mastery >= 0.5:
        return "review"
    if candidate.mastery >= MASTERY_CEILING and not due:
        return None
    if candidate.attempts == 0 and candidate.mastery < 0.4:
        return "new"
    if candidate.mastery < 0.5:
        return "weak"
    if (
        candidate.level > mastery_level(candidate.mastery)
        and candidate.mastery >= STRETCH_FLOOR
    ):
        return "stretch"
    return "practice"


def _score_for(candidate: Candidate, reason: str, expected: float, now: datetime) -> float:
    fit = 1.0 - min(1.0, abs(expected - TARGET_SUCCESS) / TARGET_SUCCESS)
    score = fit
    if reason == "review":
        due = parse_dt(candidate.next_review_at)
        overdue_days = max(0.0, (now - due).total_seconds() / 86400.0) if due else 0.0
        score += 0.6 + min(1.0, overdue_days / 14.0)
    elif reason == "weak":
        score += 0.5 * (0.5 - candidate.mastery)
    elif reason == "stretch":
        score += 0.25
    elif reason == "new":
        score += 0.15
    return score


def select_feed(
    candidates: Sequence[Candidate],
    *,
    limit: int = 10,
    now: datetime | None = None,
    max_per_topic: int = 2,
    strict_prereq: bool = True,
) -> list[FeedPick]:
    """Pick the next tasks for a learner's daily feed.

    Deterministic: ties break by ``task_uuid``. Topics are capped so the feed
    does not turn into ten variations of the same exercise.
    """
    now = now or datetime.now()
    limit = max(1, int(limit))
    ranked: list[tuple[float, str, Candidate, str, float]] = []
    for candidate in candidates:
        if strict_prereq and not candidate.prereq_ready:
            continue
        reason = _reason_for(candidate, now)
        if reason is None:
            continue
        expected = expected_success(
            candidate.mastery, candidate.difficulty, candidate.confidence
        )
        score = _score_for(candidate, reason, expected, now)
        ranked.append((score, candidate.task_uuid, candidate, reason, expected))
    ranked.sort(key=lambda row: (-row[0], row[1]))

    picked: list[FeedPick] = []
    picked_uuids: set[str] = set()
    per_topic: dict[str, int] = {}
    for score, _uuid, candidate, reason, expected in ranked:
        if per_topic.get(candidate.topic_key, 0) >= max_per_topic:
            continue
        per_topic[candidate.topic_key] = per_topic.get(candidate.topic_key, 0) + 1
        picked.append(
            FeedPick(
                candidate=candidate,
                reason=reason,
                score=round(score, 4),
                expected=round(expected, 4),
            )
        )
        picked_uuids.add(candidate.task_uuid)
        if len(picked) >= limit:
            break

    # A short course can have fewer topics than a full daily feed. Fill the rest
    # from the same ranking without the diversity cap instead of returning three
    # tasks for a day that expects ten.
    if len(picked) < limit:
        for score, _uuid, candidate, reason, expected in ranked:
            if candidate.task_uuid in picked_uuids:
                continue
            picked.append(
                FeedPick(
                    candidate=candidate,
                    reason=reason,
                    score=round(score, 4),
                    expected=round(expected, 4),
                )
            )
            picked_uuids.add(candidate.task_uuid)
            if len(picked) >= limit:
                break
    return picked


def xp_for_level(level: int) -> int:
    return {1: 10, 2: 15, 3: 20}.get(int(level or 1), 10)
