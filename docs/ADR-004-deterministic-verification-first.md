# ADR-004: Deterministic verification before AI interpretation

- **Status:** Accepted
- **Date:** 2025

## Context

AI is not ground truth (§25). For programming, the spec requires execution + tests + static analysis +
AI interpretation, in that order.

## Decision

- A generated programming task is not published until its **reference solution passes its own test
  cases** (executed in an isolated subprocess). If it fails, the generator retries once with the
  failure feedback, then fails loudly (§126).
- A learner submission is first run against the tests deterministically. That result is the primary
  evidence (`method: deterministic`, strength 1.0). AI review runs *on top* of the failing test output
  to explain and detect misconceptions, and never overrides the execution result.
- Diagnostic questions are graded deterministically against the stored answer key; the AI only
  generates the question.

## Consequences

- No fake verification: the UI labels whether feedback is "verified by execution" or interpreted.
- AI review cannot silently pass a submission whose tests fail.
