# ADR-002: Provider abstraction & capability routing

- **Status:** Accepted
- **Date:** 2025

## Context

The product must not depend architecturally on any single AI provider, model, or API key (§192–199).
Business logic must never hardcode model names or vendor endpoints.

## Decision

- `lib/llm/types.ts` defines a `ProviderAdapter` interface and capability profiles (`fast`, `strong`,
  `coding`, `reasoning`) — not model names.
- `lib/llm/provider.ts` implements the OpenAI-compatible adapter (works with llm.azati.ai, OpenAI,
  vLLM, LiteLLM, local endpoints). All vendor specifics (base URL, key, model, reasoning field) live here.
- `lib/llm/router.ts` maps capabilities → concrete models from environment variables, with retry/backoff.
- `lib/llm/structured.ts` enforces that any AI output that affects application behavior passes a Zod
  schema before it may touch state.

## Consequences

- Changing the provider/model is an environment change only; learner state, evidence, curriculum and
  content are untouched (non-negotiable test §266/§269).
- Prompt catalog (`lib/prompts`) records capability assumptions per prompt, so a weaker model can be
  detected and a stronger one substituted per operation.
