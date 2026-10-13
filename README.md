# Cognos — Learning Intelligence Platform

An adaptive **learning intelligence** system, not an LMS, not a chatbot, not a course generator.

Cognos builds a persistent, evidence-based model of each learner (the **Student Learning Twin**),
maps the domain with a **Knowledge Graph**, and turns a goal into a personalized, evolving roadmap.
Every learning action produces **evidence**, which updates the learner's competency state — and the
system uses that state to choose the *next best action*. It works from a goal alone (cold start) or
alongside your own materials.

The AI layer is an amplifier, not the foundation: the learner's durable state is the source of truth,
and no AI provider, model, or API key is baked into the core.

---

## What it does (MVP)

- **Accounts** — register / login (email + password, scrypt-hashed, signed session cookie).
  Every user has a fully isolated learning twin, roadmap, tasks, evidence and materials.
- **Russian / English** — the whole UI is switchable (EN ⇄ RU), and AI-generated lessons,
  tasks, diagnostics, feedback and tutoring follow the selected language.
- **Material upload** — `.txt`, `.md`, `.pdf`, `.docx` up to 100 MB (RU/EN auto-detected).
  Files are text-extracted, chunked, and analyzed by AI into knowledge-graph skills + coverage.
- **Grounded generation** — lessons are grounded in your uploaded materials where possible and
  cite them inline (`[src: filename]`); anything not covered is generated and clearly marked `(AI)`.
  Provenance is always explicit: *from your material* vs *AI-generated*.
- **Cold start** — no materials? No problem: describe a goal and everything is generated.
- **Goal compiler** — natural language → domain, target level, and target skills + prerequisites.
- **Adaptive diagnostic** — seeds the learning twin with honest initial evidence (with uncertainty).
- **Personalized roadmap** — generated as a *hypothesis*, ordered by prerequisites and learner state.
- **Learning session** — lesson + validated programming task + Monaco editor + isolated execution.
- **Deterministic verification** — reference solutions are executed against their own tests before
  a task is ever shown to you; your submissions are graded by real execution, then reviewed by AI.
- **Evidence engine** — every attempt creates structured, provenance-carrying evidence.
- **Student Learning Twin** — per-skill competency vectors (mastery + uncertainty, depth,
  independence, application, transfer, retention, misconception states).
- **Next-best-action** — a recommendation engine, not a fixed sequence.
- **Contextual tutor** — intent-aware, grounded in your current task, following the hint ladder.
- **Knowledge map** — inspect what you know, what's weak, what blocks you, what's next.

## Stack

- **Frontend & API**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Framer Motion, Monaco.
- **Data**: PostgreSQL-shaped schema on **SQLite** via Prisma (swap `DATABASE_URL` for Postgres; add pgvector later).
- **AI**: provider-abstracted layer (OpenAI-compatible adapter) → defaults to `llm.azati.ai` / `deepseek-v4-flash`.
- **Execution**: isolated subprocess runner (swap for a container/gVisor sandbox in production).

## Quick start

```bash
# 1. install
pnpm install

# 2. configure (copy .env.example → .env.local and set your key)
#    .env.local is already set up for llm.azati.ai in this workspace

# 3. create + seed the database
pnpm db:push
pnpm db:seed

# 4. run
pnpm dev        # http://localhost:3100
```

Open http://localhost:3100 → register (or log in) → optionally upload materials → describe your
goal → complete the short diagnostic → start learning.

> Smoke test: with the server running, `node scripts/smoke.mjs` exercises register → upload →
> goal → grounded lesson → per-user isolation against the live API.

## Configuration

All provider details live in `.env.local` — nothing is hardcoded in business logic:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Prisma datasource (SQLite by default) |
| `SESSION_SECRET` | HMAC secret for signed session cookies |
| `LLM_PROVIDER` | adapter id (`openai-compatible`) |
| `LLM_BASE_URL` | gateway base URL (e.g. `https://llm.azati.ai/v1`) |
| `LLM_API_KEY` | API key (never committed) |
| `LLM_MODEL_FAST` / `STRONG` / `CODING` | capability→model mapping |

Switching providers or models changes **nothing** about learner state, competencies, evidence,
roadmaps, or content.

## Architecture

```
src/
  lib/
    core/          educational core (knowledge graph, learning twin, evidence,
                   mastery, goal compiler, roadmap, diagnostic, taskgen,
                   evaluation, tutor, content, learn, code-runner)
    llm/           provider abstraction (types, adapter, router, structured output)
    prompts/       versioned prompt catalog
  app/
    api/           REST endpoints (onboarding, state, diagnostic, learn, attempt,
                   run, tutor, recommend, skills, roadmap)
    (app)/         learner shell: home, roadmap, learn, tutor, map, progress
    diagnostic/    full-screen adaptive diagnostic
    page.tsx       onboarding (goal input)
```

Read `docs/` for architecture decision records.

## Key guarantees (non-negotiable tests)

- Changing provider/model preserves learner state, evidence, curriculum, content.
- AI outage never destroys learner data or original materials.
- Mastery is never invented: it changes only through recorded evidence.
- Generated content carries provenance and never silently overwrites canonical material.
- Verified (executed) results are always distinguished from AI interpretation.

## MVP scope vs. the full vision

This is a deliberately focused **modular monolith** (see `docs/ADR-001`). The full specification
(§1–295) is the north star; this MVP implements the *golden learning loop* end-to-end and is
structured so the Phase 2/3 systems (retention scheduling, interleaving, transfer engine,
teacher dashboards, multi-provider routing, content ingestion/enrichment) slot in without a rewrite.
