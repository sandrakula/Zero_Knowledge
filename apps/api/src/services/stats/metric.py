"""The КПД score.

The programme is built around solving a lot of tasks over time and coming to
defend them, plus occasional contests. The score therefore rewards:

  1. regularity (weeks with verified activity)          — the main signal;
  2. confirmed defenses (verified by an instructor);
  3. solved tasks (the system marks them automatically) — with a small
     conversion bonus for tasks that were also defended;
  4. contests (self-reported, unverified)               — 5% only.

Everything is non-linear: regularity has an exponent, defenses and volume
saturate, conversion gives at most +15% of the solved part.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Weights. Kept here so the formula can be tuned in one place.
WEIGHT_REGULARITY = 0.35
WEIGHT_DEFENSES = 0.30
WEIGHT_SOLVED = 0.30
WEIGHT_CONTESTS = 0.05

REGULARITY_EXPONENT = 1.2
DEFENSE_SATURATION = 6.0
SOLVED_SATURATION = 20.0
CONTEST_SATURATION = 3.0
CONVERSION_FLOOR = 0.87
CONVERSION_RANGE = 0.13


@dataclass
class ScoreBreakdown:
    score: float = 0.0
    regularity: float = 0.0
    defenses: float = 0.0
    solved: float = 0.0
    contests: float = 0.0
    conversion: float = 0.0
    active_weeks: int = 0
    total_weeks: float = 1.0
    solved_count: int = 0
    defense_count: int = 0
    contest_count: int = 0
    components: dict = field(default_factory=dict)


def compute_score(
    *,
    active_weeks: int,
    total_weeks: float,
    defenses: int,
    solved: int,
    contests: int,
    include_contests: bool = True,
) -> ScoreBreakdown:
    """Return the 0–100 score and its parts.

    ``include_contests=False`` is used for course-scoped leaderboards: contests
    are reported per organization, not per course, so the remaining weights are
    renormalized instead of silently capping the course score at 95.
    """
    weeks = max(1.0, float(total_weeks or 1.0))
    a = min(1.0, max(0.0, active_weeks / weeks))
    d = max(0, int(defenses))
    v = max(0, int(solved))
    c = max(0, int(contests))

    conversion = min(1.0, d / v) if v > 0 else 0.0

    regularity_part = a**REGULARITY_EXPONENT
    defense_part = 1.0 - math.exp(-d / DEFENSE_SATURATION)
    solved_part = (1.0 - math.exp(-v / SOLVED_SATURATION)) * (
        CONVERSION_FLOOR + CONVERSION_RANGE * conversion
    )
    contest_part = (1.0 - math.exp(-c / CONTEST_SATURATION)) if include_contests else 0.0

    weight_sum = WEIGHT_REGULARITY + WEIGHT_DEFENSES + WEIGHT_SOLVED
    if include_contests:
        weight_sum += WEIGHT_CONTESTS

    raw = (
        WEIGHT_REGULARITY * regularity_part
        + WEIGHT_DEFENSES * defense_part
        + WEIGHT_SOLVED * solved_part
        + (WEIGHT_CONTESTS * contest_part if include_contests else 0.0)
    )
    score = 100.0 * raw / weight_sum

    def points(part: float, weight: float) -> float:
        return round(100.0 * weight * part / weight_sum, 1)

    return ScoreBreakdown(
        score=round(min(100.0, max(0.0, score)), 1),
        regularity=points(regularity_part, WEIGHT_REGULARITY),
        defenses=points(defense_part, WEIGHT_DEFENSES),
        solved=points(solved_part, WEIGHT_SOLVED),
        contests=points(contest_part, WEIGHT_CONTESTS) if include_contests else 0.0,
        conversion=round(conversion, 3),
        active_weeks=int(active_weeks),
        total_weeks=weeks,
        solved_count=v,
        defense_count=d,
        contest_count=c,
        components={
            "regularity": round(regularity_part, 4),
            "defenses": round(defense_part, 4),
            "solved": round(solved_part, 4),
            "contests": round(contest_part, 4),
        },
    )
