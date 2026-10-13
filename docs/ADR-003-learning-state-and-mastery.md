# ADR-003: The Student Learning Twin is the source of truth

- **Status:** Accepted
- **Date:** 2025

## Context

The learner's durable educational state must be explainable, portable, and independent of any AI
provider (§290, §180). Mastery must never appear from nowhere (§213, §272).

## Decision

- A `CompetencyState` row per (learner, skill) holds a **competency vector**: mastery + uncertainty,
  cognitive depth, independence, application, transfer, retention, hint-dependence (§11).
- Mastery is a Beta posterior mean. Uncertainty is `1/(n+1)` over strength-weighted observations, with a
  weak prior (1 success / 3 failures → prior mean 0.25) so early evidence can't fake precision (§13).
- Updates happen only via `applyEvidence`, which is invoked from `createEvidence`-recorded events.
  Every significant update carries lineage (task, attempt, method, strength).
- Raw chat logs are never the educational database; the tutor persists messages but only a clearly
  detected misconception becomes (low-strength) evidence.

## Consequences

- Any competency state can be explained by following its evidence lineage.
- "Observed vs inferred" is always distinguishable: `method` (deterministic/rubric/ai-interpretation)
  and `strength` are stored on every evidence record.
