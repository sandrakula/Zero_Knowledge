import { clamp } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Uncertainty-aware mastery estimation (§12–13, §68).
//
// Belief is a Beta posterior. We store the posterior mean (mastery)
// and an uncertainty u = 1 / (n_data + 1), where n_data is the number
// of strength-weighted observations. A fixed weak prior (1 success,
// 3 failures → prior mean 0.25) keeps early evidence from producing
// fake precision while still responding to real observations.
// ─────────────────────────────────────────────────────────────

const PRIOR_S = 1;
const PRIOR_F = 3;
const PRIOR_N = PRIOR_S + PRIOR_F; // 4

export type MasteryState = { mastery: number; uncertainty: number };

/** Effective data counts implied by the stored (mean, uncertainty). */
function toCounts(p: number, u: number): { s: number; f: number; n: number } {
  const n = Math.max(0, 1 / Math.max(u, 1e-6) - 1);
  const s = clamp(p * (n + PRIOR_N) - PRIOR_S, 0, n);
  const f = Math.max(0, n - s);
  return { s, f, n };
}

export function updateMastery(
  prev: MasteryState,
  success: boolean,
  strength: number,
): MasteryState {
  const w = clamp(strength, 0, 1);
  const { s, f, n } = toCounts(prev.mastery, prev.uncertainty);
  const s2 = success ? s + w : s;
  const f2 = success ? f : f + w;
  const n2 = n + w;
  const mastery = clamp((s2 + PRIOR_S) / (n2 + PRIOR_N), 0, 1);
  const uncertainty = clamp(1 / (n2 + 1), 0.02, 1);
  return { mastery, uncertainty };
}

export type SupportTier = "insufficient" | "uncertain" | "moderate" | "strong";

export function supportTier(u: number): SupportTier {
  const n = Math.max(0, 1 / Math.max(u, 1e-6) - 1);
  if (n < 0.5) return "insufficient";
  if (n < 3) return "uncertain";
  if (n < 8) return "moderate";
  return "strong";
}

// Cognitive depth ladder (§14).
export const DEPTH_LADDER = [
  "recognition",
  "understanding",
  "application",
  "analysis",
  "evaluation",
  "creation",
  "transfer",
] as const;

export function depthRank(depth: string): number {
  const i = DEPTH_LADDER.indexOf(depth as (typeof DEPTH_LADDER)[number]);
  return i === -1 ? 0 : i;
}

export function promoteDepth(current: string, demonstrated: string): string {
  const a = depthRank(current);
  const b = depthRank(demonstrated);
  return DEPTH_LADDER[Math.max(a, b)];
}

export function initialMastery(): MasteryState {
  return { mastery: PRIOR_S / PRIOR_N, uncertainty: 1 };
}
