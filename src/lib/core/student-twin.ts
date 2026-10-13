import { prisma } from "@/lib/db";
import { clamp } from "@/lib/utils";
import { getSkill, misconception } from "./knowledge-graph";
import { initialMastery, promoteDepth, supportTier, updateMastery } from "./mastery";
import type { CompetencyView, EvidencePayload, MisconceptionView } from "./types";

// ─────────────────────────────────────────────────────────────
// Student Learning Twin (§10–21).
// A persistent, evidence-based competency model. Not a personality
// profile — an educational state model that can always be explained.
// ─────────────────────────────────────────────────────────────

async function ensureCompetency(learnerId: string, skillId: string) {
  const existing = await prisma.competencyState.findUnique({
    where: { learnerId_skillId: { learnerId, skillId } },
  });
  if (existing) return existing;
  const init = initialMastery();
  return prisma.competencyState.create({
    data: {
      learnerId,
      skillId,
      mastery: init.mastery,
      masteryUncertainty: init.uncertainty,
      depth: "recognition",
      independence: 0,
      application: 0,
      transfer: 0,
      retention: 1,
    },
  });
}

/** Apply one piece of evidence to every affected skill's competency vector. */
export async function applyEvidence(input: {
  learnerId: string;
  skillIds: string[];
  value: EvidencePayload;
}): Promise<void> {
  const { learnerId, skillIds, value } = input;

  for (const skillId of skillIds) {
    const state = await ensureCompetency(learnerId, skillId);
    const supportWeight = clamp(value.supportUsed, 0, 1);

    const m = updateMastery(
      { mastery: state.mastery, uncertainty: state.masteryUncertainty },
      value.correct,
      value.strength,
    );

    // Independence: grows on unsupported success, shrinks on help reliance.
    const independenceTarget = value.correct
      ? clamp(1 - supportWeight)
      : clamp(state.independence - 0.15, 0, 1);
    const independence = clamp(state.independence + 0.25 * (independenceTarget - state.independence));

    // Application/integration: only integration tasks move it (§16).
    let application = state.application;
    if (value.integrated) {
      application = clamp(state.application + (value.correct ? 0.18 : -0.12));
    }

    // Transfer: distinct from repetition (§17).
    let transfer = state.transfer;
    if (value.transferLevel > 0) {
      transfer = clamp(state.transfer + (value.correct ? 0.2 : -0.08));
    }

    // Retention: retrieval success raises it, failures decay it (§18).
    let retention = state.retention;
    if (value.retentionCheck) {
      retention = clamp(state.retention + (value.correct ? 0.25 : -0.35));
    } else {
      retention = clamp(retention * 0.99 + 0.01);
    }

    // Cognitive depth only advances on genuinely independent success.
    const depth =
      value.correct && supportWeight < 0.5
        ? promoteDepth(state.depth, value.cognitiveLevel)
        : state.depth;

    await prisma.competencyState.update({
      where: { id: state.id },
      data: {
        mastery: m.mastery,
        masteryUncertainty: m.uncertainty,
        depth,
        independence,
        application,
        transfer,
        retention,
        attempts: { increment: 1 },
        successes: value.correct ? { increment: 1 } : undefined,
        hintDependence: clamp(state.hintDependence + (value.hintsUsed > 0 ? 0.12 : -0.05)),
        lastSeenAt: new Date(),
        lastRetrievedAt: value.retentionCheck ? new Date() : undefined,
      },
    });
  }

  // Misconception bookkeeping (§19, §83–85).
  const detected = value.misconceptions ?? [];
  for (const skillId of skillIds) {
    for (const code of detected) {
      const def = misconception(code);
      if (!def || !def.affectedSkills.includes(skillId)) continue;
      await applyMisconceptionSignal(learnerId, skillId, code, value);
    }
  }
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

  if (value.correct && value.supportUsed < 0.5) {
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
        data: { status: "monitoring", confidence: clamp(existing.confidence - 0.35) },
      });
    }
    return;
  }

  const def = misconception(code);
  if (!existing) {
    await prisma.misconception.create({
      data: {
        learnerId,
        skillId,
        code,
        description: def?.name ?? code,
        confidence: 0.5,
        status: "active",
      },
    });
  } else {
    await prisma.misconception.update({
      where: { id: existing.id },
      data: {
        confidence: clamp(existing.confidence + 0.25),
        status: existing.status === "resolved" ? "monitoring" : "active",
      },
    });
  }
}

export async function getCompetencyView(
  learnerId: string,
  skillId: string,
): Promise<CompetencyView | null> {
  const state = await prisma.competencyState.findUnique({
    where: { learnerId_skillId: { learnerId, skillId } },
  });
  const skill = getSkill(skillId);
  if (!skill) return null;

  const misconceptions = state
    ? await prisma.misconception.findMany({
        where: { learnerId, skillId, status: { in: ["active", "monitoring"] } },
      })
    : [];

  return {
    skillId,
    name: skill.name,
    domain: skill.domain,
    category: skill.category,
    difficulty: skill.difficulty,
    mastery: state?.mastery ?? initialMastery().mastery,
    uncertainty: state?.masteryUncertainty ?? 1,
    support: supportTier(state?.masteryUncertainty ?? 1),
    depth: state?.depth ?? "recognition",
    independence: state?.independence ?? 0,
    application: state?.application ?? 0,
    transfer: state?.transfer ?? 0,
    retention: state?.retention ?? 1,
    attempts: state?.attempts ?? 0,
    successes: state?.successes ?? 0,
    hintDependence: state?.hintDependence ?? 0,
    lastSeenAt: state?.lastSeenAt?.toISOString() ?? null,
    misconceptions: misconceptions.map((m) => m.code),
  };
}

export async function getActiveMisconceptions(learnerId: string): Promise<MisconceptionView[]> {
  const rows = await prisma.misconception.findMany({
    where: { learnerId, status: { in: ["active", "monitoring"] } },
    orderBy: { confidence: "desc" },
  });
  return rows
    .map((r) => {
      const def = misconception(r.code);
      return {
        code: r.code,
        name: def?.name ?? r.description,
        description: def?.description ?? r.description,
        skillId: r.skillId,
        confidence: r.confidence,
        status: r.status,
        correction: def?.correction ?? "",
      };
    })
    .filter((x) => x !== null) as MisconceptionView[];
}

export async function getLearnerSummary(learnerId: string) {
  const [competencies, misconceptions, evidence, recommendations, events] = await Promise.all([
    prisma.competencyState.findMany({ where: { learnerId } }),
    prisma.misconception.findMany({ where: { learnerId, status: { in: ["active", "monitoring"] } } }),
    prisma.evidence.findMany({ where: { learnerId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.recommendation.findMany({
      where: { learnerId, status: "pending" },
      orderBy: { priority: "desc" },
      take: 5,
    }),
    prisma.learningEvent.findMany({ where: { learnerId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const seen = new Set<string>();
  const skills = competencies.map((c) => {
    const skill = getSkill(c.skillId);
    seen.add(c.skillId);
    return {
      skillId: c.skillId,
      name: skill?.name ?? c.skillId,
      domain: skill?.domain ?? "",
      mastery: c.mastery,
      uncertainty: c.masteryUncertainty,
      support: supportTier(c.masteryUncertainty),
      depth: c.depth,
      independence: c.independence,
      transfer: c.transfer,
      retention: c.retention,
      attempts: c.attempts,
      successes: c.successes,
    };
  });

  return {
    skills,
    misconceptionCount: misconceptions.length,
    evidenceCount: await prisma.evidence.count({ where: { learnerId } }),
    attemptCount: await prisma.taskAttempt.count({ where: { learnerId } }),
    recentEvidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      method: e.method,
      summary: e.summary,
      strength: e.strength,
      createdAt: e.createdAt.toISOString(),
      skillIds: JSON.parse(e.skillIds) as string[],
    })),
    recommendations: recommendations.map((r) => ({
      action: JSON.parse(r.action),
      reason: r.reason,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
    })),
    events: events.map((e) => ({
      type: e.type,
      skillId: e.skillId,
      createdAt: e.createdAt.toISOString(),
      payload: JSON.parse(e.payload),
    })),
  };
}

/** Compute "what should I do next?" — the recommendation engine (§236, §211). */
export async function recommendNext(learnerId: string, roadmapId?: string) {
  const [competencies, roadmapItems] = await Promise.all([
    prisma.competencyState.findMany({ where: { learnerId } }),
    roadmapId
      ? prisma.roadmapItem.findMany({ where: { roadmapId }, orderBy: { index: "asc" } })
      : Promise.resolve([]),
  ]);

  const comp = new Map(competencies.map((c) => [c.skillId, c]));

  // Candidates: the earliest not-yet-completed roadmap item whose
  // prerequisites are sufficiently covered by learner state.
  let candidates: {
    item: { id: string; index: number; phase: string; title: string; skillIds: string[]; type: string; status: string };
    score: number;
    reason: string;
  }[] = [];

  for (const item of roadmapItems) {
    if (item.status === "completed") continue;
    const skills = JSON.parse(item.skillIds) as string[];
    const ready = skills.every((sid) => {
      const c = comp.get(sid);
      const def = getSkill(sid);
      const prereqsOk = (def?.prerequisites ?? []).every((p) => {
        const pc = comp.get(p);
        return pc && pc.mastery >= 0.5;
      });
      return prereqsOk;
    });
    if (!ready) continue;
    // score = weakest skill (lower mastery → higher priority), plus retention decay
    const weakest = Math.min(...skills.map((sid) => comp.get(sid)?.mastery ?? 0));
    const retentionUrgency = Math.min(...skills.map((sid) => 1 - (comp.get(sid)?.retention ?? 1)));
    const score = (1 - weakest) * 0.7 + retentionUrgency * 0.3 + (skills.length > 1 ? 0.05 : 0);
    candidates.push({
      item: { id: item.id, index: item.index, phase: item.phase, title: item.title, skillIds: skills, type: item.type, status: item.status },
      score,
      reason: "next in your roadmap",
    });
  }

  // Retention review candidates: mastered skills whose retention is decaying.
  const retentionCandidates = competencies
    .filter((c) => c.mastery >= 0.55 && c.retention < 0.5)
    .map((c) => ({
      item: { id: `retention:${c.skillId}`, index: 999, phase: "Retention", title: `Review: ${getSkill(c.skillId)?.name ?? c.skillId}`, skillIds: [c.skillId], type: "retention", status: "ready" },
      score: (1 - c.retention) * 0.9,
      reason: "due for retrieval practice",
    }));

  // Active misconceptions get an intervention candidate.
  const mis = await prisma.misconception.findMany({
    where: { learnerId, status: "active" },
    orderBy: { confidence: "desc" },
    take: 3,
  });
  const misCandidates = mis.map((m) => ({
    item: { id: `intervention:${m.skillId}:${m.code}`, index: 500, phase: "Intervention", title: `Fix: ${misconception(m.code)?.name ?? m.code}`, skillIds: [m.skillId], type: "assessment", status: "ready" },
    score: 0.75 + m.confidence * 0.2,
    reason: "active misconception detected",
  }));

  const all = [...candidates, ...retentionCandidates, ...misCandidates].sort(
    (a, b) => b.score - a.score,
  );
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
