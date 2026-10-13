import { clamp } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Beta-Binomial mastery model (§13–14, §23).
//
// The posterior is stored explicitly as (alpha, beta) so it is never
// reconstructed from rounded percentages. The prior alpha0 = 1, beta0 = 3
// gives a prior mean of 0.25 — that is a WEAK PRIOR, not evidence, so the UI
// must show "Not assessed" until real observations exist (see competency.ts).
// ─────────────────────────────────────────────────────────────

export const PRIOR_ALPHA = 1;
export const PRIOR_BETA = 3;
export const PRIOR_TOTAL = PRIOR_ALPHA + PRIOR_BETA;

export type Posterior = { alpha: number; beta: number };

export function priorPosterior(): Posterior {
  return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
}

export function posteriorMean(p: Posterior): number {
  const n = p.alpha + p.beta;
  return n > 0 ? clamp(p.alpha / n) : 0;
}

/** Closed-form standard deviation of the Beta posterior. */
export function posteriorStd(p: Posterior): number {
  const n = p.alpha + p.beta;
  if (n <= 0) return 0.5;
  return Math.sqrt((p.alpha * p.beta) / (n * n * (n + 1)));
}

/** Strength-weighted observations beyond the prior — the "amount of evidence". */
export function evidenceCount(p: Posterior): number {
  return Math.max(0, p.alpha + p.beta - PRIOR_TOTAL);
}

/**
 * Credible interval via a normal approximation, clipped to [0,1].
 * DOCUMENTED APPROXIMATION: this is not an exact Beta interval; it is only
 * meaningful when the evidence count is non-trivial.
 */
export function credibleInterval(p: Posterior, z = 1.96): { lower: number; upper: number } {
  const mean = posteriorMean(p);
  const sd = posteriorStd(p);
  return { lower: clamp(mean - z * sd, 0, 1), upper: clamp(mean + z * sd, 0, 1) };
}

/**
 * One observation. `q` is the observed performance score in [0,1] (binary for
 * diagnostic questions, fraction of passed tests for comparable programming
 * tasks, rubric score otherwise). `w` is the effective evidence weight.
 */
export function updatePosterior(p: Posterior, q: number, w: number): Posterior {
  const ww = clamp(w, 0, 1);
  if (ww <= 0) return p;
  const qq = clamp(q, 0, 1);
  return { alpha: p.alpha + ww * qq, beta: p.beta + ww * (1 - qq) };
}

/**
 * How much evidence backs the estimate. This is EVIDENCE SUFFICIENCY, not
 * "confusion about a number" and not the learner's self-reported confidence.
 */
export type EvidenceSufficiency = "none" | "insufficient" | "moderate" | "strong";

export function sufficiency(p: Posterior): EvidenceSufficiency {
  const n = evidenceCount(p);
  if (n < 0.5) return "none";
  if (n < 3) return "insufficient";
  if (n < 8) return "moderate";
  return "strong";
}

// ── Cognitive depth ladder (§20) ────────────────────────────

export const DEPTH_LADDER = [
  "recognition",
  "understanding",
  "application",
  "analysis",
  "evaluation",
  "creation",
  "transfer",
] as const;

export type Depth = (typeof DEPTH_LADDER)[number];

const COGNITIVE_TO_DEPTH: Record<string, Depth> = {
  recognize: "recognition",
  recognition: "recognition",
  understand: "understanding",
  understanding: "understanding",
  apply: "application",
  application: "application",
  analyze: "analysis",
  analysis: "analysis",
  evaluate: "evaluation",
  evaluation: "evaluation",
  create: "creation",
  creation: "creation",
  transfer: "transfer",
};

/** Map a task's cognitive level onto the depth ladder. */
export function depthFromCognitiveLevel(level: string | null | undefined): Depth {
  const key = (level ?? "").toLowerCase().trim();
  return COGNITIVE_TO_DEPTH[key] ?? "understanding";
}

export function depthRank(depth: string): number {
  const i = DEPTH_LADDER.indexOf(depth as Depth);
  return i === -1 ? 0 : i;
}

// ── Retention (§19) ─────────────────────────────────────────

/** Half-life of the retention estimate, in days. */
export const RETENTION_HALF_LIFE_DAYS = 14;
/** Below this estimated retention a review becomes useful. */
export const RETENTION_DUE_THRESHOLD = 0.6;
/** A learning session in the same sitting is not a retention check. */
export const RETENTION_MIN_INTERVAL_DAYS = 1;

/**
 * Time-decayed retention ESTIMATE. `stored` is the last measured retrieval
 * performance; the estimate decays exponentially from the last successful
 * retrieval. This is a heuristic estimate of retrievability, not a measurement
 * of memory.
 */
export function retentionEstimate(
  stored: number,
  lastRetrievedAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!lastRetrievedAt) return clamp(stored);
  const days = Math.max(0, (now.getTime() - new Date(lastRetrievedAt).getTime()) / 86_400_000);
  const factor = Math.pow(0.5, days / RETENTION_HALF_LIFE_DAYS);
  return clamp(stored * factor);
}

/** Whether a skill is due for a retention review. */
export function retentionDue(
  stored: number,
  lastRetrievedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastRetrievedAt) return false;
  const days = (now.getTime() - new Date(lastRetrievedAt).getTime()) / 86_400_000;
  if (days < RETENTION_MIN_INTERVAL_DAYS) return false;
  return retentionEstimate(stored, lastRetrievedAt, now) < RETENTION_DUE_THRESHOLD;
}

/** Number of days until the next retention review would become useful. */
export function daysUntilRetentionDue(
  stored: number,
  lastRetrievedAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastRetrievedAt || stored <= 0) return null;
  const targetFactor = RETENTION_DUE_THRESHOLD / stored;
  if (targetFactor <= 0 || targetFactor >= 1) return RETENTION_MIN_INTERVAL_DAYS;
  const days = -RETENTION_HALF_LIFE_DAYS * Math.log2(targetFactor);
  const elapsed = (now.getTime() - new Date(lastRetrievedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(days - elapsed));
}
