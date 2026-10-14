import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLASSIFICATION,
  RULES,
  applyEvidenceToSkill,
  classifyFailureCause,
  classifySkill,
  emptySkillState,
  instructionFormat,
  isConfidentlyMastered,
  skillMetrics,
  type EvidenceInput,
  type SkillState,
} from "./competency";
import {
  credibleInterval,
  evidenceCount,
  posteriorMean,
  priorPosterior,
  retentionEstimate,
  sufficiency,
  updatePosterior,
} from "./mastery";
import { METHOD_RELIABILITY, SKILL_ROLE_FACTOR, effectiveWeight, observedScore } from "./evidence";

const AT = new Date("2026-01-01T00:00:00Z");

function ev(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    q: 1,
    weight: 1,
    correct: true,
    supportUsed: 0,
    integrationLevel: 0,
    transferLevel: 0,
    retentionCheck: false,
    retentionDelayed: false,
    cognitiveLevel: "apply",
    taskFamily: "fam-a",
    at: AT,
    ...over,
  };
}

function apply(state: SkillState, ...observations: EvidenceInput[]): SkillState {
  return observations.reduce((s, o) => applyEvidenceToSkill(s, o), state);
}

// ── Mastery model (§13) ─────────────────────────────────────

test("prior is 0.25 but carries no evidence", () => {
  const p = priorPosterior();
  assert.equal(posteriorMean(p), 0.25);
  assert.equal(evidenceCount(p), 0);
  assert.equal(sufficiency(p), "none");
});

test("one correct deterministic observation does not produce demonstrated mastery", () => {
  const s = apply(emptySkillState(), ev());
  assert.ok(Math.abs(posteriorMean({ alpha: s.alpha, beta: s.beta }) - 0.4) < 1e-9);
  assert.equal(classifySkill(s), "developing");
  assert.notEqual(classifySkill(s), "demonstrated");
});

test("an incorrect observation lowers mastery", () => {
  const good = apply(emptySkillState(), ev({ q: 1 }));
  const bad = apply(emptySkillState(), ev({ q: 0, correct: false }));
  assert.ok(posteriorMean({ alpha: bad.alpha, beta: bad.beta }) < posteriorMean({ alpha: good.alpha, beta: good.beta }));
});

test("partial task score gives partial credit", () => {
  const half = updatePosterior(priorPosterior(), 0.5, 1);
  const full = updatePosterior(priorPosterior(), 1, 1);
  assert.ok(posteriorMean(half) < posteriorMean(full));
  assert.ok(posteriorMean(half) > 0.25);
});

test("weaker AI evidence moves mastery far less than deterministic evidence", () => {
  // Real configuration: an executed test suite vs an unvalidated AI opinion.
  const det = updatePosterior(priorPosterior(), 1, effectiveWeight({ method: "deterministic", taskValidity: 1 }));
  const ai = updatePosterior(priorPosterior(), 1, effectiveWeight({ method: "ai-interpretation", taskValidity: 0.7 }));
  const detDelta = posteriorMean(det) - 0.25;
  const aiDelta = posteriorMean(ai) - 0.25;
  assert.ok(aiDelta > 0, "AI evidence is weak but not zero");
  assert.ok(aiDelta < detDelta * 0.5, "AI evidence must move mastery less than half as far");
});

test("repeated failures lower mastery and keep it out of demonstrated", () => {
  const s = apply(emptySkillState(), ev({ q: 0, correct: false }), ev({ q: 0, correct: false }), ev({ q: 0, correct: false }));
  assert.ok(posteriorMean({ alpha: s.alpha, beta: s.beta }) < 0.3);
  assert.equal(classifySkill(s), "needs_attention");
});

test("recent independent successes lift a skill out of needs_attention", () => {
  // Five failures put the skill firmly in needs_attention...
  const failed = apply(emptySkillState(), ...Array.from({ length: 5 }, () => ev({ q: 0, correct: false })));
  assert.equal(classifySkill(failed), "needs_attention");
  // ...but two RECENT independent successes must be able to recover it, rather
  // than ancient failures keeping it red forever.
  const recovered = apply(
    failed,
    ev({ q: 1, correct: true, taskFamily: "fam-b" }),
    ev({ q: 1, correct: true, taskFamily: "fam-c" }),
  );
  assert.equal(classifySkill(recovered), "developing");
});

test("credible interval tightens as evidence accumulates", () => {
  let s = emptySkillState();
  const first = credibleInterval({ alpha: s.alpha, beta: s.beta });
  for (let i = 0; i < 10; i++) s = apply(s, ev());
  const later = credibleInterval({ alpha: s.alpha, beta: s.beta });
  assert.ok(later.upper - later.lower < first.upper - first.lower);
});

// ── Evidence weighting (§14) ────────────────────────────────

test("method reliability is ordered deterministic > rubric > ai > trace", () => {
  assert.ok(METHOD_RELIABILITY.deterministic > METHOD_RELIABILITY.rubric);
  assert.ok(METHOD_RELIABILITY.rubric > METHOD_RELIABILITY["ai-interpretation"]);
  assert.ok(METHOD_RELIABILITY["ai-interpretation"] > METHOD_RELIABILITY.trace);
});

test("supporting skills never receive full evidence weight", () => {
  const primary = effectiveWeight({ method: "deterministic", role: "primary" });
  const supporting = effectiveWeight({ method: "deterministic", role: "supporting" });
  assert.equal(primary, 1);
  assert.ok(supporting <= SKILL_ROLE_FACTOR.supporting + 1e-9);
  assert.ok(supporting < primary);
});

test("supported success is weaker but still positive evidence", () => {
  const independent = observedScore({ correct: true, supportUsed: 0 });
  const supported = observedScore({ correct: true, supportUsed: 1 });
  assert.equal(independent, 1);
  assert.ok(supported > 0 && supported < independent);
  // A failure is not softened by the support discount.
  assert.equal(observedScore({ correct: false, supportUsed: 1 }), 0);
});

test("unvalidated evidence carries less weight than a validated task", () => {
  const validated = effectiveWeight({ method: "deterministic", taskValidity: 1 });
  const unvalidated = effectiveWeight({ method: "deterministic", taskValidity: 0.7 });
  assert.ok(unvalidated < validated);
});

// ── Metric isolation (§85) ──────────────────────────────────

test("an ordinary task does not increase transfer", () => {
  const s = apply(emptySkillState(), ev({ transferLevel: 0.1 }));
  assert.equal(s.transfer, 0);
  assert.equal(s.transferAttempts, 0);
});

test("a classified transfer task does increase transfer", () => {
  const s = apply(emptySkillState(), ev({ transferLevel: 0.9 }));
  assert.ok(s.transfer > 0);
  assert.equal(s.transferAttempts, 1);
});

test("an ordinary successful task does not increase retention", () => {
  const s = apply(emptySkillState(), ev());
  assert.equal(s.retentionChecks, 0);
  assert.equal(s.retention, 0);
});

test("a same-session retrieval check does not count as retention", () => {
  const s = apply(emptySkillState(), ev({ retentionCheck: true, retentionDelayed: false }));
  assert.equal(s.retentionChecks, 0);
});

test("a delayed retrieval check does produce a retention estimate", () => {
  const s = apply(emptySkillState(), ev({ retentionCheck: true, retentionDelayed: true }));
  assert.equal(s.retentionChecks, 1);
  assert.ok(s.retention > 0.5);
  assert.ok(s.lastRetrievedAt instanceof Date);
});

test("application only moves for explicitly integrated activities", () => {
  const single = apply(emptySkillState(), ev({ integrationLevel: 0.15 }));
  assert.equal(single.application, 0);
  assert.equal(single.integrationAttempts, 0);

  const integrated = apply(emptySkillState(), ev({ integrationLevel: 0.9 }));
  assert.ok(integrated.application > 0);
  assert.equal(integrated.integrationAttempts, 1);
});

test("independence grows with independent success and shrinks with support", () => {
  const independent = apply(emptySkillState(), ev({ supportUsed: 0 }));
  const supported = apply(emptySkillState(), ev({ supportUsed: 1 }));
  assert.ok(independent.independence > supported.independence);
  assert.ok(supported.independence === 0);
});

test("a failure never increases independence", () => {
  let s = apply(emptySkillState(), ev());
  const before = s.independence;
  s = apply(s, ev({ q: 0, correct: false }));
  assert.ok(s.independence < before);
});

test("support dependence is a rolling average of assistance used", () => {
  const s = apply(emptySkillState(), ev({ supportUsed: 1 }), ev({ supportUsed: 1 }));
  assert.ok(s.supportDependence > 0.3 && s.supportDependence < 1);
});

// ── Depth (§20) ─────────────────────────────────────────────

test("depth needs repeated independent success at the demonstrated level", () => {
  const once = apply(emptySkillState(), ev({ cognitiveLevel: "apply" }));
  assert.equal(once.depth, "recognition");

  const twice = apply(emptySkillState(), ev({ cognitiveLevel: "apply" }), ev({ cognitiveLevel: "apply", taskFamily: "fam-b" }));
  assert.equal(twice.depth, "application");
});

test("an application task never proves analysis", () => {
  const s = apply(emptySkillState(), ev({ cognitiveLevel: "apply" }), ev({ cognitiveLevel: "apply", taskFamily: "fam-b" }));
  assert.equal(s.depth, "application");
  assert.notEqual(s.depth, "analysis");
});

test("supported success does not advance depth", () => {
  const s = apply(emptySkillState(), ev({ supportUsed: 1 }), ev({ supportUsed: 1 }));
  assert.equal(s.depth, "recognition");
});

// ── Classification boundaries (§86) ─────────────────────────

test("no evidence means not assessed", () => {
  assert.equal(classifySkill(emptySkillState()), "not_assessed");
});

test("a single failure with evidence is needs_attention, not developing", () => {
  const s = apply(emptySkillState(), ev({ q: 0, correct: false }));
  assert.equal(classifySkill(s), "needs_attention");
});

test("mixed evidence is developing, not demonstrated", () => {
  const s = apply(emptySkillState(), ev(), ev({ q: 0, correct: false }));
  assert.equal(classifySkill(s), "developing");
});

test("strong status requires evidence, independence, variation and interval", () => {
  let s = emptySkillState();
  const fam = ["fam-a", "fam-b"];
  for (let i = 0; i < 8; i++) s = apply(s, ev({ taskFamily: fam[i % 2] }));
  assert.equal(classifySkill(s), "demonstrated");
});

test("high mastery built on one task family is not demonstrated", () => {
  let s = emptySkillState();
  for (let i = 0; i < 8; i++) s = apply(s, ev({ taskFamily: "only-family" }));
  assert.notEqual(classifySkill(s), "demonstrated");
  assert.equal(classifySkill(s), "developing");
});

test("an unresolved critical misconception blocks a demonstrated status", () => {
  let s = emptySkillState();
  const fam = ["fam-a", "fam-b"];
  for (let i = 0; i < 8; i++) s = apply(s, ev({ taskFamily: fam[i % 2] }));
  assert.equal(classifySkill(s), "demonstrated");
  assert.notEqual(
    classifySkill(s, [{ status: "active", confidence: CLASSIFICATION.misconceptionBlocksDemonstrated + 0.01 }]),
    "demonstrated",
  );
  assert.equal(
    classifySkill(s, [{ status: "active", confidence: CLASSIFICATION.needsAttentionMisconceptionConfidence + 0.01 }]),
    "needs_attention",
  );
});

test("resolved misconceptions no longer block", () => {
  let s = emptySkillState();
  const fam = ["fam-a", "fam-b"];
  for (let i = 0; i < 8; i++) s = apply(s, ev({ taskFamily: fam[i % 2] }));
  assert.equal(classifySkill(s, [{ status: "resolved", confidence: 0.9 }]), "demonstrated");
});

// ── Read model (§22, §23) ───────────────────────────────────

test("metrics without evidence are reported as not assessed, not fabricated", () => {
  const m = skillMetrics(emptySkillState());
  assert.equal(m.status, "not_assessed");
  assert.equal(m.mastery.value, null);
  assert.equal(m.masteryInterval, null);
  assert.equal(m.independence.value, null);
  assert.equal(m.application.value, null);
  assert.equal(m.transfer.value, null);
  assert.equal(m.retention.value, null);
  assert.equal(m.depth, null);
});

test("mastery without evidence is never surfaced as a number", () => {
  const m = skillMetrics(emptySkillState());
  assert.notEqual(m.mastery.value, 0.25);
});

test("a supported success does not make a skill demonstrated", () => {
  let s = emptySkillState();
  for (let i = 0; i < 6; i++) s = apply(s, ev({ supportUsed: 1, q: 0.6, taskFamily: i % 2 ? "fam-a" : "fam-b" }));
  assert.notEqual(classifySkill(s), "demonstrated");
});

test("after the diagnosis scenario: many hints then independent successes", () => {
  // One easy task with several hints → must not become green.
  let s = apply(emptySkillState(), ev({ supportUsed: 1, q: 0.6 }));
  assert.notEqual(classifySkill(s), "demonstrated");

  // Then repeated independent successes across contexts → may become demonstrated.
  const fam = ["fam-a", "fam-b"];
  for (let i = 0; i < 8; i++) s = apply(s, ev({ taskFamily: fam[i % 2] }));
  assert.equal(classifySkill(s), "demonstrated");
  assert.ok(s.independentSuccesses >= CLASSIFICATION.demonstratedMinIndependentSuccesses);
});

// ── Retention estimate (§19) ────────────────────────────────

test("retention estimate decays with elapsed time", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-01-29T00:00:00Z"); // 28 days = two half-lives
  const fresh = retentionEstimate(1, at, at);
  const decayed = retentionEstimate(1, at, later);
  assert.ok(Math.abs(fresh - 1) < 1e-9);
  assert.ok(Math.abs(decayed - 0.25) < 1e-6);
});

test("threshold constants are internally consistent", () => {
  assert.ok(CLASSIFICATION.needsAttentionMastery < CLASSIFICATION.demonstratedMastery);
  assert.ok(CLASSIFICATION.misconceptionBlocksDemonstrated < CLASSIFICATION.needsAttentionMisconceptionConfidence);
  assert.ok(RULES.transferThreshold > 0.1, "ordinary transfer level must be below the threshold");
  assert.ok(RULES.integrationThreshold > 0.15, "single-skill integration must be below the threshold");
});

// ── Failure diagnosis (§86) ──────────────────────────────

test("active misconception is diagnosed as misconception", () => {
  assert.equal(
    classifyFailureCause({ wasDemonstrated: true, retentionStale: true, activeMisconception: true }),
    "misconception",
  );
});

test("demonstrated + stale retention is diagnosed as forgetting", () => {
  assert.equal(
    classifyFailureCause({ wasDemonstrated: true, retentionStale: true, activeMisconception: false }),
    "forgetting",
  );
});

test("never demonstrated is diagnosed as never_mastered", () => {
  assert.equal(
    classifyFailureCause({ wasDemonstrated: false, retentionStale: false, activeMisconception: false }),
    "never_mastered",
  );
});

test("demonstrated + fresh + no misconception is an execution slip", () => {
  assert.equal(
    classifyFailureCause({ wasDemonstrated: true, retentionStale: false, activeMisconception: false }),
    "execution_error",
  );
});

// ── Adaptive instruction format (§70, §74) ────────────────

test("low mastery gets a worked example with low independence", () => {
  const f = instructionFormat(0.2);
  assert.equal(f.format, "worked_example");
  assert.equal(f.blankStarter, false);
  assert.ok(f.independenceRequired <= 0.3);
});

test("high mastery fades to independent work with a blank starter", () => {
  const f = instructionFormat(0.9);
  assert.equal(f.format, "independent");
  assert.equal(f.blankStarter, true);
  assert.ok(f.independenceRequired >= 0.9);
});

test("null mastery falls back to worked example", () => {
  assert.equal(instructionFormat(null).format, "worked_example");
});

// ── Confident mastery → roadmap compression (§29) ─────────

test("a fresh skill is not confidently mastered", () => {
  assert.equal(isConfidentlyMastered(emptySkillState()), false);
});

test("sustained unaided success becomes confidently mastered", () => {
  const s = apply(emptySkillState(), ev(), ev(), ev(), ev(), ev(), ev());
  assert.equal(isConfidentlyMastered(s), true);
});

test("high mastery built on support is not confidently mastered", () => {
  let s = emptySkillState();
  for (let i = 0; i < 12; i++) s = applyEvidenceToSkill(s, ev({ q: 0.9, supportUsed: 1 }));
  assert.ok(posteriorMean({ alpha: s.alpha, beta: s.beta }) >= 0.6);
  assert.equal(isConfidentlyMastered(s), false);
});

test("a live streak overrides elevated support dependence", () => {
  let s = emptySkillState();
  for (let i = 0; i < 8; i++) s = applyEvidenceToSkill(s, ev({ q: 0.9, supportUsed: 1 }));
  s = apply(s, ev(), ev());
  assert.ok(s.successStreak >= 2);
  assert.equal(isConfidentlyMastered(s), true);
});
