import type { CompetencyState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSkill, misconception } from "./knowledge-graph";
import { posteriorMean, posteriorStd, retentionEstimate, RETENTION_DUE_THRESHOLD, daysUntilRetentionDue } from "./mastery";
import {
  applyEvidenceToSkill,
  classifySkill,
  emptySkillState,
  skillMetrics,
  RULES,
  type SkillState,
} from "./competency";
import { effectiveWeight, observedScore, TASK_VALIDITY } from "./evidence";
import type { CompetencyView, EvidencePayload, MisconceptionView } from "./types";

// ─────────────────────────────────────────────────────────────
// Student Learning Twin (§10–21).
//
// This module does ONE thing: it loads the persisted state, delegates every
// rule to the pure competency core, and writes the result back. All metric
// mathematics lives in mastery.ts / competency.ts / evidence.ts.
// ─────────────────────────────────────────────────────────────

const DEFAULT_VALIDITY: Record<string, number> = {
  diagnostic: TASK_VALIDITY.keyed,
  attempt: TASK_VALIDITY.validated,
  tutor: TASK_VALIDITY.unvalidated,
};

function toSkillState(s: CompetencyState): SkillState {
  return {
    alpha: s.masteryAlpha,
    beta: s.masteryBeta,
    depth: s.depth,
    independence: s.independence,
    application: s.application,
    transfer: s.transfer,
    retention: s.retention,
    evidenceCount: s.evidenceCount,
    attempts: s.attempts,
    independentSuccesses: s.independentSuccesses,
    integrationAttempts: s.integrationAttempts,
    transferAttempts: s.transferAttempts,
    retentionChecks: s.retentionChecks,
    retentionSuccesses: s.retentionSuccesses,
    supportDependence: s.supportDependence,
    taskFamilies: safeJson<string[]>(s.taskFamilies, []),
    depthCounts: safeJson<Record<string, number>>(s.depthCounts, {}),
    lastRetrievedAt: s.lastRetrievedAt,
    lastAssessmentAt: s.lastAssessmentAt,
  };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function ensureCompetency(learnerId: string, skillId: string) {
  const existing = await prisma.competencyState.findUnique({
    where: { learnerId_skillId: { learnerId, skillId } },
  });
  if (existing) return existing;
  return prisma.competencyState.create({
    data: {
      learnerId,
      skillId,
      masteryAlpha: 1,
      masteryBeta: 3,
      mastery: 0.25,
      masteryUncertainty: 0.5,
      retention: 0,
    },
  });
}

function roleFor(skillId: string, primarySkillId: string | undefined, skillIds: string[]): "primary" | "supporting" {
  const primary = primarySkillId ?? skillIds[0];
  return skillId === primary ? "primary" : "supporting";
}

/**
 * Apply one piece of evidence to every affected skill's competency vector.
 *
 * The primary target skill receives full evidence weight; supporting skills
 * receive a reduced weight (§14). Every dimension has an explicit trigger in
 * the competency core — nothing moves merely because something happened.
 */
export async function applyEvidence(input: {
  learnerId: string;
  skillIds: string[];
  primarySkillId?: string;
  value: EvidencePayload;
}): Promise<void> {
  const { learnerId, skillIds, value } = input;
  if (skillIds.length === 0) return;

  const taskValidity = value.taskValidity ?? DEFAULT_VALIDITY[value.kind] ?? TASK_VALIDITY.validated;
  const q = observedScore({
    correct: value.correct,
    passedRatio: value.passedRatio,
    supportUsed: value.supportUsed,
  });
  const at = new Date();

  for (const skillId of skillIds) {
    const row = await ensureCompetency(learnerId, skillId);
    const role = roleFor(skillId, input.primarySkillId, skillIds);
    const weight = effectiveWeight({
      method: value.method,
      role,
      taskValidity,
      relevance: role === "primary" ? 1 : 0.6,
    });

    const next = applyEvidenceToSkill(toSkillState(row), {
      q,
      weight,
      correct: value.correct,
      supportUsed: value.supportUsed,
      integrationLevel: value.integrationLevel ?? 0,
      transferLevel: value.transferLevel ?? 0,
      retentionCheck: value.retentionCheck,
      retentionDelayed: value.retentionDelayed ?? false,
      cognitiveLevel: value.cognitiveLevel,
      taskFamily: value.taskFamily ?? "",
      at,
    });

    await prisma.competencyState.update({
      where: { id: row.id },
      data: {
        masteryAlpha: next.alpha,
        masteryBeta: next.beta,
        mastery: posteriorMean({ alpha: next.alpha, beta: next.beta }),
        masteryUncertainty: posteriorStd({ alpha: next.alpha, beta: next.beta }),
        depth: next.depth,
        independence: next.independence,
        application: next.application,
        transfer: next.transfer,
        retention: next.retention,
        evidenceCount: next.evidenceCount,
        attempts: next.attempts,
        successes: value.correct ? { increment: 1 } : undefined,
        independentSuccesses: next.independentSuccesses,
        integrationAttempts: next.integrationAttempts,
        transferAttempts: next.transferAttempts,
        retentionChecks: next.retentionChecks,
        retentionSuccesses: next.retentionSuccesses,
        supportDependence: next.supportDependence,
        taskFamilies: JSON.stringify(next.taskFamilies),
        depthCounts: JSON.stringify(next.depthCounts),
        lastSeenAt: at,
        lastAssessmentAt: next.lastAssessmentAt,
        lastRetrievedAt: next.lastRetrievedAt,
      },
    });
  }

  // Misconception bookkeeping (§19, §83–85).
  const detected = value.misconceptions ?? [];
  for (const skillId of skillIds) {
    for (const code of detected) {
      const def = misconceptionOf(code);
      if (!def || !def.affectedSkills.includes(skillId)) continue;
      await applyMisconceptionSignal(learnerId, skillId, code, value);
    }
  }
}

function misconceptionOf(code: string) {
  return misconception(code);
}

async function applyMisconceptionSignal(
  learnerId: string,
  skillId: string,
  code: string,
  value: EvidencePayload,
) {
  const existing = await prisma.misconception.findUnique({
    where: { learnerId_skillId_code: { learnerId, skillId, code } },
  });

  if (value.correct && value.supportUsed < RULES.independenceThreshold) {
    // Contradicting evidence: resolve only after sustained independent success.
    if (!existing) return;
    if (existing.status === "monitoring") {
      await prisma.misconception.update({
        where: { id: existing.id },
        data: { status: "resolved", confidence: 0.15, resolvedAt: new Date() },
      });
    } else {
      await prisma.misconception.update({
        where: { id: existing.id },
        data: { status: "monitoring", confidence: Math.max(0, existing.confidence - 0.35) },
      });
    }
    return;
  }

  const def = misconceptionOf(code);
  if (!existing) {
    await prisma.misconception.create({
      data: { learnerId, skillId, code, description: def?.name ?? code, confidence: 0.5, status: "active" },
    });
  } else {
    await prisma.misconception.update({
      where: { id: existing.id },
      data: {
        confidence: Math.min(1, existing.confidence + 0.25),
        status: existing.status === "resolved" ? "monitoring" : "active",
      },
    });
  }
}

/** All skills' metrics in one pass — used by the knowledge map and hub. */
export async function getAllSkillMetrics(learnerId: string) {
  const [states, misconceptions] = await Promise.all([
    prisma.competencyState.findMany({ where: { learnerId } }),
    prisma.misconception.findMany({ where: { learnerId, status: { in: ["active", "monitoring"] } } }),
  ]);
  const miscBySkill = new Map<string, { status: string; confidence: number }[]>();
  for (const m of misconceptions) {
    const arr = miscBySkill.get(m.skillId) ?? [];
    arr.push({ status: m.status, confidence: m.confidence });
    miscBySkill.set(m.skillId, arr);
  }
  const now = new Date();
  const map = new Map<string, ReturnType<typeof skillMetrics>>();
  for (const row of states) {
    map.set(row.skillId, skillMetrics(toSkillState(row), miscBySkill.get(row.skillId) ?? [], now));
  }
  return map;
}

/** Read one skill's competency view — the only shape the UI may consume. */
export async function getCompetencyView(
  learnerId: string,
  skillId: string,
): Promise<CompetencyView | null> {
  const skill = getSkill(skillId);
  if (!skill) return null;
  const row = await prisma.competencyState.findUnique({
    where: { learnerId_skillId: { learnerId, skillId } },
  });
  const misconceptions = row
    ? await prisma.misconception.findMany({
        where: { learnerId, skillId, status: { in: ["active", "monitoring"] } },
      })
    : [];
  const state = row ? toSkillState(row) : emptySkillState();
  const m = skillMetrics(
    state,
    misconceptions.map((x) => ({ status: x.status, confidence: x.confidence })),
  );

  return {
    skillId,
    name: skill.name,
    domain: skill.domain,
    category: skill.category,
    difficulty: skill.difficulty,
    status: m.status,
    mastery: m.mastery.value,
    masteryInterval: m.masteryInterval,
    sufficiency: m.sufficiency,
    evidenceCount: m.evidenceCount,
    independentSuccesses: m.independentSuccesses,
    taskFamilies: m.taskFamilies,
    lastAssessmentAt: m.lastAssessmentAt,
    depth: m.depth,
    independence: m.independence.value,
    application: m.application.value,
    transfer: m.transfer.value,
    retention: m.retention.value,
    supportDependence: m.supportDependence.value,
    attempts: state.attempts,
    misconceptions: misconceptions.map((x) => x.code),
  };
}

/** Skills currently due for spaced retrieval review (§87–88). */
export async function getDueReviews(learnerId: string) {
  const states = await prisma.competencyState.findMany({ where: { learnerId } });
  const now = new Date();
  const due = states
    .filter((c) => c.retentionChecks > 0 && retentionEstimate(c.retention, c.lastRetrievedAt, now) < RETENTION_DUE_THRESHOLD)
    .map((c) => ({
      skillId: c.skillId,
      name: getSkill(c.skillId)?.name ?? c.skillId,
      mastery: c.mastery,
      retention: retentionEstimate(c.retention, c.lastRetrievedAt, now),
      daysUntilDue: daysUntilRetentionDue(c.retention, c.lastRetrievedAt, now) ?? 0,
      lastRetrievedAt: c.lastRetrievedAt ? c.lastRetrievedAt.toISOString() : null,
    }))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return due;
}

export async function getActiveMisconceptions(learnerId: string): Promise<MisconceptionView[]> {
  const rows = await prisma.misconception.findMany({
    where: { learnerId, status: { in: ["active", "monitoring"] } },
    orderBy: { confidence: "desc" },
  });
  return rows.map((r) => {
    const def = misconceptionOf(r.code);
    return {
      code: r.code,
      name: def?.name ?? r.description,
      description: def?.description ?? r.description,
      skillId: r.skillId,
      confidence: r.confidence,
      status: r.status,
      correction: def?.correction ?? "",
    };
  });
}

/** Aggregate learner summary used by the home page and the Learning hub. */
export async function getLearnerSummary(learnerId: string) {
  const [competencies, misconceptions, evidence, recommendations, events, attempts] = await Promise.all([
    prisma.competencyState.findMany({ where: { learnerId } }),
    prisma.misconception.findMany({ where: { learnerId, status: { in: ["active", "monitoring"] } } }),
    prisma.evidence.findMany({ where: { learnerId }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.recommendation.findMany({ where: { learnerId, status: "pending" }, orderBy: { priority: "desc" }, take: 5 }),
    prisma.learningEvent.findMany({ where: { learnerId }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.taskAttempt.findMany({ where: { learnerId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const now = new Date();
  const miscBySkill = new Map<string, { status: string; confidence: number }[]>();
  for (const m of misconceptions) {
    const arr = miscBySkill.get(m.skillId) ?? [];
    arr.push({ status: m.status, confidence: m.confidence });
    miscBySkill.set(m.skillId, arr);
  }

  const skills = competencies.map((c) => {
    const skill = getSkill(c.skillId);
    const state = toSkillState(c);
    const mk = skillMetrics(state, miscBySkill.get(c.skillId) ?? [], now);
    return {
      skillId: c.skillId,
      name: skill?.name ?? c.skillId,
      domain: skill?.domain ?? "",
      status: mk.status,
      mastery: mk.mastery.value,
      masteryInterval: mk.masteryInterval,
      sufficiency: mk.sufficiency,
      evidenceCount: mk.evidenceCount,
      independentSuccesses: mk.independentSuccesses,
      taskFamilies: mk.taskFamilies,
      depth: mk.depth,
      independence: mk.independence.value,
      application: mk.application.value,
      transfer: mk.transfer.value,
      retention: mk.retention.value,
      supportDependence: mk.supportDependence.value,
      attempts: c.attempts,
      successes: c.successes,
      lastAssessmentAt: mk.lastAssessmentAt,
      retentionDue:
        c.retentionChecks > 0 && retentionEstimate(c.retention, c.lastRetrievedAt, now) < 0.6,
    };
  });

  const counts = {
    assessed: skills.filter((s) => s.status !== "not_assessed").length,
    demonstrated: skills.filter((s) => s.status === "demonstrated").length,
    developing: skills.filter((s) => s.status === "developing").length,
    needsAttention: skills.filter((s) => s.status === "needs_attention").length,
    notAssessed: skills.filter((s) => s.status === "not_assessed").length,
  };

  return {
    skills,
    counts,
    misconceptionCount: misconceptions.length,
    evidenceCount: await prisma.evidence.count({ where: { learnerId } }),
    attemptCount: attempts.length,
    recentEvidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      method: e.method,
      summary: e.summary,
      strength: e.strength,
      createdAt: e.createdAt.toISOString(),
      skillIds: safeJson<string[]>(e.skillIds, []),
    })),
    recentAttempts: attempts.slice(0, 15).map((a) => ({
      id: a.id,
      passed: a.passed,
      total: a.total,
      passedAll: a.passedAll,
      hintsUsed: a.hintsUsed,
      createdAt: a.createdAt.toISOString(),
    })),
    recommendations: recommendations.map((r) => ({
      action: safeJson<Record<string, unknown>>(r.action, {}),
      reason: r.reason,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
    })),
    events: events.map((e) => ({
      type: e.type,
      skillId: e.skillId,
      createdAt: e.createdAt.toISOString(),
      payload: safeJson<Record<string, unknown>>(e.payload, {}),
    })),
  };
}

/**
 * "What should I do next?" (§11.13). Candidates are scored from evidence and
 * retention state — never from a mysterious global number.
 */
export async function recommendNext(learnerId: string, roadmapId?: string) {
  const now = new Date();
  const [competencies, roadmapItems, activeMisconceptions] = await Promise.all([
    prisma.competencyState.findMany({ where: { learnerId } }),
    roadmapId
      ? prisma.roadmapItem.findMany({ where: { roadmapId, origin: "main" }, orderBy: { index: "asc" } })
      : Promise.resolve([]),
    prisma.misconception.findMany({ where: { learnerId, status: "active" }, orderBy: { confidence: "desc" }, take: 3 }),
  ]);

  const comp = new Map(competencies.map((c) => [c.skillId, c]));

  const candidates: {
    item: { id: string; index: number; phase: string; title: string; skillIds: string[]; type: string; status: string };
    score: number;
    reason: string;
  }[] = [];

  for (const item of roadmapItems) {
    if (item.status === "completed") continue;
    const skills = safeJson<string[]>(item.skillIds, []);
    if (skills.length === 0) continue;
    const ready = skills.every((sid) => {
      const def = getSkill(sid);
      return (def?.prerequisites ?? []).every((p) => {
        const pc = comp.get(p);
        return pc && pc.mastery >= 0.5;
      });
    });
    if (!ready) continue;

    const weakest = Math.min(...skills.map((sid) => comp.get(sid)?.mastery ?? 0));
    const retentionUrgency = Math.min(
      ...skills.map((sid) => {
        const c = comp.get(sid);
        if (!c || c.retentionChecks === 0) return 0;
        return 1 - retentionEstimate(c.retention, c.lastRetrievedAt, now);
      }),
    );
    const score = (1 - weakest) * 0.7 + retentionUrgency * 0.3 + (skills.length > 1 ? 0.05 : 0);
    candidates.push({
      item: { id: item.id, index: item.index, phase: item.phase, title: item.title, skillIds: skills, type: item.type, status: item.status },
      score,
      reason: "next in your roadmap",
    });
  }

  // Retention review candidates: measured retention that has decayed below the bar.
  const retentionCandidates = competencies
    .filter((c) => c.mastery >= 0.55 && c.retentionChecks > 0 && retentionEstimate(c.retention, c.lastRetrievedAt, now) < 0.6)
    .map((c) => ({
      item: {
        id: `retention:${c.skillId}`,
        index: 999,
        phase: "Retention",
        title: getSkill(c.skillId)?.name ?? c.skillId,
        skillIds: [c.skillId],
        type: "retention",
        status: "ready",
      },
      score: (1 - retentionEstimate(c.retention, c.lastRetrievedAt, now)) * 0.9,
      reason: "due for retrieval practice",
    }));

  const misCandidates = activeMisconceptions.map((m) => ({
    item: {
      id: `intervention:${m.skillId}:${m.code}`,
      index: 500,
      phase: "Intervention",
      title: misconceptionOf(m.code)?.name ?? m.code,
      skillIds: [m.skillId],
      type: "assessment",
      status: "ready",
    },
    score: 0.75 + m.confidence * 0.2,
    reason: "active misconception detected",
  }));

  const all = [...candidates, ...retentionCandidates, ...misCandidates].sort((a, b) => b.score - a.score);
  const top = all[0];

  return {
    next: top
      ? {
          type: top.item.type,
          title: top.item.title,
          description: top.reason,
          itemId: top.item.id,
          phase: top.item.phase,
          skillIds: top.item.skillIds,
          score: top.score,
        }
      : null,
    queue: all.slice(0, 6).map((c) => ({ title: c.item.title, reason: c.reason, score: c.score })),
  };
}

export { classifySkill };
