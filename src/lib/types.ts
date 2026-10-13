// Client-safe API response types (no server-only imports).

export type CompetencySummarySkill = {
  skillId: string;
  name: string;
  domain: string;
  mastery: number;
  uncertainty: number;
  support: string;
  depth: string;
  independence: number;
  transfer: number;
  retention: number;
  attempts: number;
  successes: number;
};

export type RecentEvidence = {
  id: string;
  kind: string;
  method: string;
  summary: string;
  strength: number;
  createdAt: string;
  skillIds: string[];
};

export type LearningEventView = {
  type: string;
  skillId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type StateSummary = {
  skills: CompetencySummarySkill[];
  misconceptionCount: number;
  evidenceCount: number;
  attemptCount: number;
  recentEvidence: RecentEvidence[];
  recommendations: { action: Record<string, unknown>; reason: string; priority: number; createdAt: string }[];
  events: LearningEventView[];
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
  skillIds: string[];
  type: string;
  status: string;
  contentId: string | null;
  estimatedMinutes: number;
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
    progress: { total: number; completed: number };
  } | null;
  summary: StateSummary;
  misconceptions: MisconceptionView[];
  nextBest: NextBest;
  domainStats: DomainStat[];
  skillsSeeded: number;
  materialCount: number;
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
  };
  competency: Record<string, { mastery: number; depth: string; independence: number }>;
};

export type AttemptResponse = {
  passed: number;
  total: number;
  passedAll: boolean;
  feedback: string;
  misconceptions: string[];
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
    mastery: number;
    uncertainty: number;
    depth: string;
    independence: number;
    transfer: number;
    support: string;
  } | null;
};
