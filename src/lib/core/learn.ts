import { prisma } from "@/lib/db";
import { getSkill } from "./knowledge-graph";
import { ensureLessonForItem } from "./content";
import { findExistingValidatedTask, generateTask, persistTask } from "./taskgen";
import { getCompetencyView } from "./student-twin";
import { classifyActivity, instructionFormat } from "./competency";
import { getOwnedNode, getFlattenedOrder } from "./roadmap";

// ─────────────────────────────────────────────────────────────
// Learning session orchestration (§8, §238). Opens a roadmap item into
// a lesson + a validated task the learner can attempt.
// ─────────────────────────────────────────────────────────────

export async function openLearnItem(input: {
  learnerId: string;
  itemId: string;
  language?: string;
  /** Generate a fresh task for this topic instead of reusing the current one. */
  newTask?: boolean;
}): Promise<{
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
  competency: Record<string, { mastery: number | null; depth: string | null; independence: number | null; status: string }>;
  nav: { prevId: string | null; nextId: string | null };
}> {
  // Ownership check (§64): a learner may only open their own roadmap nodes.
  const item = await getOwnedNode(input.learnerId, input.itemId);
  if (!item) throw new Error("Roadmap item not found");

  // Sequential full-cycle navigation: roots followed by their substeps, in order.
  const order = await getFlattenedOrder(item.roadmapId);
  const pos = order.indexOf(item.id);
  const nav = {
    prevId: pos > 0 ? order[pos - 1] : null,
    nextId: pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null,
  };

  const skillIds = JSON.parse(item.skillIds) as string[];

  // Mark the item active.
  await prisma.roadmapItem.update({ where: { id: item.id }, data: { status: "active" } });

  const lesson = await ensureLessonForItem({ learnerId: input.learnerId, itemId: item.id, language: input.language });

  // Reuse the item's existing validated task, or generate + validate a new one.
  let taskRecord = !input.newTask && item.taskId
    ? await prisma.task.findUnique({ where: { id: item.taskId } })
    : null;

  // Adaptive support fading (§70, §74): worked example → independent.
  let format: string = "guided";

  if (!taskRecord) {
    const primary = skillIds[0];
    const comp = await getCompetencyView(input.learnerId, primary);
    const difficulty = clampDifficulty(comp?.mastery ?? 0.2, getSkill(primary)?.difficulty ?? 0.3);
    const fmt = instructionFormat(comp?.mastery ?? null);
    format = fmt.format;

    // Prefer a validated existing task for the same skill before generating (§134).
    const existingId = input.newTask ? null : await findExistingValidatedTask({ skillIds, topic: item.title });
    if (existingId) {
      taskRecord = await prisma.task.findUnique({ where: { id: existingId } });
      if (taskRecord) await prisma.roadmapItem.update({ where: { id: item.id }, data: { taskId: existingId } });
    }

    if (!taskRecord) {
      const activity = classifyActivity(item.type, skillIds.length);
      const task = await generateTask({
        skillIds,
        topic: item.title,
        difficulty,
        cognitiveLevel: activity.cognitiveLevel,
        transferLevel: activity.transferLevel,
        integrationLevel: activity.integrationLevel,
        independenceRequired: item.type === "assessment" ? 0.9 : fmt.independenceRequired,
        misconceptions: comp?.misconceptions ?? [],
        language: input.language,
      });

      const taskId = await persistTask(task);
      await prisma.roadmapItem.update({ where: { id: item.id }, data: { taskId } });
      taskRecord = await prisma.task.findUnique({ where: { id: taskId } });
    }
  }

  if (!taskRecord) throw new Error("Failed to produce a task");

  const tests = JSON.parse(taskRecord.tests) as { input: string; expected: string }[];

  const competency: Record<string, { mastery: number | null; depth: string | null; independence: number | null; status: string }> = {};
  for (const id of skillIds) {
    const c = await getCompetencyView(input.learnerId, id);
    if (c) competency[id] = { mastery: c.mastery, depth: c.depth, independence: c.independence, status: c.status };
  }

  return {
    item: {
      id: item.id,
      title: item.title,
      phase: item.phase,
      type: item.type,
      skillIds,
      description: item.description,
    },
    lesson: {
      id: lesson.id,
      title: lesson.title,
      body: lesson.body,
      sourceIds: lesson.sourceIds,
      sources: lesson.sources,
      grounded: lesson.grounded,
    },
    task: {
      id: taskRecord.id,
      title: taskRecord.title,
      statement: taskRecord.statement,
      // Fade scaffolding: independent work starts from a blank editor.
      starterCode: format === "independent" ? "" : taskRecord.starterCode,
      hints: JSON.parse(taskRecord.hints) as string[],
      family: taskRecord.family,
      difficulty: taskRecord.difficulty,
      cognitiveLevel: taskRecord.cognitiveLevel,
      transferLevel: taskRecord.transferLevel,
      example: tests[0] ?? { input: "", expected: "" },
      testCount: tests.length,
      format,
    },
    competency,
    nav,
  };
}

function clampDifficulty(mastery: number, base: number): number {
  // Personalize difficulty (§78, §119): stretch beyond current mastery.
  return Math.min(0.95, Math.max(0.1, mastery * 0.5 + base * 0.5 + 0.15));
}
