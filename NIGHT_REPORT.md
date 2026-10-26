# Night report

## 2026-10-23 — stage 2 recovery and stage 3 start

### Branch

`feature/problem-library-and-import` on `C:/_audit/learnhouse`.
No commits, no pushes, per user instruction. `C:/zero-knowledge` remains clean.

### Stage 2 recovery

The interrupted session was killed by `SIGHUP` while the full API suite was
running. The working tree survived with 9 modified + 12 new files. This session:

1. Created the feature branch before any further work.
2. Audited the stage-2 diff against the plan and found/fixed:
   - **Hidden-answer leak:** any learner could call `GET /api/v1/problems/...`
     with `assignments.action_read` (the default learner role has it) and read
     hidden tests + expected stdout. Library reads now require
     `assignments.action_update`; tests cover the denial.
   - **Manual create overwritten by import:** manually created problems now set
     `is_edited=True`, so a later pack cannot overwrite them without a conflict.
   - **Wrong duplicate matching:** a sourced problem was matched by checksum
     before source identity, so identical text from another source could rewrite
     attribution. Sourced imports now match only by `(org, source_name, source_id)`.
   - **Frontend data loss:** editing a problem reset its languages to `[71, 54]`;
     it now preserves the stored list.
   - **Plain task description:** snapshot headings used `**Input**`, but the
     student view renders plain text; changed to `Input:` / `Output:` / `Constraints:`.
   - **Manifest integrity:** duplicate `dir` / `external_id` entries are rejected;
     manifest `external_id` is normalized to string; topics are deduped/capped;
     test IDs are capped.
   - **Demo teardown:** `problem.created_by_id` is allowlisted as an intentional
     `SET NULL` back-reference, so deleting the author account keeps the library.
   - **Stale router-composition test:** stubbed the `audit`, `demo`, `mfa`,
     `nudges`, `ai.audio` modules and deployment mode that upstream added after
     the test was written.

### Stage 2 verification

| Check | Result |
| --- | --- |
| Problem service/router + root router | 24 passed |
| Demo teardown | passed after allowlist fix |
| Web tests | 476 passed, 0 failed |
| `next build` | success; `/orgs/[orgslug]/dash/problems` emitted |
| Alembic heads | single head `a9b8c7d6e5f4` |
| `git diff --check` | clean |
| Ruff on new problem files | clean |
| Full API suite | 7057 passed, 28 failed, 4 errors; 27/4 reproduce at baseline `4e2324a` |

Baseline evidence: a detached worktree at `4e2324a` ran the failing files and
produced the same 27 failures + 4 errors (content-file path separators/auth,
import/migration Windows paths, upload faststart path, oversized-env-var test).
The only branch-specific failure was the demo teardown, fixed and re-run green.

### Stage 3 started

Scouts mapped execution/grading, deadlines/progress, and the editor. Findings:

- Judge0 exists with rate limits, batch caps, payload caps, SQL wrapping.
- CODE grading re-runs hidden tests server-side; only an aggregate grade is
  stored.
- No durable per-attempt history; retry deletes per-task rows.
- Problem limits are not passed to Judge0.
- The teacher's client-side grade writes `expected_stdout` into the learner's
  stored `task_submission.results`; student reads return it.
- No late policy; `LATE` enum is unused; `CUSTOM`/`OTHER` offline tasks have no
  authoring UI; progress counts unpublished activities and incomplete steps.

Next implementation slice: sanitize submission results, add `assignmentattempt`
history + read API + student UI, pass limits to Judge0, add regression tests.

## 2026-10-24 — stage 3 execution/attempts and late submissions

### Stage 3 implementation

- **Hidden-answer leak fixed.** `task_submission.results` rows are sanitized
  before any learner read (`/submissions/me`, batch, per-user, and save
  responses), and the teacher's client-side grade now stores pass/fail without
  hidden `expected_stdout` / `actual_stdout`.
- **Durable attempt history.** New `assignmentattempt` table + migration
  `b2c3d4e5f6a7`: one row per learner/task/attempt with source, language,
  verdict, passed/total, time, memory, and per-test pass/fail (no hidden I/O).
  Rows are written at assignment submit; retry adds a new row and never deletes
  old ones.
- **Verdicts.** `_evaluate_code_task` now returns grade + `ACCEPTED`,
  `WRONG_ANSWER`, `COMPILATION_ERROR`, `RUNTIME_ERROR`, `TIME_LIMIT_EXCEEDED`,
  `MEMORY_LIMIT_EXCEEDED`, `EXECUTION_ERROR`, or `PENDING`; the old int-only
  `_grade_code_task_async` remains as a wrapper.
- **Read APIs/UI.** `GET /assignments/{uuid}/tasks/{task}/attempts/me` and the
  instructor variant; the student editor shows collapsible history with code.
- **Limits.** Problem `time_limit_ms` / `memory_limit_kb` are snapshotted into
  task contents and sent to Judge0 as `cpu_time_limit` / `memory_limit`.
  `/code/execute*` accepts bounded caller limits (0.1–10 s, 16 KB–256 MB).
- **Custom stdin Run.** The student editor has a free-form stdin runner through
  `/code/execute`; it does not submit or count for progress.
- Docs: `docs/content/platform/code-attempts.mdx`.

### Stage 5 slice — late submissions

- New `assignment.allow_late` and `assignmentusersubmission.is_late` columns
  (migration `c3d4e5f6a7b8`).
- With `allow_late=false` behavior is unchanged: past-due writes still 403.
- With `allow_late=true`, task saves, uploads, submit, and retry remain open;
  the submission is flagged `is_late` and analytics/audit/webhook payloads
  carry the flag.
- UI: edit toggle, amber late notice, "Late submission" badge.
- Docs: `docs/content/platform/assignments/late-submissions.mdx`.

### Verification

| Check | Result |
| --- | --- |
| Attempt model/migration | up/down on Postgres 16, columns/indexes/FKs verified |
| Late-policy migration | up/down on Postgres 16, columns verified |
| Affected API tests (assignments, grading, attempts, code exec, problems, demo) | 479 passed |
| Late-policy + assignment + attempt tests | 147 passed |
| Web tests | 476 passed, 0 failed |
| `next build` | success (last run after attempt UI; rerun in progress after late UI) |
| Ruff (F rules) on touched Python | clean |
| `git diff --check` | clean |

### Stage 2 leftover — Informatics importer

- `src/services/problems/informatics.py`: fixed-host fetch (numeric id only,
  15 s timeout, 2 MB cap), HTML→plain-text statement, public sample tests,
  seconds→ms / bytes→KB limits, Judge0 language mapping, source attribution.
- Reuses the normal ZIP importer, so duplicate/manual-edit/conflict rules are
  identical; no hidden tests or judge access.
- API: `POST /api/v1/problems/org/{org_id}/import/informatics`
  (`problem_id`, optional `dry_run`).
- Dashboard: **From Informatics** dialog with validate/import and report.
- Docs: `problem-library.mdx` updated; tests: `test_informatics_import.py`.
- Live smoke fetched problem 2936 and produced a valid pack (title
  "Гипотенуза", 1 sample test, limits 1000 ms / 65536 KB).

### Stage 4 / stage 6 incremental

- Assignment CODE student view now has a public-examples panel (stdin +
  expected output for visible tests only), a free-form stdin runner, and the
  attempt-history panel; it already uses the shared CodeMirror stack.
- Trail progress: backend total now counts only published activities; the two
  Trail cards count only `complete` steps. New backend test covers the
  denominator. Teacher roster/summary table remains open.

### Stage 4/5 incremental (second pass)

- Multi-language CODE tasks: the problem snapshot carries `languages`; the
  student editor shows a selector, saves per-language drafts in
  `task_submission.drafts`, and the server rejects unsupported languages in
  both saving and grading.
- `due_date` now handles offsets correctly: date-only = local end-of-day,
  offset-aware datetime = absolute instant, naive datetime = local wall time.
- `is_required` (migration `a7b8c9d0e1f2`): optional assignments do not block
  course completion/certificate; edit-modal toggle; completion query and tests
  updated.

### Stage 6 — course gradebook

- New session-authenticated endpoint `GET /api/v1/courses/{course_uuid}/progress`
  (course update permission) returning roster × assignment cards, including
  learners with no submissions; optional assignments are flagged separately.
- **Struggle map** (`GET /courses/{course_uuid}/struggle`): per CODE task
  attempts, accepted rate, WA/CE/RE/TLE counts, students attempted/stuck and
  top failed test cases, rendered under Course → Students.
- `Course → Students` dashboard tab with completion/submitted/required counts,
  percentage, per-assignment status, late flag and attempt number.
- Clicking an assignment card opens a per-student drill-down: tasks, task
  submissions/grades/feedback, and CODE attempt history. Each attempt expands to
  per-test pass/fail rows and the submitted source; offline task responses are
  shown too.
- Problem library has a **Show archived** filter and a restore action; archive
  remains a soft delete.
- Informatics import is limited to 10 requests/minute per user; test covers 429
  with `Retry-After`.
- Assignment editor now authors an optional due time (`date + time` →
  `YYYY-MM-DDTHH:MM`), while date-only deadlines keep end-of-day semantics.
- Docs: `docs/content/platform/analytics/progress.mdx`,
  `problem-library.mdx`; tests: `src/tests/services/test_course_progress.py`
  (2 tests) plus 196 course/certification/trail tests and 24 progress/library
  tests passed.
- `TrailStep.complete` is now set only after the assignment is GRADED (or on
  hand-in for a formative assignment), not on submit. A submitted-but-ungraded
  assignment no longer completes the activity, and manual/auto grading syncs
  the TrailRun status after flipping the step.
- `CUSTOM`/`OTHER` offline tasks now have a dashboard card **Offline task**,
  teacher instructions, a student response box, auto-save and manual grading in
  the grading view; auto-grading stays disabled for assignments containing one.
- Docs: `docs/content/platform/assignments/offline-tasks.mdx`.
- Web tests 476 pass; `next build` succeeds with the new task type.

### Final checks in this session

- Backend targeted suites: 479 affected tests pass; new Informatics/attempt
  tests 34 pass; late-policy + assignment + attempts 147 pass.
- Migrations `b2c3d4e5f6a7`, `c3d4e5f6a7b8`, `a7b8c9d0e1f2` up/down verified on Postgres 16.
- Full API suite (before the final gradebook addition): **7075 passed, 27 failed, 23 skipped,
  4 errors** in 67m01s. The 27 failures and 4 errors are exactly the Windows
  path/environment failures reproduced at baseline `4e2324a` (content paths,
  import/migration path separators, upload faststart path, oversized-env-var
  payload test). No branch-specific failures remain. The gradebook change was
  followed by 196 course/certification/trail tests, all passing.
- Web tests: 476 pass / 0 fail.
- `next build`: success.
- Ruff F rules on touched Python: clean; `git diff --check`: clean.

### Still open

- Stage 4: optional Code Playground extension reuse; time-of-day authoring UI;
  reset/shortcut affordances.
- Stage 5: `CUSTOM`/`OTHER` authoring UI; per-student extension/penalty.
- Stage 6: teacher roster × assignment summary table; per-student attempt
  drill-down; decide whether submit-before-grade should complete the trail.
- Stage 2: archive/unarchive UI; Markdown statement rendering/plain-text choice.
- Quality: pre-existing Windows-only failures (27/4) remain unaddressed.


### Judge0 local attempt (2026-10-24)

Self-hosted `judge0/judge0:latest` with `judge0-pg`/`judge0-redis` on Docker
Desktop Windows. Server answered `/system_info`, but every submission returned
`Internal Error` (`No such file or directory - /box/script.py`); inside the
worker `isolate` existed but `--init` could not create `/box` and a direct run
segfaulted. This is a Windows Docker/isolate limitation, not a LearnHouse bug.
The Judge0 containers were stopped; code execution remains unconfigured.

Demo attempts were seeded through `C:/_audit/seed_demo_attempts.py` for the
existing Python Start course/assignment (student `student@school.dev` /
`student12345`) so the Struggle Map and attempt history have data without a real
executor. These rows are clearly demo data.

### Navigation simplification (2026-10-24)

- `DashLeftMenu`: Coding Academy mode hides Assignments, Library, Communities,
  Podcasts, Boards, Playgrounds, Payments, Organization, Developers, Analytics
  and the disabled-features "Other" menu. Home remains as the dashboard
  utility; Courses, Problem library, Students and Users are the four primary
  sections. Hidden feature code and direct routes were not removed.
- `DashMobileMenu`: same four primary sections (plus Home/Settings/language);
  hidden feature pills removed from the compact top bar.
- New global **/dash/students** page: lists courses with a direct link to their
  gradebook + Struggle Map and aggregates enrolled students across courses
  (reusing `/courses/org_slug/...` and `/courses/{uuid}/progress`).
- Course tab bar: keeps General, Content, Access, Contributors, Students; hides
  SEO, Certification and Analytics from the primary tabs. Their routes and
  components remain reachable directly.
- Verification: `next build` success; web tests 476 pass; `/dash`,
  `/dash/courses`, `/dash/problems`, `/dash/students`,
  `/dash/users/settings/users` return 200; hidden direct routes still return
  200. Browser visual check is unavailable in this environment (browser daemon).

### Rebrand + Informatics dataset (2026-10-24)

- Product brand is now **ZeroKnowledge** in the web app, locale copy (22
  languages), API config (`site_name`, `site_description`, sender/fallback
  strings), auth/MFA/email templates, root response and org name
  (`ZeroKnowledge Academy`). `lrn.svg`, `lrn-dash.svg`, `lrn-text.svg` were
  replaced with ZK marks / wordmark.
- Internal identifiers and env vars (`LearnHouseConfig`, `LearnHouse*`
  components, `LEARNHOUSE_*`) were intentionally kept to avoid breaking
  imports/configuration. Upstream licence/attribution files were not rewritten.
- Collected **3,495** public Informatics statements (IDs 1–5000; 1,505 missing)
  into `C:/_audit/data/informatics/raw` (12 MB) with
  `C:/_audit/collect_informatics.py` (4 concurrent, polite delay, resumable).
  2,495 include public sample tests and all were imported into the problem library as
  `informatics-<id>` using `C:/_audit/import_informatics_dataset.py` (2,368 in
  the first pass + 106 blank-title problems after the fallback fix; 0 failures,
  0 conflicts; library total **2,495**). The other 1,000 statements are 713
  unpublished placeholders plus 287 real statements without public examples;
  they remain in the dataset only.
- Verification: `next build` exit 0; web 476 tests pass; API email/MFA/root
  targeted tests 104 pass; full API suite initially 7071 passed / 36 failed /
  4 errors; the 9 failures caused by this change (5 sender-name, 2 stale
  submit-completion assertions, 1 completion-race, 1 empty Reply-To) were fixed
  and their 116-test targeted set passes. Remaining 27 failures / 4 errors match
  the documented Windows baseline. API root returns
  `{"Message":"Welcome to ZeroKnowledge ✨"}`.
