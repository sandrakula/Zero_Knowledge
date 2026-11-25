"""The КПД formula must stay sane across the profiles the programme cares about."""

import random

from src.services.stats.metric import compute_score


def score_for(*, weeks, active_weeks, defenses, solved, contests=0):
    return compute_score(
        active_weeks=active_weeks,
        total_weeks=weeks,
        defenses=defenses,
        solved=solved,
        contests=contests,
    ).score


class TestProfiles:
    def test_ideal_student(self):
        assert 85 <= score_for(weeks=6, active_weeks=6, defenses=20, solved=25, contests=3) <= 95

    def test_regular_good_student(self):
        assert 78 <= score_for(weeks=4, active_weeks=4, defenses=15, solved=20) <= 86

    def test_one_week_burst_is_held_back(self):
        assert 45 <= score_for(weeks=4, active_weeks=1, defenses=15, solved=20) <= 58

    def test_solver_without_defenses_is_not_zeroed(self):
        score = score_for(weeks=4, active_weeks=4, defenses=0, solved=30)
        assert 52 <= score <= 62

    def test_steady_defender(self):
        assert 68 <= score_for(weeks=4, active_weeks=4, defenses=10, solved=10) <= 78

    def test_contests_alone_are_worth_very_little(self):
        # Self-reported contests do not feed regularity either.
        assert score_for(weeks=4, active_weeks=0, defenses=0, solved=0, contests=100) <= 5

    def test_newcomer_is_not_thrown_to_the_top(self):
        assert score_for(weeks=4, active_weeks=1, defenses=2, solved=3) <= 35

    def test_empty_profile_is_zero(self):
        assert score_for(weeks=4, active_weeks=0, defenses=0, solved=0) == 0

    def test_conversion_bonus_is_bounded(self):
        no_conversion = compute_score(
            active_weeks=4, total_weeks=4, defenses=0, solved=20, contests=0
        )
        full_conversion = compute_score(
            active_weeks=4, total_weeks=4, defenses=20, solved=20, contests=0
        )
        assert full_conversion.solved > no_conversion.solved
        # at most +15% of the solved component
        assert full_conversion.solved <= no_conversion.solved * 1.16 + 0.1


class TestProperties:
    def test_score_is_always_bounded(self):
        rng = random.Random(7)
        for _ in range(300):
            result = compute_score(
                active_weeks=rng.randint(0, 60),
                total_weeks=rng.choice([1, 4, 12, 52]),
                defenses=rng.randint(0, 200),
                solved=rng.randint(0, 500),
                contests=rng.randint(0, 100),
            )
            assert 0 <= result.score <= 100

    def test_more_defenses_never_lowers_score(self):
        previous = -1.0
        for defenses in range(0, 30):
            score = score_for(weeks=5, active_weeks=5, defenses=defenses, solved=20)
            assert score >= previous
            previous = score

    def test_more_solved_never_lowers_score(self):
        previous = -1.0
        for solved in range(0, 60):
            score = score_for(weeks=5, active_weeks=5, defenses=5, solved=solved)
            assert score >= previous
            previous = score

    def test_course_scope_renormalizes_without_contests(self):
        with_contests = compute_score(
            active_weeks=4, total_weeks=4, defenses=5, solved=10, contests=2
        )
        course_scope = compute_score(
            active_weeks=4,
            total_weeks=4,
            defenses=5,
            solved=10,
            contests=2,
            include_contests=False,
        )
        assert 0 <= course_scope.score <= 100
        assert course_scope.contests == 0
        assert course_scope.score != with_contests.score
