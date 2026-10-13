import { prisma } from "@/lib/db";
import { clamp } from "@/lib/utils";
import type { EvidencePayload } from "./types";

// ─────────────────────────────────────────────────────────────
// Evidence Engine (§14, §22). Collects, weights and connects observations to
// learning-state updates, preserving lineage so any competency state can be
// explained. The weighting policy is centralised here and nowhere else.
// ─────────────────────────────────────────────────────────────

/**
 * Reliability of a verification method. Deterministic execution is the
 * strongest signal; an unverified AI opinion is deliberately weak.
 */
export const METHOD_RELIABILITY: Record<string, number> = {
  deterministic: 1.0,
  rubric: 0.8,
  "ai-interpretation": 0.45,
  trace: 0.3,
};

export const DEFAULT_METHOD_RELIABILITY = 0.4;

/**
 * A multi-skill task must NOT credit every associated skill at full strength
 * (§14). The primary target skill receives full weight; supporting skills get a
 * fraction.
 */
export const SKILL_ROLE_FACTOR = {
  primary: 1,
  supporting: 0.45,
} as const;

export type SkillRole = keyof typeof SKILL_ROLE_FACTOR;

/** Supported success is real but weaker evidence than independent success (§15). */
export const SUPPORT_DISCOUNT = 0.4;

/** Validity multipliers for the provenance of an activity. */
export const TASK_VALIDITY = {
  /** Reference solution executed successfully against its own tests. */
  validated: 1.0,
  /** Deterministic activity authored with a known answer key (diagnostics). */
  keyed: 0.9,
  /** Generated but not put through the validation pipeline. */
  unvalidated: 0.7,
} as const;

export function methodReliability(method: string): number {
  return METHOD_RELIABILITY[method] ?? DEFAULT_METHOD_RELIABILITY;
}

/**
 * Effective evidence weight in [0,1] — the single weighting policy.
 */
export function effectiveWeight(input: {
  method: string;
  role?: SkillRole;
  taskValidity?: number;
  relevance?: number;
}): number {
  const base = methodReliability(input.method);
  const role = SKILL_ROLE_FACTOR[input.role ?? "primary"];
  const validity = clamp(input.taskValidity ?? TASK_VALIDITY.validated, 0.3, 1);
  const relevance = clamp(input.relevance ?? 1, 0, 1);
  return clamp(base * role * validity * relevance, 0.02, 1);
}

/**
 * Observed performance score q in [0,1] for the posterior update.
 *
 * - binary activities use 0/1;
 * - comparable programming tasks may use the verified fraction of passed tests;
 * - a SUPPORTED success is discounted (still positive evidence of partial
 *   competence, but weaker). Failures stay at 0 — help does not soften them.
 */
export function observedScore(input: {
  correct: boolean;
  passedRatio?: number;
  supportUsed: number;
}): number {
  const raw =
    input.passedRatio !== undefined ? clamp(input.passedRatio, 0, 1) : input.correct ? 1 : 0;
  if (raw <= 0) return 0;
  const discount = 1 - SUPPORT_DISCOUNT * clamp(input.supportUsed, 0, 1);
  return clamp(raw * discount, 0, 1);
}

/** Persist one piece of evidence and record the corresponding learning event. */
export async function createEvidence(input: {
  learnerId: string;
  skillIds: string[];
  kind: string;
  method: string;
  value: EvidencePayload | Record<string, unknown>;
  summary: string;
  strength?: number;
  taskId?: string;
  attemptId?: string;
  lineage?: Record<string, unknown>;
}): Promise<string> {
  const strength =
    input.strength ??
    (typeof input.value === "object" && input.value && "strength" in input.value
      ? (input.value as EvidencePayload).strength
      : methodReliability(input.method));

  const ev = await prisma.evidence.create({
    data: {
      learnerId: input.learnerId,
      skillIds: JSON.stringify(input.skillIds),
      kind: input.kind,
      method: input.method,
      strength,
      value: JSON.stringify(input.value),
      summary: input.summary,
      lineage: JSON.stringify(input.lineage ?? {}),
      taskId: input.taskId,
      attemptId: input.attemptId,
    },
  });

  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: `evidence_${input.kind}`,
      skillId: input.skillIds[0] ?? null,
      payload: JSON.stringify({ evidenceId: ev.id, summary: input.summary }),
    },
  });

  return ev.id;
}
