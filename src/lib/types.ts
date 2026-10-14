// Client-safe API response types (no server-only imports).
// Mirrors the read models produced by src/lib/core (student-twin.ts, roadmap.ts).

export type SkillStatus = "not_assessed" | "needs_attention" | "developing" | "demonstrated";
export type EvidenceSufficiency = "none" | "insufficient" | "moderate" | "strong";

/** Null metric values mean NOT ASSESSED — never fabricate a number (§7, §22). */
export type CompetencySummarySkill = {
  skillId: string;
  name: string;
  domain: string;
  status: SkillStatus;
  mastery: number | null;
  masteryInterval: { lower: number; upper: number } | null;
  sufficiency: EvidenceSufficiency;
  evidenceCount: number;
  independentSuccesses: number;
  taskFamilies: number;
  depth: string | null;
  independence: number | null;
  application: number | null;
  transfer: number | null;
  retention: number | null;
  supportDependence: number | null;
  attempts: number;
  successes: number;
  lastAssessmentAt: string | null;
  retentionDue: boolean;
};

export type StateSummary = {
  skills: CompetencySummarySkill[];
  counts: {
    assessed: number;
    demonstrated: number;
    developing: number;
    needsAttention: number;
    notAssessed: number;
  };
  misconceptionCount: number;
  evidenceCount: number;
  attemptCount: number;
  recentEvidence: {
    id: string;
    kind: string;
    method: string;
    summary: string;
    strength: number;
    createdAt: string;
    skillIds: string[];
  }[];
  recentAttempts: {
    id: string;
    passed: number;
    total: number;
    passedAll: boolean;
    hintsUsed: number;
    createdAt: string;
  }[];
  recommendations: { action: Record<string, unknown>; reason: string; priority: number; createdAt: string }[];
  events: { type: string; skillId: string | null; createdAt: string; payload: Record<string, unknown> }[];
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
  /** Groups a tutor-created parallel practice branch (null for main path). */
  branchKey: string | null;
  depth: number;
  completedAt: string | null;
  /** Skill-rollup status, computed by the core (never by the component). */
  skillStatus: SkillStatus;
  /** How many of the item's skills are demonstrated. */
  demonstratedSkills: number;
  children: RoadmapItemView[];
};

export type TutorBranchView = {
  branchKey: string;
  parentItemId: string;
  parentTitle: string;
  nodes: RoadmapItemView[];
};

export type DomainStat = {
  id: string;
  name: string;
  icon: string;
  color: string;
  total: number;
  seen: number;
  mastered: number;
};

export type NextBest = {
  next: {
    type: string;
    title: string;
    description: string;
    itemId: string;
    phase: string;
    skillIds: string[];
    score: number;
  } | null;
  queue: { title: string; reason: string; score: number }[];
};

export type StateResponse = {
  hasGoal: boolean;
  goal: { id: string; title: string; domain: string; targetLevel: string; statement: string } | null;
  roadmap: {
    id: string;
    summary: string;
    items: RoadmapItemView[];
    tutorBranches: TutorBranchView[];
    progress: { total: number; completed: number };
  } | null;
  summary: StateSummary;
  misconceptions: MisconceptionView[];
  nextBest: NextBest;
  domainStats: DomainStat[];
  materialCount: number;
  /** Which goal target skills are covered by uploaded/shared materials (§45). */
  coverage: { skillId: string; name: string; covered: boolean }[];
  /** Every goal target skill with deterministic metrics (incl. not assessed). */
  targetSkills: {
    skillId: string;
    name: string;
    domain: string;
    status: SkillStatus;
    mastery: number | null;
    evidenceCount: number;
    sufficiency: EvidenceSufficiency;
  }[];
  /** Ring metrics for the topic currently being worked through; null = not assessed. */
  goalMetrics: {
    mastery: number | null;
    independence: number | null;
    transfer: number | null;
    touched: number;
    total: number;
  };
};

export type LearnResponse = {
  item: {
    id: string;
    title: string;
    phase: string;
    type: string;
    skillIds: string[];
    description: string;
  };
  lesson: {
    id: string;
    title: string;
    body: string;
    sourceIds: string[];
    sources: { materialId: string; materialName: string; heading: string }[];
    grounded: boolean;
  };
  task: {
    id: string;
    title: string;
    statement: string;
    starterCode: string;
    hints: string[];
    family: string;
    difficulty: number;
    cognitiveLevel: string;
    transferLevel: number;
    example: { input: string; expected: string };
    testCount: number;
    format: string;
  };
  /** Every validated task for this subtopic (at least 3). */
  taskBank: { id: string; title: string }[];
  taskIndex: number;
  competency: Record<string, { mastery: number | null; depth: string | null; independence: number | null; status: SkillStatus }>;
  nav: { prevId: string | null; nextId: string | null };
};

export type AttemptResponse = {
  passed: number;
  total: number;
  passedAll: boolean;
  feedback: string;
  misconceptions: string[];
  issues: { line: number; message: string }[];
  cause: string | null;
  calibration: { confidence: number; correct: boolean; direction: string } | null;
  method: string;
  testResults: {
    pass: boolean;
    expected: string;
    got: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
  }[];
  competency: {
    skillId: string;
    name: string;
    status: SkillStatus;
    mastery: number | null;
    masteryInterval: { lower: number; upper: number } | null;
    sufficiency: EvidenceSufficiency;
    evidenceCount: number;
    independentSuccesses: number;
    depth: string | null;
    independence: number | null;
    transfer: number | null;
  } | null;
};

export type ConversationSummary = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  archivedAt: string | null;
};

export type TutorMessage = {
  id: string;
  role: string;
  content: string;
  intent: string | null;
  actionType: string | null;
  skillIds: string[];
  taskId: string | null;
  roadmapItemId: string | null;
  createdAt: string;
};

export type TutorActionResult =
  | { type: "created_tasks"; branchKey: string; parentItemId: string; taskIds: string[]; titles: string[] }
  | { type: "roadmap_edit"; nodeId: string; added: number; titles: string[] }
  | { type: "error"; message: string };
