import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { SKILLS, getSkill } from "./knowledge-graph";
import type { GoalSpec } from "./goal-compiler";
import { skillCatalogForPrompt } from "./goal-compiler";

// ─────────────────────────────────────────────────────────────
// Curriculum Intelligence (§29–38). Turns goal + learner state +
// competency graph into a personalized roadmap (a hypothesis, not a contract).
// ─────────────────────────────────────────────────────────────

const RoadmapSchema = z.object({
  summary: z.string(),
  phases: z.array(
    z.object({
      phase: z.string(),
      items: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          skillIds: z.array(z.string()),
          type: z.string(),
          estimatedMinutes: z.number().int().min(5).max(240),
        }),
      ),
    }),
  ),
});

export async function generateRoadmap(input: {
  goalId: string;
  learnerId: string;
  spec: GoalSpec;
  competency: { skillId: string; mastery: number }[];
  language?: string;
}): Promise<void> {
  const prompt = getPrompt("roadmap")!;
  const catalog = skillCatalogForPrompt();

  const competencySummary = input.competency
    .filter((c) => input.spec.targetSkills.includes(c.skillId))
    .map((c) => ({ skill: c.skillId, mastery: +c.mastery.toFixed(2) }));

  const user = [
    `Goal: ${input.spec.title} (${input.spec.targetLevel})`,
    `Target skills (ordered): ${input.spec.targetSkills.join(", ")}`,
    `Learner current mastery (0..1, where absent means unknown): ${JSON.stringify(competencySummary)}`,
    `Prerequisite map:\n${catalog}`,
    `Target level: ${input.spec.targetLevel}`,
    langInstruction(input.language),
  ].join("\n\n");

  const result = await generateObject(RoadmapSchema, prompt.capability, prompt.system, user, {
    maxTokens: 8192,
  });

  const validIds = new Set(SKILLS.map((s) => s.id));

  // Remove any previous roadmap (children first, then parent).
  const prev = await prisma.roadmap.findUnique({ where: { goalId: input.goalId } });
  if (prev) {
    await prisma.roadmapItem.deleteMany({ where: { roadmapId: prev.id } }).catch(() => {});
    await prisma.roadmap.delete({ where: { id: prev.id } }).catch(() => {});
  }

  const roadmap = await prisma.roadmap.create({
    data: {
      goalId: input.goalId,
      summary: result.summary,
      status: "active",
    },
  });

  let index = 0;
  for (const phase of result.phases) {
    for (const item of phase.items) {
      const skillIds = item.skillIds.filter((id) => validIds.has(id));
      if (skillIds.length === 0) continue;
      await prisma.roadmapItem.create({
        data: {
          roadmapId: roadmap.id,
          index: index++,
          phase: phase.phase,
          title: item.title,
          description: item.description,
          skillIds: JSON.stringify(skillIds),
          type: item.type,
          status: "locked",
          estimatedMinutes: item.estimatedMinutes,
        },
      });
    }
  }

  // First item is ready to learn.
  const first = await prisma.roadmapItem.findFirst({
    where: { roadmapId: roadmap.id },
    orderBy: { index: "asc" },
  });
  if (first) {
    await prisma.roadmapItem.update({ where: { id: first.id }, data: { status: "ready" } });
  }
}

export async function getRoadmapView(goalId: string) {
  const roadmap = await prisma.roadmap.findUnique({ where: { goalId }, include: { goal: true } });
  if (!roadmap) return null;
  const items = await prisma.roadmapItem.findMany({ where: { roadmapId: roadmap.id }, orderBy: { index: "asc" } });
  return {
    id: roadmap.id,
    goalTitle: roadmap.goal.title,
    summary: roadmap.summary,
    status: roadmap.status,
    items: items.map((i) => ({
      id: i.id,
      index: i.index,
      phase: i.phase,
      title: i.title,
      description: i.description,
      skillIds: JSON.parse(i.skillIds) as string[],
      type: i.type,
      status: i.status,
      contentId: i.contentId,
      estimatedMinutes: i.estimatedMinutes,
    })),
  };
}

/** Advance roadmap state after a completed item. */
export async function markItemCompleted(learnerId: string, itemId: string) {
  const item = await prisma.roadmapItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  await prisma.roadmapItem.update({ where: { id: itemId }, data: { status: "completed" } });
  const roadmap = await prisma.roadmap.findUnique({ where: { id: item.roadmapId } });
  if (!roadmap) return;

  // Unlock the next item.
  const next = await prisma.roadmapItem.findFirst({
    where: { roadmapId: roadmap.id, status: "locked" },
    orderBy: { index: "asc" },
  });
  if (next) {
    await prisma.roadmapItem.update({ where: { id: next.id }, data: { status: "ready" } });
  }

  await prisma.learningEvent.create({
    data: {
      learnerId,
      type: "roadmap_item_completed",
      payload: JSON.stringify({ itemId, title: item.title }),
    },
  });
}

export { getSkill };
