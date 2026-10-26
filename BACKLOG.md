# LearnHouse Coding Academy — backlog

Updated: 2026-10-24. Source of truth for implementation order. Do not mark an
item done without a command/test/file evidence in `NIGHT_REPORT.md`.

## Working rules

- Target repo: `C:/_audit/learnhouse` (LearnHouse 1.4.2, branch
  `feature/problem-library-and-import`).
- Do not commit or push without the user's command.
- Preserve LearnHouse architecture and existing UI; extend, don't replace.
- Hidden tests never leave the server. Student payloads are server-sanitized.
- Every new table/column gets an Alembic migration whose `down_revision` is the
  current single head (currently `a7b8c9d0e1f2`; re-check with `alembic heads`).
- Windows-local test environment: `.venv-test` (Python 3.14.3), `uvx ruff`.

## Current stage

**Stage 3 complete; stage 4/5 mostly complete. Next: stage 4 polish, stage 5
offline-task UI, stage 6 teacher summary table.**

## P0 — stage 3

- [x] Server-side CODE grading with Judge0, binary/equal/custom weights.
- [x] Run vs Submit split (Run = visible tests; Submit = assignment submit).
- [x] Sanitize stored per-task `results` before student reads and before the
      teacher's client-side grade persists them (hidden `expected_stdout` leak).
- [x] Persist one durable attempt row per CODE task per assignment attempt:
      student, task, source, language, timestamp, attempt number, verdict,
      passed/total, time, memory, per-test pass/fail (no hidden answers).
- [x] Keep attempt history across retry/resubmit (attempt table is never reset).
- [x] Attempt-history read API for the owning student (`/me`) and instructor.
- [x] Pass per-problem `time_limit_ms` / `memory_limit_kb` into the Judge0
      request; cap client-supplied run limits server-side.
- [x] Stage 3 regression tests: verdict mapping, hidden-result sanitization,
      attempt retention, limit forwarding, migration up/down.

## P1 — stage 4 (editor)

- [x] Reuse CodeMirror in the assignment CODE editor (already the shared
      `@uiw/react-codemirror` stack; Playground-specific extras remain separate).
- [x] Custom stdin run (not only public examples), attempt history panel,
      public examples panel.
- [x] Language selector for multi-language problems; per-language draft map in
      `task_submission.drafts` so switching language does not lose code.
- [ ] Keep Ctrl/Cmd+Enter; add reset/run/submit affordances.
- [ ] No hidden tests or expected outputs in the browser.

## P2 — stage 5 (deadlines and offline tasks)

- [x] `allow_late` + `is_late` fields, migration, API/UI behavior.
- [x] Late submission policy (accept + mark late) instead of hard 403.
- [x] Timezone-safe `due_date`: date-only = local end-of-day; offset-aware
      datetime = absolute UTC instant; naive datetime = local wall time.
- [x] Time-of-day authoring UI (dashboard date + optional time).
- [x] `is_required` field and completion rule: optional assignments do not
      block course completion/certificate; edit-modal toggle + tests.
- [x] Author/grade `CUSTOM`/`OTHER` offline tasks in the web app (offline task
      type, student response, manual grading).
- [ ] Per-student extension/penalty if needed; otherwise document exclusion.

## P3 — stage 6 (progress / teacher table)

- [x] Fix Trail progress denominator: only published activities; only completed
      steps counted (backend + Trail cards).
- [x] Course roster × assignment progress table including non-submitters
      (session API + Course → Students tab).
- [x] **Struggle map**: class-level CODE failure aggregation (WA/CE/RE/TLE,
      top failed tests, stuck learners) from durable attempts.
- [x] Per-student task/attempt drill-down for the teacher (assignment card →
      tasks, grades, CODE attempts, per-test results, source, offline responses).
- [x] `TrailStep.complete` now flips only after the assignment is GRADED (or on
      hand-in for a formative assignment), not on submit; tests updated.
- [ ] Stage 8 end-to-end scenario suite.

## P4 — stage 2 leftovers

- [x] Informatics importer: fetch one numeric id from the fixed host, parse
      statement/sample tests/limits with attribution, reuse normal import
      conflict rules, dashboard dialog + API + tests. No hidden tests or judge
      access; bulk import deliberately not exposed yet.
- [x] Archive/unarchive filter in the library UI and a restore action.
- [ ] Render Markdown statements in the student task view or store plain text
      explicitly; current task description is rendered as plain text.
- [ ] Apply problem limits in task snapshots and show them to the editor.

## P5 — quality

- [x] Navigation simplification: admin sidebar/mobile menu reduced to Home +
      Courses, Problem library, Students, Users; hidden sections keep direct
      routes. Global `/dash/students` page added; course tabs hide
      SEO/Certification/Analytics from the primary bar.

- [ ] Stage 8 scenario tests (admin → course → assignment → student → grade).
- [ ] Fix pre-existing Windows-only API test failures (content paths, migration
      path separators, payload-size env limit) or mark them as known environment
      failures in CI with an explicit platform matrix.
- [ ] Docs: operator setup for Judge0, pack format, attempt history.

## Known pre-existing failures (not caused by our changes)

Full API suite on Windows: 27 failed / 4 errors at baseline `4e2324a`, in
`test_content_files_router`, `test_import_content_hardening`,
`test_import_service`, `test_migration_service`, `test_upload_faststart_wiring`,
`test_payload_size_caps`. See `NIGHT_REPORT.md` for evidence.

- [x] ZeroKnowledge rebrand across UI, locales, API config/email/root and
      brand assets; internal identifiers kept for compatibility.
- [x] Informatics mass collection (3,495 statements, 2,495 imported; library
      total 2,495).
- [ ] Decide whether to import the 990 collected statements that have no
      sample tests (currently skipped by the pack validator).
