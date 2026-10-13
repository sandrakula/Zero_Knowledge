// Shared educational-core types (independent of DB and UI).

export type EvidencePayload = {
  correct: boolean;
  strength: number; // 0..1 — reliability weight of this observation
  supportUsed: number; // 0..1 — how much assistance was consumed
  hintsUsed: number;
  cognitiveLevel: string; // of the task that produced it
  transferLevel: number; // 0..1
  independenceRequired: number; // 0..1
  integrated: boolean; // combines multiple skills
  retentionCheck: boolean;
  kind: string;
  method: string;
  /** Misconception codes this evidence supports or contradicts. */
  misconceptions?: string[];
};

export type CompetencyView = {
  skillId: string;
  name: string;
  domain: string;
  category: string;
  difficulty: number;
  mastery: number;
  uncertainty: number;
  support: string; // evidence support tier
  depth: string;
  independence: number;
  application: number;
  transfer: number;
  retention: number;
  attempts: number;
  successes: number;
  hintDependence: number;
  lastSeenAt: string | null;
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

export type RoadmapView = {
  id: string;
  goalTitle: string;
  summary: string;
  status: string;
  items: RoadmapItemView[];
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
