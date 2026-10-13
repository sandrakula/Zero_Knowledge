# ADR-005: Content provenance & cold-start generation

- **Status:** Accepted
- **Date:** 2025

## Context

The platform must work with zero materials (§34), and generated content must never silently overwrite
canonical material (§42–51).

## Decision

- Every `ContentItem` and `Task` records `provenance` (`canonical | user-provided | generated | …`)
  and `status` (`draft | generated | validated | approved | deprecated`).
- Cold-start lessons/tasks are generated on demand per roadmap item, validated, and stored with
  `provenance: generated`. They are never marked canonical.
- The enrichment on/off setting is the gate for whether generated content may become persistent (§47).
  (In the MVP, generated lessons/tasks are persistent-but-marked-generated; a full enrichment policy
  engine with approval modes is Phase 2.)

## Consequences

- The learner can always distinguish original vs generated vs validated vs approved (§271).
- Original materials are never mutated; a future ingestion pipeline can layer generated supplements
  alongside them without violating provenance.
