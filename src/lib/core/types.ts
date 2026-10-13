// Shared educational-core types (independent of DB and UI).

import type { EvidenceSufficiency, SkillStatus } from "./competency";

export type EvidencePayload = {
  correct: boolean;
  /** Recorded weight of this observation (effective weight, see evidence.ts). */
  strength: number;
  /** Fraction of assistance used, 0..1. */
  supportUsed: number;
  hintsUsed: number;
  cognitiveLevel: string;
  /** Explicit transfer classification of the activity, 0..1. */
  transferLevel: number;
  /** Explicit integration classification of the activity, 0..1. */
  integrationLevel: number;
  independenceRequired: number;
  integrated: boolean;
  retentionCheck: boolean;
  /** True only when the retrieval check happened after a meaningful interval. */
  retentionDelayed: boolean;
  /** Fraction of passed tests, when the activity has comparable cases. */
  passedRatio?: number;
  /** Task family of the activity, for evidence-coverage reporting. */
  taskFamily?: string;
  /** Provenance validity multiplier (see evidence.ts TASK_VALIDITY). */
  taskValidity?: number;
  kind: string;
  method: string;
  /** Misconception codes this evidence supports or contradicts. */
  misconceptions?: string[];
};

/** What the UI may display for one skill. Null values mean "not assessed". */
export type CompetencyView = {
  skillId: string;
  name: string;
  domain: string;
  category: string;
  difficulty: number;

  status: SkillStatus;
  mastery: number | null;
  masteryInterval: { lower: number; upper: number } | null;
  sufficiency: EvidenceSufficiency;

  evidenceCount: number;
  independentSuccesses: number;
  taskFamilies: number;
  lastAssessmentAt: string | null;

  depth: string | null;
  independence: number | null;
  application: number | null;
  transfer: number | null;
  retention: number | null;
  supportDependence: number | null;

  attempts: number;
  misconceptions: string[];
};

export type MisconceptionView = {
  code: string;
  name: string;
  description: string;
  skillId: string;
  confidence: number;
  status: string;
  correction: string;
};

export type TutorBranchView = {
  branchKey: string;
  parentItemId: string;
  parentTitle: string;
  nodes: RoadmapItemView[];
};

export type RoadmapView = {
  id: string;
  goalTitle: string;
  summary: string;
  status: string;
  items: RoadmapItemView[];
  /** Tutor-generated practice branches, kept OUT of the main tree (§44–45). */
  tutorBranches: TutorBranchView[];
};

export type RoadmapItemView = {
  id: string;
  index: number;
  phase: string;
  title: string;
  description: string;
  objective: string;
  skillIds: string[];
  type: string;
  status: string;
  contentId: string | null;
  taskId: string | null;
  estimatedMinutes: number;
  parentId: string | null;
  optional: boolean;
  origin: string;
  branchKey: string | null;
  depth: number;
  completedAt: string | null;
  /** Status rollup computed by the core — components never derive colours. */
  skillStatus: SkillStatus;
  demonstratedSkills: number;
  children: RoadmapItemView[];
};

export type RecommendationView = {
  action: {
    type: string;
    title: string;
    description?: string;
    itemId?: string;
    skillId?: string;
  };
  reason: string;
  priority: number;
};
