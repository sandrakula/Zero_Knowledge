import { clamp } from "@/lib/utils";
import {
  DEPTH_LADDER,
  credibleInterval,
  depthFromCognitiveLevel,
  depthRank,
  evidenceCount,
  posteriorMean,
  posteriorStd,
  retentionEstimate,
  sufficiency,
  updatePosterior,
  type Depth,
  type EvidenceSufficiency,
  type Posterior,
} from "./mastery";

// ─────────────────────────────────────────────────────────────
// The single source of truth for competency metrics (§12, §28).
//
// Everything here is PURE: given the current persisted state and one piece of
// evidence it returns the next state. No Prisma, no React, no AI. That makes
// the rules centrally configurable, deterministic and directly testable.
// Persistence lives in student-twin.ts.
// ─────────────────────────────────────────────────────────────

/** Persisted competency fields the rules operate on. */
export type SkillState = {
  alpha: number;
  beta: number;
  depth: string;
  independence: number;
  application: number;
  transfer: number;
  retention: number;
  evidenceCount: number;
  attempts: number;
  independentSuccesses: number;
  /** Consecutive independent successes; reset by any failure or supported answer. */
  successStreak: number;
  integrationAttempts: number;
  transferAttempts: number;
  retentionChecks: number;
  retentionSuccesses: number;
  supportDependence: number;
  taskFamilies: string[];
  depthCounts: Record<string, number>;
  lastRetrievedAt: Date | null;
  lastAssessmentAt: Date | null;
};

/** One observation, already reduced to its educational meaning. */
export type EvidenceInput = {
  /** Observed performance score in [0,1] after the support discount. */
  q: number;
  /** Effective evidence weight in [0,1]. */
  weight: number;
  /** Whether the activity was solved (drives completion, not the posterior). */
  correct: boolean;
  /** Fraction of assistance used, 0..1. */
  supportUsed: number;
  /** Explicit integration level of the activity, 0..1. */
  integrationLevel: number;
  /** Explicit transfer level of the activity, 0..1. */
  transferLevel: number;
  /** Whether this activity is a retrieval check. */
  retentionCheck: boolean;
  /** Whether the retrieval check was delayed enough to count (not same-session). */
  retentionDelayed: boolean;
  cognitiveLevel: string;
  taskFamily: string;
  at: Date;
};

/**
 * Central, documented rule constants. Changing any of these changes learner
 * outcomes, so they live in exactly one place and are covered by tests.
 */
export const RULES = {
  /** EMA step for independence. */
  independenceEta: 0.25,
  /** On failure independence moves 25% of the way toward (current - this). */
  independenceFailureDrop: 0.15,
  /** EMA step for support dependence. */
  supportDependenceEta: 0.2,
  /** Application moves only for explicitly integrated activities. */
  integrationThreshold: 0.5,
  applicationStep: 0.18,
  applicationDrop: 0.12,
  /** Transfer moves only for explicitly classified transfer activities. */
  transferThreshold: 0.4,
  transferStep: 0.2,
  transferDrop: 0.08,
  /** Independent successes required at a level before depth advances (§20). */
  depthMinObservations: 2,
  /** Rolling window of distinct task families kept for coverage reporting. */
  maxTaskFamiliesTracked: 10,
  /** A success is counted as "independent" below this support usage. */
  independenceThreshold: 0.5,
} as const;

export function emptySkillState(): SkillState {
  return {
    alpha: 1,
    beta: 3,
    depth: "recognition",
    independence: 0,
    application: 0,
    transfer: 0,
    retention: 0,
    evidenceCount: 0,
    attempts: 0,
    independentSuccesses: 0,
    successStreak: 0,
    integrationAttempts: 0,
    transferAttempts: 0,
    retentionChecks: 0,
    retentionSuccesses: 0,
    supportDependence: 0,
    taskFamilies: [],
    depthCounts: {},
    lastRetrievedAt: null,
    lastAssessmentAt: null,
  };
}

/**
 * Apply one observation. Every dimension has an explicit, documented trigger —
 * nothing moves "just because something happened" (§17–21).
 */
export function applyEvidenceToSkill(state: SkillState, ev: EvidenceInput): SkillState {
  const next: SkillState = {
    ...state,
    depthCounts: { ...state.depthCounts },
    taskFamilies: [...state.taskFamilies],
  };

  // 1. Mastery posterior — the only dimension every observation touches.
  const post = updatePosterior({ alpha: state.alpha, beta: state.beta }, ev.q, ev.weight);
  next.alpha = post.alpha;
  next.beta = post.beta;

  // 2. Evidence coverage.
  next.evidenceCount = state.evidenceCount + 1;
  next.attempts = state.attempts + 1;
  next.lastAssessmentAt = ev.at;
  if (ev.correct && ev.supportUsed < RULES.independenceThreshold) {
    next.independentSuccesses = state.independentSuccesses + 1;
  }
  next.successStreak = ev.correct && ev.supportUsed < RULES.independenceThreshold ? state.successStreak + 1 : 0;
  if (ev.taskFamily && !state.taskFamilies.includes(ev.taskFamily)) {
    next.taskFamilies = [...state.taskFamilies, ev.taskFamily].slice(-RULES.maxTaskFamiliesTracked);
  }

  // 3. Independence (§16) — driven by support usage, never by "an answer was sent".
  const target = ev.correct
    ? clamp(1 - ev.supportUsed)
    : clamp(state.independence - RULES.independenceFailureDrop, 0, 1);
  next.independence = clamp(state.independence + RULES.independenceEta * (target - state.independence));

  // 4. Support dependence (§21) — rolling average of assistance used.
  next.supportDependence = clamp(
    state.supportDependence + RULES.supportDependenceEta * (ev.supportUsed - state.supportDependence),
  );

  // 5. Application (§17) — only activities that explicitly integrate skills.
  if (ev.integrationLevel >= RULES.integrationThreshold) {
    next.integrationAttempts = state.integrationAttempts + 1;
    next.application = clamp(state.application + (ev.correct ? RULES.applicationStep : -RULES.applicationDrop));
  }

  // 6. Transfer (§18) — only explicitly classified transfer activities.
  if (ev.transferLevel >= RULES.transferThreshold) {
    next.transferAttempts = state.transferAttempts + 1;
    next.transfer = clamp(state.transfer + (ev.correct ? RULES.transferStep : -RULES.transferDrop));
  }

  // 7. Retention (§19) — only DELAYED retrieval checks. A task solved in the
  //    same session is not evidence of long-term retention.
  if (ev.retentionCheck && ev.retentionDelayed) {
    const checks = state.retentionChecks + 1;
    const successes = state.retentionSuccesses + (ev.correct ? 1 : 0);
    next.retentionChecks = checks;
    next.retentionSuccesses = successes;
    next.retention = clamp((successes + 1) / (checks + 2));
    next.lastRetrievedAt = ev.at;
  } else if (ev.retentionCheck && ev.correct) {
    // Same-session recall: remember the time, but do not claim retention.
    next.lastRetrievedAt = state.lastRetrievedAt ?? ev.at;
    next.retentionChecks = state.retentionChecks;
    next.retentionSuccesses = state.retentionSuccesses;
  }

  // 8. Depth (§20) — requires repeated independent success at that level.
  if (ev.correct && ev.supportUsed < RULES.independenceThreshold) {
    const level: Depth = depthFromCognitiveLevel(ev.cognitiveLevel);
    const counts = { ...next.depthCounts, [level]: (next.depthCounts[level] ?? 0) + 1 };
    next.depthCounts = counts;
    if (counts[level] >= RULES.depthMinObservations && depthRank(level) > depthRank(next.depth)) {
      next.depth = level;
    }
  }

  return next;
}

// ─────────────────────────────────────────────────────────────
// Status classification (§28) — one deterministic policy for every node color.
// ─────────────────────────────────────────────────────────────

export type SkillStatus = "not_assessed" | "needs_attention" | "developing" | "demonstrated";

export const CLASSIFICATION = {
  /** Below this evidence count the skill is simply not assessed. */
  minEvidenceForAssessment: 1,
  /** Posterior mean below this (with evidence) means "needs attention". */
  needsAttentionMastery: 0.3,
  /** An active misconception at/above this confidence forces needs_attention. */
  needsAttentionMisconceptionConfidence: 0.6,
  /** Any active misconception at/above this confidence blocks "demonstrated". */
  misconceptionBlocksDemonstrated: 0.5,
  /** Requirements for "demonstrated" — a high mean alone is NOT enough. */
  demonstratedMinEvidence: 4,
  demonstratedMastery: 0.7,
  demonstratedIntervalLower: 0.45,
  demonstratedMinIndependentSuccesses: 2,
  demonstratedMinTaskFamilies: 2,
} as const;

export type MisconceptionSignal = { status: string; confidence: number };

export function classifySkill(
  state: SkillState,
  misconceptions: MisconceptionSignal[] = [],
): SkillStatus {
  const post: Posterior = { alpha: state.alpha, beta: state.beta };
  const n = evidenceCount(post);

  // No meaningful evidence → never guess.
  if (n < CLASSIFICATION.minEvidenceForAssessment) return "not_assessed";

  const mean = posteriorMean(post);
  const active = misconceptions.filter((m) => m.status === "active");
  const severe = active.some((m) => m.confidence >= CLASSIFICATION.needsAttentionMisconceptionConfidence);
  const blocking = active.some((m) => m.confidence >= CLASSIFICATION.misconceptionBlocksDemonstrated);

  if (severe) return "needs_attention";
  // A current streak of independent successes means the learner is improving
  // right now; a low lifetime mean from earlier failures must not keep the
  // skill red forever.
  if (mean < CLASSIFICATION.needsAttentionMastery && state.successStreak === 0) return "needs_attention";

  const ci = credibleInterval(post);

  // "Demonstrated" is deliberately strict: enough evidence, high mean, a
  // credible lower bound above the floor, repeated independent success across
  // more than one task family, and no unresolved contradicting misconception.
  const demonstrated =
    n >= CLASSIFICATION.demonstratedMinEvidence &&
    mean >= CLASSIFICATION.demonstratedMastery &&
    ci.lower >= CLASSIFICATION.demonstratedIntervalLower &&
    state.independentSuccesses >= CLASSIFICATION.demonstratedMinIndependentSuccesses &&
    state.taskFamilies.length >= CLASSIFICATION.demonstratedMinTaskFamilies &&
    !blocking;

  return demonstrated ? "demonstrated" : "developing";
}

// ─────────────────────────────────────────────────────────────
// Read model (§22) — what the UI is allowed to display, and whether a given
// metric has enough evidence to be shown at all.
// ─────────────────────────────────────────────────────────────

export type MetricValue = {
  value: number | null; // null = not assessed
  label: string;
};

export type SkillMetrics = {
  status: SkillStatus;
  mastery: MetricValue;
  masteryInterval: { lower: number; upper: number } | null;
  sufficiency: EvidenceSufficiency;
  evidenceCount: number;
  independentSuccesses: number;
  taskFamilies: number;
  independence: MetricValue;
  application: MetricValue;
  transfer: MetricValue;
  retention: MetricValue;
  supportDependence: MetricValue;
  depth: string | null;
  lastAssessmentAt: string | null;
  retentionDueDays: number | null;
};

const NA = (): MetricValue => ({ value: null, label: "not_assessed" });

export function skillMetrics(
  state: SkillState,
  misconceptions: MisconceptionSignal[] = [],
  now: Date = new Date(),
): SkillMetrics {
  const post: Posterior = { alpha: state.alpha, beta: state.beta };
  const n = evidenceCount(post);
  const hasEvidence = n >= CLASSIFICATION.minEvidenceForAssessment;

  return {
    status: classifySkill(state, misconceptions),
    mastery: hasEvidence ? { value: posteriorMean(post), label: "assessed" } : NA(),
    masteryInterval: hasEvidence ? credibleInterval(post) : null,
    sufficiency: sufficiency(post),
    evidenceCount: state.evidenceCount,
    independentSuccesses: state.independentSuccesses,
    taskFamilies: state.taskFamilies.length,
    independence: state.attempts > 0 ? { value: state.independence, label: "assessed" } : NA(),
    application: state.integrationAttempts > 0 ? { value: state.application, label: "assessed" } : NA(),
    transfer: state.transferAttempts > 0 ? { value: state.transfer, label: "assessed" } : NA(),
    retention:
      state.retentionChecks > 0
        ? { value: retentionEstimate(state.retention, state.lastRetrievedAt, now), label: "estimate" }
        : NA(),
    supportDependence: state.attempts > 0 ? { value: state.supportDependence, label: "assessed" } : NA(),
    depth: hasEvidence ? state.depth : null,
    lastAssessmentAt: state.lastAssessmentAt ? new Date(state.lastAssessmentAt).toISOString() : null,
    retentionDueDays:
      state.retentionChecks > 0 ? retentionEstimate(state.retention, state.lastRetrievedAt, now) < 0.6 ? 0 : null : null,
  };
}

/** Status → semantic color token used by the roadmap and knowledge map. */
export const STATUS_COLOR: Record<SkillStatus, string> = {
  not_assessed: "#63637a", // gray
  needs_attention: "#fb7185", // rose
  developing: "#fbbf24", // amber
  demonstrated: "#34d399", // green
};

/**
 * How a roadmap activity maps onto evidence dimensions (§17, §18).
 *
 * Central policy — ordinary practice must NOT move transfer or application:
 * both level values stay below the corresponding thresholds in RULES.
 */
export const ACTIVITY_POLICY = {
  transferItemLevel: 0.9,
  projectTransferLevel: 0.5,
  ordinaryTransferLevel: 0.1,
  projectIntegrationLevel: 0.9,
  multiSkillIntegrationLevel: 0.6,
  singleSkillIntegrationLevel: 0.15,
} as const;

export function classifyActivity(
  itemType: string,
  skillCount: number,
  explicitCognitiveLevel?: string,
): { transferLevel: number; integrationLevel: number; cognitiveLevel: string } {
  const transferLevel =
    itemType === "transfer"
      ? ACTIVITY_POLICY.transferItemLevel
      : itemType === "project"
        ? ACTIVITY_POLICY.projectTransferLevel
        : ACTIVITY_POLICY.ordinaryTransferLevel;

  const integrationLevel =
    itemType === "project"
      ? ACTIVITY_POLICY.projectIntegrationLevel
      : skillCount > 1
        ? ACTIVITY_POLICY.multiSkillIntegrationLevel
        : ACTIVITY_POLICY.singleSkillIntegrationLevel;

  const cognitiveLevel = explicitCognitiveLevel ?? (itemType === "transfer" ? "analyze" : "apply");
  return { transferLevel, integrationLevel, cognitiveLevel };
}

/** A learning session in the same sitting is not a retention check (§19). */
export function isDelayedRetrieval(lastAssessmentAt: Date | null, now: Date = new Date()): boolean {
  if (!lastAssessmentAt) return false;
  const days = (now.getTime() - new Date(lastAssessmentAt).getTime()) / 86_400_000;
  return days >= 1;
}

export const ALL_STATUSES: SkillStatus[] = ["not_assessed", "needs_attention", "developing", "demonstrated"];

// ─────────────────────────────────────────────────────────────
// Failure diagnosis (§86) — distinguish forgetting from misunderstanding,
// misconception from a one-off execution slip. Different causes need
// different interventions.
// ─────────────────────────────────────────────────────────────

export type FailureCause = "misconception" | "forgetting" | "never_mastered" | "execution_error";

/** Pure, testable failure-cause classification (§86). */
export function classifyFailureCause(input: {
  wasDemonstrated: boolean;
  retentionStale: boolean;
  activeMisconception: boolean;
}): FailureCause {
  if (input.activeMisconception) return "misconception";
  if (input.wasDemonstrated && input.retentionStale) return "forgetting";
  if (!input.wasDemonstrated) return "never_mastered";
  return "execution_error";
}

// ─────────────────────────────────────────────────────────────
// Adaptive instruction format (§70, §74) — fade support as mastery grows:
// worked example → completion → guided → independent.
// ─────────────────────────────────────────────────────────────

export type InstructionFormat = {
  format: "worked_example" | "completion" | "guided" | "independent";
  independenceRequired: number;
  blankStarter: boolean;
};

/** Pure, testable support-fading policy (§70, §74). */
export function instructionFormat(mastery: number | null): InstructionFormat {
  const m = mastery ?? 0.2;
  if (m < 0.35) return { format: "worked_example", independenceRequired: 0.3, blankStarter: false };
  if (m < 0.6) return { format: "completion", independenceRequired: 0.5, blankStarter: false };
  if (m < 0.8) return { format: "guided", independenceRequired: 0.7, blankStarter: false };
  return { format: "independent", independenceRequired: 0.9, blankStarter: true };
}

/** Posterior standard deviation is exposed for advanced detail views. */
export function masteryStd(state: SkillState): number {
  return posteriorStd({ alpha: state.alpha, beta: state.beta });
}

export { DEPTH_LADDER };
export type { EvidenceSufficiency } from "./mastery";
