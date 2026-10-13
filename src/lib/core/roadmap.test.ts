import { test } from "node:test";
import assert from "node:assert/strict";

import { rollupStatus, isStaleFromStatuses } from "@/lib/core/roadmap";
import {
  RULES,
  classifyActivity,
  isDelayedRetrieval,
  type SkillStatus,
} from "@/lib/core/competency";

// ── Node status rollup (§29, §86) ───────────────────────────

test("empty skill list is not assessed", () => {
  assert.equal(rollupStatus([]), "not_assessed");
});

test("any needs_attention dominates the rollup", () => {
  assert.equal(rollupStatus(["demonstrated", "needs_attention", "demonstrated"]), "needs_attention");
});

test("all demonstrated rolls up to demonstrated", () => {
  assert.equal(rollupStatus(["demonstrated", "demonstrated"]), "demonstrated");
});

test("all not assessed rolls up to not assessed", () => {
  assert.equal(rollupStatus(["not_assessed", "not_assessed"]), "not_assessed");
});

test("mixed states roll up to developing", () => {
  assert.equal(rollupStatus(["demonstrated", "developing"]), "developing");
  assert.equal(rollupStatus(["not_assessed", "demonstrated"]), "developing");
  assert.equal(rollupStatus(["developing", "developing"]), "developing");
});

test("every skill status has a defined rollup path", () => {
  const statuses: SkillStatus[] = ["not_assessed", "needs_attention", "developing", "demonstrated"];
  for (const s of statuses) {
    const out = rollupStatus([s]);
    assert.ok(["not_assessed", "needs_attention", "developing", "demonstrated"].includes(out));
  }
});

// ── Adaptive re-plan staleness predicate (§29, §35) ─────────

test("plan is stale when a remaining root's skills are all demonstrated", () => {
  const stale = isStaleFromStatuses(
    [{ status: "ready", skillIds: ["python.functions"] }],
    new Map([["python.functions", "demonstrated"]]),
  );
  assert.equal(stale, true);
});

test("plan is not stale while a skill is still developing", () => {
  const stale = isStaleFromStatuses(
    [{ status: "ready", skillIds: ["python.functions"] }],
    new Map([["python.functions", "developing"]]),
  );
  assert.equal(stale, false);
});

test("completed roots never make the plan stale", () => {
  const stale = isStaleFromStatuses(
    [{ status: "completed", skillIds: ["python.functions"] }],
    new Map([["python.functions", "demonstrated"]]),
  );
  assert.equal(stale, false);
});

test("a root with mixed demonstrated + developing skills is not stale", () => {
  const stale = isStaleFromStatuses(
    [{ status: "ready", skillIds: ["python.functions", "python.return_values"] }],
    new Map([["python.functions", "demonstrated"], ["python.return_values", "developing"]]),
  );
  assert.equal(stale, false);
});

// ── Activity → evidence-dimension classification (§17, §18, §85) ──

test("ordinary practice never crosses the transfer threshold", () => {
  const a = classifyActivity("task", 1);
  // The core invariant: ordinary practice must NOT move transfer (§18, §85).
  assert.ok(a.transferLevel < RULES.transferThreshold, `ordinary transferLevel ${a.transferLevel} must be < ${RULES.transferThreshold}`);
});

test("transfer item is classified as a transfer activity", () => {
  const a = classifyActivity("transfer", 1);
  assert.ok(a.transferLevel >= 0.4);
});

test("single-skill practice never crosses the integration threshold", () => {
  const a = classifyActivity("task", 1);
  assert.ok(a.integrationLevel < RULES.integrationThreshold);
});

test("multi-skill practice is an integrated activity", () => {
  const a = classifyActivity("task", 2);
  assert.ok(a.integrationLevel >= RULES.integrationThreshold);
});

test("project is both integrated and transfer", () => {
  const a = classifyActivity("project", 3);
  assert.ok(a.integrationLevel >= RULES.integrationThreshold);
  assert.ok(a.transferLevel >= RULES.transferThreshold);
});

// ── Retention delay (§19, §85) ──────────────────────────────

test("same-session assessment is not a delayed retrieval", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  assert.equal(isDelayedRetrieval(new Date("2026-01-01T09:30:00Z"), now), false);
});

test("no prior assessment is never a delayed retrieval", () => {
  assert.equal(isDelayedRetrieval(null), false);
});

test("an assessment a day ago counts as delayed", () => {
  const now = new Date("2026-01-03T10:00:00Z");
  assert.equal(isDelayedRetrieval(new Date("2026-01-01T10:00:00Z"), now), true);
});
