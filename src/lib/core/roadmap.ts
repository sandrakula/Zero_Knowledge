import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { SKILLS, getSkill } from "./knowledge-graph";
import { classifySkill, type SkillStatus } from "./competency";
import { safeJson } from "./json";
import type { GoalSpec } from "./goal-compiler";
import { skillCatalogForPrompt } from "./goal-compiler";
import type { RoadmapItemView } from "./types";

// ─────────────────────────────────────────────────────────────
// Curriculum Intelligence (§29–38, §31–39). Turns goal + learner state into a
// personalized roadmap, and supports editable hierarchical substeps with
// deterministic, evidence-derived status colours.
// ─────────────────────────────────────────────────────────────

/**
 * Models occasionally overshoot numeric ranges (e.g. 300 min for one item).
 * Clamp into the allowed window instead of failing the whole plan — the value
 * is a UI estimate, not a correctness-critical figure.
 */
function minutes(min: number, max: number, fallback: number) {
  return z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : v;
  }, z.number().int().min(min).max(max).default(fallback));
}

const SubstepItemSchema = z.object({
  title: z.string(),
  objective: z.string().default(""),
  description: z.string().default(""),
  type: z.string().default("practice"),
  estimatedMinutes: minutes(3, 120, 15),
  optional: z.boolean().default(false),
});

export const RoadmapSchema = z.object({
  summary: z.string(),
  phases: z.array(
    z.object({
      phase: z.string(),
      items: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          objective: z.string().default(""),
          skillIds: z.array(z.string()),
          type: z.string(),
          estimatedMinutes: minutes(5, 240, 30),
          // Substeps are produced together with the roadmap so the plan is
          // always fully broken down on first view (no second LLM pass).
          substeps: z.array(SubstepItemSchema).default([]),
        }),
      ),
    }),
  ),
});

export const SubstepSchema = z.object({
  substeps: z
    .array(
      z.object({
        title: z.string(),
        objective: z.string().default(""),
        description: z.string().default(""),
        type: z.string().default("practice"),
        estimatedMinutes: minutes(3, 120, 15),
        optional: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(8),
});

export async function generateRoadmap(input: {
  goalId: string;
  learnerId: string;
  spec: GoalSpec;
  competency: { skillId: string; mastery: number }[];
  language?: string;
  /** Learner-supplied roadmap outline — used verbatim as the plan structure. */
  outline?: string;
}): Promise<void> {
  const prompt = getPrompt("roadmap")!;
  const catalog = skillCatalogForPrompt();

  const competencySummary = input.competency
    .filter((c) => input.spec.targetSkills.includes(c.skillId))
    .map((c) => ({ skill: c.skillId, mastery: +c.mastery.toFixed(2) }));

  const outlineBlock = input.outline?.trim()
    ? [
        "LEARNER-PROVIDED ROADMAP (authoritative — follow it):",
        input.outline.trim().slice(0, 8000),
        "Rules for the provided roadmap: treat its top-level items as the plan's main steps, in the given order. Keep each node's own sub-items as THAT node's substeps — do NOT promote them into separate top-level steps. If a node already lists sub-items, copy them verbatim (translate if needed) and add no extra substeps. If a node has no sub-items, generate 3-6 concrete substeps. Map every node to catalog skillIds. You may exceed the generic item-count guidance to respect the learner's structure.",
      ].join("\n")
    : null;

  const user = [
    `Goal: ${input.spec.title} (${input.spec.targetLevel})`,
    `Target skills (ordered): ${input.spec.targetSkills.join(", ")}`,
    `Learner current mastery (0..1, where absent means unknown): ${JSON.stringify(competencySummary)}`,
    `Prerequisite map:\n${catalog}`,
    `Target level: ${input.spec.targetLevel}`,
    ...(outlineBlock ? [outlineBlock] : []),
    langInstruction(input.language),
  ].join("\n\n");

  const result = await generateObject(RoadmapSchema, prompt.capability, prompt.system, user, {
    maxTokens: 20000,
    disableThinking: true,
  });

  const validIds = new Set(SKILLS.map((s) => s.id));

  // Remove any previous roadmap (children first, then parents).
  const prev = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  if (prev) {
    const items = await prisma.roadmapItem.findMany({ where: { roadmapId: prev.id }, select: { id: true, parentId: true } });
    const childIds = items.filter((i) => i.parentId).map((i) => i.id);
    if (childIds.length) await prisma.roadmapItem.deleteMany({ where: { id: { in: childIds } } });
    await prisma.roadmapItem.deleteMany({ where: { roadmapId: prev.id } });
    await prisma.roadmap.delete({ where: { id: prev.id } }).catch(() => {});
  }

  const roadmap = await prisma.roadmap.create({
    data: { goalId: input.goalId, summary: result.summary, status: "active" },
  });

  let index = 0;
  for (const phase of result.phases) {
    for (const item of phase.items) {
      const skillIds = item.skillIds.filter((id) => validIds.has(id));
      if (skillIds.length === 0) continue;
      const rootIndex = index++;
      const root = await prisma.roadmapItem.create({
        data: {
          roadmapId: roadmap.id,
          index: rootIndex,
          phase: phase.phase,
          title: item.title,
          description: item.description,
          objective: item.objective ?? "",
          skillIds: JSON.stringify(skillIds),
          type: item.type,
          // All topics are open from the start — the learner may explore any
          // step at any time; the recommendation engine still orders the work.
          status: "ready",
          origin: "main",
          estimatedMinutes: item.estimatedMinutes,
        },
      });

      // Single-purpose checks stay whole; substantial learning steps always
      // arrive with their breakdown already in place.
      const eligible = !SINGLE_PURPOSE_TYPES.has(item.type);
      const subs = item.substeps ?? [];
      if (eligible && subs.length) {
        let subIndex = rootIndex * 1000 + 1;
        for (const s of subs) {
          await prisma.roadmapItem.create({
            data: {
              roadmapId: roadmap.id,
              parentId: root.id,
              index: subIndex++,
              phase: phase.phase,
              title: s.title.slice(0, 200),
              description: s.description ?? "",
              objective: s.objective ?? "",
              skillIds: JSON.stringify(skillIds),
              type: s.type || "practice",
              status: "ready",
              optional: s.optional ?? false,
              origin: "main",
              estimatedMinutes: s.estimatedMinutes ?? 15,
            },
          });
        }
      }
    }
  }
}

/** Types that are a single check by design and are never broken into substeps. */
export const SINGLE_PURPOSE_TYPES = new Set(["retention", "diagnostic"]);

/** Build the roadmap once the diagnostic has seeded the learner model. */
export async function buildRoadmapFromGoal(input: {
  goalId: string;
  learnerId: string;
  language?: string;
  /** Learner-supplied roadmap outline. */
  outline?: string;
}): Promise<void> {
  const goal = await prisma.goal.findUnique({ where: { id: input.goalId }, include: { targetSkills: true } });
  if (!goal) return;
  const spec: GoalSpec = {
    title: goal.title,
    domain: goal.domain,
    targetLevel: goal.targetLevel,
    targetSkills: goal.targetSkills.map((g) => g.skillId),
    summary: "",
    outOfScope: false,
    reframedStatement: "",
  };
  const comps = await prisma.competencyState.findMany({
    where: { learnerId: input.learnerId, skillId: { in: spec.targetSkills } },
  });
  await generateRoadmap({
    goalId: input.goalId,
    learnerId: input.learnerId,
    spec,
    competency: comps.map((c) => ({ skillId: c.skillId, mastery: c.mastery })),
    language: input.language,
    outline: input.outline,
  });
}

/**
 * Build (or rebuild) the plan around a roadmap the learner supplied themselves.
 * The outline is authoritative: its nodes are preserved in order, existing
 * sub-items are kept as-is, and only nodes without sub-items are expanded.
 */
export async function importRoadmapFromOutline(input: {
  goalId: string;
  learnerId: string;
  outline: string;
  language?: string;
}): Promise<{ roadmapId: string }> {
  const goal = await prisma.goal.findUnique({ where: { id: input.goalId } });
  if (!goal || goal.learnerId !== input.learnerId) throw new Error("Goal not found");
  const outline = input.outline.trim();
  if (!outline) throw new Error("Roadmap outline is empty");

  await buildRoadmapFromGoal({ goalId: input.goalId, learnerId: input.learnerId, language: input.language, outline });

  const created = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  if (!created) throw new Error("Roadmap generation failed");
  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "roadmap_imported",
      payload: JSON.stringify({ goalId: input.goalId, roadmapId: created.id, outlineChars: outline.length }),
    },
  });
  return { roadmapId: created.id };
}

/**
 * Build the roadmap only if the goal does not have one yet. Used after the
 * diagnostic (which no longer blocks on roadmap generation) and as a safety
 * net whenever a learner reaches the plan before it exists.
 */
export async function ensureRoadmap(input: {
  goalId: string;
  learnerId: string;
  language?: string;
  /** Rebuild even when a plan already exists (e.g. after a fresh diagnostic). */
  force?: boolean;
}): Promise<{ ready: boolean; roadmapId: string | null }> {
  const existing = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  if (existing && !input.force) return { ready: true, roadmapId: existing.id };
  await buildRoadmapFromGoal(input);
  const created = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  return { ready: Boolean(created), roadmapId: created?.id ?? null };
}

/**
 * Pure staleness predicate (testable): the plan is stale when some
 * not-yet-completed root has every one of its skills already demonstrated.
 */
export function isStaleFromStatuses(
  roots: { status: string; skillIds: string[] }[],
  statuses: Map<string, SkillStatus>,
): boolean {
  for (const r of roots) {
    if (r.status === "completed") continue;
    if (r.skillIds.length === 0) continue;
    if (r.skillIds.every((id) => statuses.get(id) === "demonstrated")) return true;
  }
  return false;
}

/** Whether the plan is stale: a not-yet-completed root's skills are all demonstrated. */
export async function roadmapIsStale(learnerId: string, roadmapId: string): Promise<boolean> {
  const statuses = await skillStatusMap(learnerId);
  const roots = await prisma.roadmapItem.findMany({ where: { roadmapId, parentId: null } });
  return isStaleFromStatuses(
    roots.map((r) => ({ status: r.status, skillIds: safeJson<string[]>(r.skillIds, []) })),
    statuses,
  );
}

/**
 * Re-plan the roadmap from current evidence (§29, §35). Compresses or drops
 * topics whose skills are already demonstrated and lets the generator add
 * transfer/retention/project work where it is now due. Non-destructive to
 * evidence, materials, conversations and competency state — only the plan
 * structure is rebuilt, and already-mastered topics are marked completed.
 */
export async function regenerateRoadmap(input: {
  learnerId: string;
  goalId: string;
  language?: string;
}): Promise<{ regenerated: boolean; beforeTotal: number; afterTotal: number; autoCompleted: number }> {
  const goal = await prisma.goal.findUnique({ where: { id: input.goalId }, include: { targetSkills: true } });
  if (!goal || goal.learnerId !== input.learnerId) throw new Error("Goal not found");

  const prev = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  const completedBefore = prev
    ? await prisma.roadmapItem.findMany({
        where: { roadmapId: prev.id, parentId: null, status: "completed" },
        orderBy: { index: "asc" },
      })
    : [];
  const beforeTotal = prev ? await prisma.roadmapItem.count({ where: { roadmapId: prev.id } }) : 0;

  const spec: GoalSpec = {
    title: goal.title,
    domain: goal.domain,
    targetLevel: goal.targetLevel,
    targetSkills: goal.targetSkills.map((g) => g.skillId),
    summary: "",
    outOfScope: false,
    reframedStatement: "",
  };
  const comps = await prisma.competencyState.findMany({
    where: { learnerId: input.learnerId, skillId: { in: spec.targetSkills } },
  });

  await generateRoadmap({
    goalId: input.goalId,
    learnerId: input.learnerId,
    spec,
    competency: comps.map((c) => ({ skillId: c.skillId, mastery: c.mastery })),
    language: input.language,
  });

  const after = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  if (!after) throw new Error("Roadmap generation failed");

  // Topics already fully demonstrated are reflected as completed in the new plan.
  const statuses = await skillStatusMap(input.learnerId);
  const newRoots = await prisma.roadmapItem.findMany({
    where: { roadmapId: after.id, parentId: null },
    orderBy: { index: "asc" },
  });
  let autoCompleted = 0;
  for (const r of newRoots) {
    const skills = safeJson<string[]>(r.skillIds, []);
    if (skills.length > 0 && skills.every((id) => statuses.get(id) === "demonstrated")) {
      await prisma.roadmapItem.update({ where: { id: r.id }, data: { status: "completed", completedAt: new Date() } });
      autoCompleted++;
    }
  }

  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "roadmap_regenerated",
      payload: JSON.stringify({
        goalId: input.goalId,
        before: {
          total: beforeTotal,
          completed: completedBefore.map((i) => ({ title: i.title, skillIds: safeJson<string[]>(i.skillIds, []) })),
        },
        autoCompleted,
        at: new Date().toISOString(),
      }),
    },
  });

  return {
    regenerated: true,
    beforeTotal,
    afterTotal: await prisma.roadmapItem.count({ where: { roadmapId: after.id } }),
    autoCompleted,
  };
}

/** Regenerate after a completion when the plan has become stale (evidence-driven). */
export async function maybeRegenerateRoadmap(
  learnerId: string,
  nodeId: string,
  language?: string,
): Promise<void> {
  const node = await getOwnedNode(learnerId, nodeId);
  if (!node) return;
  if (await roadmapIsStale(learnerId, node.roadmapId)) {
    await regenerateRoadmap({ learnerId, goalId: node.roadmap.goal.id, language });
  }
}

/** Deterministic rollup of skill statuses onto a roadmap node (§29). */
export function rollupStatus(statuses: SkillStatus[]): SkillStatus {
  if (statuses.length === 0) return "not_assessed";
  if (statuses.some((s) => s === "needs_attention")) return "needs_attention";
  if (statuses.every((s) => s === "demonstrated")) return "demonstrated";
  if (statuses.every((s) => s === "not_assessed")) return "not_assessed";
  return "developing";
}

async function skillStatusMap(learnerId: string): Promise<Map<string, SkillStatus>> {
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
  const map = new Map<string, SkillStatus>();
  for (const s of states) {
    map.set(
      s.skillId,
      classifySkill(
        {
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
        },
        miscBySkill.get(s.skillId) ?? [],
      ),
    );
  }
  return map;
}

/** The roadmap as a tree, with deterministic statuses computed by the core. */
export async function getRoadmapView(goalId: string, learnerId: string) {
  const roadmap = await prisma.roadmap.findUnique({ where: { goalId }, include: { goal: true } });
  if (!roadmap) return null;

  const [items, statuses] = await Promise.all([
    prisma.roadmapItem.findMany({ where: { roadmapId: roadmap.id }, orderBy: [{ index: "asc" }] }),
    skillStatusMap(learnerId),
  ]);

  const view = (i: (typeof items)[number], depth: number): RoadmapItemView => {
    const skillIds = safeJson<string[]>(i.skillIds, []);
    const skillStatuses = skillIds.map((id) => statuses.get(id) ?? "not_assessed");
    return {
      id: i.id,
      index: i.index,
      phase: i.phase,
      title: i.title,
      description: i.description,
      objective: i.objective,
      skillIds,
      type: i.type,
      status: i.status,
      contentId: i.contentId,
      taskId: i.taskId,
      estimatedMinutes: i.estimatedMinutes,
      parentId: i.parentId,
      optional: i.optional,
      origin: i.origin,
      branchKey: i.branchKey,
      depth,
      completedAt: i.completedAt ? i.completedAt.toISOString() : null,
      skillStatus: rollupStatus(skillStatuses),
      demonstratedSkills: skillStatuses.filter((s) => s === "demonstrated").length,
      children: [],
    };
  };

  const byId = new Map<string, RoadmapItemView>();
  for (const i of items) byId.set(i.id, view(i, 0));

  const roots: RoadmapItemView[] = [];
  const tutorBranches = new Map<string, { branchKey: string; parentItemId: string; parentTitle: string; nodes: RoadmapItemView[] }>();

  for (const i of items) {
    const node = byId.get(i.id)!;
    if (i.parentId && byId.has(i.parentId)) {
      if (i.branchKey) {
        // Tutor-created practice branches live in a SEPARATE place (§44–45),
        // never mixed into the main sequential path.
        node.depth = 1;
        const key = i.branchKey;
        if (!tutorBranches.has(key)) {
          tutorBranches.set(key, {
            branchKey: key,
            parentItemId: i.parentId,
            parentTitle: byId.get(i.parentId)?.title ?? "",
            nodes: [],
          });
        }
        tutorBranches.get(key)!.nodes.push(node);
      } else {
        const parent = byId.get(i.parentId)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return {
    id: roadmap.id,
    goalTitle: roadmap.goal.title,
    summary: roadmap.summary,
    status: roadmap.status,
    items: roots,
    tutorBranches: [...tutorBranches.values()],
    progress: {
      total: roots.length,
      completed: roots.filter((r) => r.status === "completed").length,
    },
  };
}

/** Flat list of every node (including substeps) for a roadmap. */
export async function listRoadmapNodes(roadmapId: string) {
  return prisma.roadmapItem.findMany({ where: { roadmapId }, orderBy: [{ index: "asc" }] });
}

/**
 * Traversal order used by the sequential "full cycle": every root followed by
 * its children, both sorted by index. This is the SAME content as the expanded
 * roadmap tree — substeps are just a navigational breakdown of the same path.
 */
export async function getFlattenedOrder(roadmapId: string): Promise<string[]> {
  const items = await prisma.roadmapItem.findMany({ where: { roadmapId }, orderBy: [{ index: "asc" }] });
  const children = new Map<string, typeof items>();
  const roots: typeof items = [];
  for (const i of items) {
    if (i.parentId) {
      const arr = children.get(i.parentId) ?? [];
      arr.push(i);
      children.set(i.parentId, arr);
    } else {
      roots.push(i);
    }
  }
  roots.sort((a, b) => a.index - b.index);
  const order: string[] = [];
  const walk = (node: (typeof items)[number]) => {
    order.push(node.id);
    const kids = (children.get(node.id) ?? []).sort((a, b) => a.index - b.index);
    for (const k of kids) walk(k);
  };
  for (const r of roots) walk(r);
  return order;
}

/** Ownership-checked single node lookup. */
export async function getOwnedNode(learnerId: string, nodeId: string) {
  const node = await prisma.roadmapItem.findUnique({ where: { id: nodeId }, include: { roadmap: { include: { goal: true } } } });
  if (!node || node.roadmap.goal.learnerId !== learnerId) return null;
  return node;
}

export async function markItemCompleted(learnerId: string, itemId: string) {
  const item = await getOwnedNode(learnerId, itemId);
  if (!item) return;

  await prisma.roadmapItem.update({
    where: { id: itemId },
    data: { status: "completed", completedAt: new Date() },
  });

  await prisma.learningEvent.create({
    data: { learnerId, type: "roadmap_item_completed", payload: JSON.stringify({ itemId, title: item.title }) },
  });

  // Only main-path items unlock the next main-path item (§45): optional and
  // tutor-created branches never gate progression.
  if (item.origin !== "main") return;
  const next = await prisma.roadmapItem.findFirst({
    where: { roadmapId: item.roadmapId, status: "locked", parentId: null, origin: "main" },
    orderBy: { index: "asc" },
  });
  if (next) await prisma.roadmapItem.update({ where: { id: next.id }, data: { status: "ready" } });
}

// ─────────────────────────────────────────────────────────────
// Structured roadmap edits (§37–39). Every mutation validates ownership and
// writes an audit event.
// ─────────────────────────────────────────────────────────────

async function auditRoadmap(learnerId: string, operation: string, nodeId: string, before: unknown, after: unknown) {
  await prisma.learningEvent.create({
    data: {
      learnerId,
      type: "roadmap_edited",
      payload: JSON.stringify({ operation, nodeId, before, after, at: new Date().toISOString() }),
    },
  });
}

export async function addChildNodes(input: {
  learnerId: string;
  parentId: string;
  nodes: { title: string; objective?: string; description?: string; type?: string; estimatedMinutes?: number; optional?: boolean; skillIds?: string[]; taskId?: string }[];
  origin?: string;
  branchKey?: string;
  phase?: string;
}): Promise<RoadmapItemView[]> {
  const parent = await getOwnedNode(input.learnerId, input.parentId);
  if (!parent) throw new Error("Roadmap node not found");

  const existing = await prisma.roadmapItem.findMany({ where: { parentId: parent.id } });
  let index = existing.length ? Math.max(...existing.map((e) => e.index)) + 1 : parent.index * 1000 + 1;

  const parentSkills = safeJson<string[]>(parent.skillIds, []);
  const created: RoadmapItemView[] = [];

  for (const n of input.nodes) {
    const skillIds = (n.skillIds && n.skillIds.length ? n.skillIds : parentSkills).filter((s) => !!getSkill(s));
    const row = await prisma.roadmapItem.create({
      data: {
        roadmapId: parent.roadmapId,
        parentId: parent.id,
        index: index++,
        phase: input.phase ?? parent.phase,
        title: n.title.slice(0, 200),
        description: n.description ?? "",
        objective: n.objective ?? "",
        skillIds: JSON.stringify(skillIds),
        type: n.type ?? "practice",
        status: "ready",
        optional: n.optional ?? false,
        origin: input.origin ?? "tutor",
        branchKey: input.branchKey ?? null,
        taskId: n.taskId ?? null,
        estimatedMinutes: n.estimatedMinutes ?? 15,
      },
    });
    created.push({
      id: row.id,
      index: row.index,
      phase: row.phase,
      title: row.title,
      description: row.description,
      objective: row.objective,
      skillIds,
      type: row.type,
      status: row.status,
      contentId: null,
      taskId: row.taskId,
      estimatedMinutes: row.estimatedMinutes,
      parentId: row.parentId,
      optional: row.optional,
      origin: row.origin,
      branchKey: row.branchKey,
      depth: parent.parentId ? 2 : 1,
      completedAt: null,
      skillStatus: "not_assessed",
      demonstratedSkills: 0,
      children: [],
    });
  }

  await auditRoadmap(input.learnerId, "add_child_nodes", parent.id, null, {
    count: created.length,
    titles: created.map((c) => c.title),
    origin: input.origin ?? "tutor",
  });

  return created;
}

export async function updateNode(input: {
  learnerId: string;
  nodeId: string;
  title?: string;
  description?: string;
  objective?: string;
  optional?: boolean;
}): Promise<void> {
  const node = await getOwnedNode(input.learnerId, input.nodeId);
  if (!node) throw new Error("Roadmap node not found");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.slice(0, 200);
  if (input.description !== undefined) data.description = input.description;
  if (input.objective !== undefined) data.objective = input.objective;
  if (input.optional !== undefined) data.optional = input.optional;
  if (Object.keys(data).length === 0) return;

  await prisma.roadmapItem.update({ where: { id: node.id }, data });
  await auditRoadmap(input.learnerId, "update_node", node.id, {
    title: node.title,
    description: node.description,
    objective: node.objective,
    optional: node.optional,
  }, data);
}

export async function reorderNode(input: { learnerId: string; nodeId: string; beforeNodeId?: string }): Promise<void> {
  const node = await getOwnedNode(input.learnerId, input.nodeId);
  if (!node) throw new Error("Roadmap node not found");

  const siblings = await prisma.roadmapItem.findMany({
    where: { parentId: node.parentId, roadmapId: node.roadmapId },
    orderBy: { index: "asc" },
  });
  const others = siblings.filter((s) => s.id !== node.id);

  let insertAt = others.length;
  if (input.beforeNodeId) {
    const idx = others.findIndex((s) => s.id === input.beforeNodeId);
    if (idx >= 0) insertAt = idx;
  }
  const ordered = [...others.slice(0, insertAt), node, ...others.slice(insertAt)];

  for (let i = 0; i < ordered.length; i++) {
    await prisma.roadmapItem.update({ where: { id: ordered[i].id }, data: { index: i } });
  }
  await auditRoadmap(input.learnerId, "reorder_node", node.id, { index: node.index }, { index: insertAt });
}

/** A tutor-created parallel practice branch attached to an existing node (§44). */
export async function createTutorBranch(input: {
  learnerId: string;
  parentItemId: string;
  label: string;
  taskIds: string[];
  skillIds: string[];
  language?: string;
}): Promise<{ branchKey: string; parentItemId: string; nodeIds: string[] }> {
  const parent = await getOwnedNode(input.learnerId, input.parentItemId);
  if (!parent) throw new Error("Roadmap node not found");

  const branchKey = `branch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const tasks = await prisma.task.findMany({ where: { id: { in: input.taskIds } } });
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const nodes = input.taskIds.map((taskId) => {
    const task = taskById.get(taskId);
    return {
      title: task?.title ?? input.label,
      description: task?.statement?.slice(0, 300) ?? "",
      objective: input.label,
      type: "practice",
      estimatedMinutes: 15,
      optional: true,
      skillIds: input.skillIds,
      taskId,
    };
  });

  const created = await addChildNodes({
    learnerId: input.learnerId,
    parentId: parent.id,
    nodes,
    origin: "tutor",
    branchKey,
    phase: `${parent.phase} · ${input.label}`,
  });

  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "tutor_branch_created",
      payload: JSON.stringify({ branchKey, parentItemId: parent.id, taskIds: input.taskIds, nodes: created.length }),
    },
  });

  return { branchKey, parentItemId: parent.id, nodeIds: created.map((c) => c.id) };
}

/** Generate substeps for a node via the model (used on first expand). */
export async function generateSubsteps(input: {
  learnerId: string;
  nodeId: string;
  language?: string;
  count?: number;
}): Promise<RoadmapItemView[]> {
  const node = await getOwnedNode(input.learnerId, input.nodeId);
  if (!node) throw new Error("Roadmap node not found");

  const existing = await prisma.roadmapItem.findMany({ where: { parentId: node.id } });
  if (existing.length > 0) return [];

  const skillIds = safeJson<string[]>(node.skillIds, []);
  const names = skillIds.map((id) => `${getSkill(id)?.name ?? id} (${id})`).join(", ");
  const prompt = getPrompt("roadmap-substeps")!;

  const result = await generateObject(
    SubstepSchema,
    prompt.capability,
    prompt.system,
    [
      `Roadmap step: ${node.title}`,
      `Objective: ${node.objective || node.description}`,
      `Skills: ${names}`,
      `Step type: ${node.type}`,
      `Requested number of substeps: ${input.count ?? "choose what the objective needs (4-7 typical, fewer for simple topics)"}`,
      langInstruction(input.language),
    ].join("\n"),
    { maxTokens: 4000 },
  );

  return addChildNodes({
    learnerId: input.learnerId,
    parentId: node.id,
    nodes: result.substeps.map((s) => ({
      title: s.title,
      objective: s.objective,
      description: s.description,
      type: s.type,
      estimatedMinutes: s.estimatedMinutes,
      optional: s.optional,
      skillIds,
    })),
    origin: "main",
    phase: node.phase,
  });
}
