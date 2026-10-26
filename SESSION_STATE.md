# Session state

Updated: 2026-10-23 (late).

## Repo

- Path: `C:/_audit/learnhouse`
- Base: upstream `dev` @ `4e2324a` (LearnHouse 1.4.2)
- Branch: `feature/problem-library-and-import` (created 2026-10-23; not pushed)
- User rule: no commit/push without explicit instruction.
- `C:/zero-knowledge` is a different product; it is clean and untouched.

## Completed

- Stage 0 audit and stage 1 spec are in the prior session transcript
  (`01a1679b-...`), and stage 2 was recovered and completed on this branch.
- Stage 2 (problem library + ZIP import):
  - `problem` model, CRUD service/router, migration `a9b8c7d6e5f4` (single head).
  - Strict ZIP importer: manifest/version, traversal/symlink/NUL/backslash
    rejection, size caps, UTF-8/JSON validation, idempotent re-import,
    manual-edit/archive conflicts, source-aware dedupe, dry run.
  - Assignment task snapshot from a problem; student task reads strip hidden
    tests; library reads are staff-only because the payload contains answers.
  - Dashboard library page, add-from-library modal, sidebar links, docs page.
- Verification:
  - Targeted API tests: 24 passed (problem service/router, root router).
  - Web tests: 476 pass / 0 fail.
  - `next build` succeeded, route `/orgs/[orgslug]/dash/problems` present.
  - Alembic `heads` returns only `a9b8c7d6e5f4`.
  - Full API suite: 7057 passed, 28 failed, 4 errors. One failure was ours
    (`problem.created_by_id` SET NULL in demo teardown) and is fixed; the
    remaining 27/4 reproduce on pristine `4e2324a` (Windows path/env issues).
  - No commit was created.

## Next

Stage 3 (execution/attempts) is implemented and verified:
- hidden `task_submission.results` are sanitized for learners;
- durable `assignmentattempt` history (migration `b2c3d4e5f6a7`), written on
  submit and kept across retries;
- student/instructor attempt read endpoints + student history UI;
- per-problem CPU/memory limits passed to Judge0; run limits clamped;
- custom-stdin Run in the student editor;
- Tests: full API suite after all edits: 7075 passed, 27 failed, 23 skipped,
  4 errors; the 27/4 are the baseline Windows path/env failures, none new.
  Targeted: 252 completion/assignment tests, 149 deadline/attempt tests,
  34 new Informatics/attempt tests, 14 trail tests. Web: 476 pass, 0 fail.
  `next build` success. Migrations `b2c3d4e5f6a7`, `c3d4e5f6a7b8`,
  `a7b8c9d0e1f2` up/down verified on Postgres 16.

Stage 5 slice: `allow_late` / `is_late` (migration `c3d4e5f6a7b8`) implemented
with API, edit-modal toggle, student late notice/badge, and tests. Migration
up/down verified on Postgres.

Stage 4 incremental: public-examples panel, custom stdin, attempt history,
multi-language selector with per-language drafts in the student CODE task.

Stage 5 incremental: timezone-aware deadlines; `is_required` with completion
rule (migration `a7b8c9d0e1f2`).

Stage 6 incremental: Trail total counts only published activities; Trail cards
count only completed steps; session-authenticated Course → Students gradebook
with non-submitters and per-assignment status; assignment-card drill-down with
tasks, grades, CODE attempt history (per-test results + source) and offline
responses; **Struggle map** aggregates class-level CODE failures, stuck learners
and top failed tests from durable attempts; TrailStep completion now happens on
grading (or formative hand-in), not submit.

Stage 2 incremental: archive filter + restore action in the problem library;
Informatics import rate-limited to 10/min per user.

Navigation: admin sidebar/mobile menu reduced to Home + Courses, Problem
library, Students, Users; hidden routes remain direct. New `/dash/students`
global overview links each course's gradebook/Struggle Map; course tabs hide
SEO/Certification/Analytics from the primary bar. See NIGHT_REPORT.

Stage 5/4 incremental: optional due-time authoring in the assignment editor;
offline `CUSTOM` task type with student response and manual grading.

Current head: `a7b8c9d0e1f2`.

## Local runtime

- API/web/Postgres/Redis are running for manual review; see NIGHT_REPORT.
- Judge0 self-host was attempted but `isolate` cannot create `/box` on this
  Windows Docker setup; Judge0 containers stopped, so Run/Submit still return
  503. Use a Linux host or a cloud Judge0 endpoint for real execution.
- Demo student `student@school.dev` / `student12345` with seeded attempts exists
  for Struggle Map/drill-down demonstration; mark it as demo data.

## Next steps

1. Re-run the full API suite after the stage 3/5 changes (the last complete run
   was before them); classify any failures against baseline `4e2324a`.
2. Stage 4 left to do: explicit public-examples panel and language selection in
   the assignment editor; optionally reuse the Playground language extension
   map instead of the duplicate switch.
3. Stage 5 left: timezone-aware due dates, `is_required` + progress rule,
   `CUSTOM`/`OTHER` authoring UI.
4. Stage 2 leftover: Informatics importer evaluation, archive/unarchive UI.
5. Stage 6: progress denominator fix and roster summary table.

## Environment

- API test interpreter: `C:/_audit/learnhouse/apps/api/.venv-test/Scripts/python.exe`
  (Python 3.14.3; project metadata asks 3.14.7, unavailable in this env).
- Bun: `C:/_audit/bin/bun-windows-x64/bun.exe` (1.4.4).
- Ruff: `uvx ruff`.
- Windows path failures in the baseline suite are environmental; do not
  attribute them to this branch.

## 2026-10-24 — ZeroKnowledge rebrand + mass import

- UI/API/email/locales rebranded to ZeroKnowledge; org renamed
  `ZeroKnowledge Academy`; logo assets replaced. Internal `LEARNHOUSE_*`
  env/config identifiers kept for compatibility.
- Informatics collector (`C:/_audit/collect_informatics.py`) fetched IDs
  1–5000: 3,495 usable JSON + 1,505 missing (incl. 713 unpublished placeholders). Dataset at
  `C:/_audit/data/informatics/raw`.
- Batch importer (`C:/_audit/import_informatics_dataset.py`) created 2,495
  problems; problem library total 2,495.
- `next build` and 476 web tests pass; targeted API branding tests 104 pass.

## 2026-10-25 — self-hosted code runner (Judge0 replaced)

Judge0's `isolate` sandbox requires cgroups v1, unavailable on Docker Desktop
(Windows/WSL2 uses v2) — the real Judge0 cannot run here. Built a
Judge0-compatible runner instead:

- Code: `apps/api/src/services/code_runner/` (app.py, executor.py, languages.py).
  Runs each submission in a fresh Docker container (network none, memory/cpu/
  pids limits, dropped caps, read-only root). Languages: Python 3 (71), C++
  GCC 12 (54), C (50), Java 17 (62), Node 20 (63), Bash (46).
- Service `lh-runner` on 127.0.0.1:2358 (launcher `C:/_audit/lh-dev-runner.sh`,
  `uvicorn src.services.code_runner.app:app`).
- API launcher `C:/_audit/lh-dev-api.sh` sets `LEARNHOUSE_JUDGE0_API_URL=http://127.0.0.1:2358`.
  Zero app-code changes: the router + grading already speak Judge0's contract.
- Docker images pulled: python:3.11-slim, gcc:12, node:20-slim, bash:5,
  eclipse-temurin:17-jdk (NOT openjdk:17-slim — removed from Docker Hub).
- Auto-grading enabled on all 22 C++ course assignments (`auto_grading=true`).
- Tests: `src/tests/services/test_code_runner.py` (10 unit tests, subprocess
  mocked). Verified end-to-end: /code/execute, /code/execute-batch, and
  `_evaluate_code_task` (Python + C++ → ACCEPTED/100, WRONG_ANSWER/0).
- Known limitation: memory reported as 0 on success (limit on OOM); exact peak
  RSS isn't measurable without GNU time in the base images.
