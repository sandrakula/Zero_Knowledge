# ADR-001: Modular monolith first (Next.js + SQLite), not microservices

- **Status:** Accepted
- **Date:** 2025

## Context

The specification (§171) names a default stack: Next.js frontend, NestJS main backend, Python/FastAPI
intelligence layer, PostgreSQL, Redis, Temporal. Building all of that as separate services on day one
conflicts with §233/§249 ("modular monolith first", "avoid overengineering").

## Decision

Ship the MVP as a **single Next.js full-stack application** with strict internal module boundaries:

- `lib/core` — the educational core (provider-independent, domain-independent).
- `lib/llm` — provider abstraction.
- `lib/prompts` — versioned prompts.
- `app/api` — the application boundary (REST).

The intelligence layer is written in TypeScript and colocated in `lib/core`, but structured so it can be
extracted to a Python/FastAPI service later without changing the data model or contracts.

SQLite is the MVP database via Prisma; the schema is PostgreSQL-shaped and `DATABASE_URL` is the only
switch needed to move to Postgres (pgvector can be added for retrieval later).

## Consequences

- One process to run; fast local iteration.
- Clear seams for future extraction (NestJS, Python intelligence service, Temporal workers).
- Some spec items (Redis cache, Temporal workflows, S3, sandboxed containers) are deferred until a
  demonstrated need, as the spec itself advises.
