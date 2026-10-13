import { prisma } from "@/lib/db";
import { getSkill } from "./knowledge-graph";
import { ensureLessonForItem } from "./content";
import { generateTask, persistTask } from "./taskgen";
import { getCompetencyView } from "./student-twin";

// ─────────────────────────────────────────────────────────────
// Learning session orchestration (§8, §238). Opens a roadmap item into
// a lesson + a validated task the learner can attempt.
// ─────────────────────────────────────────────────────────────

export async function openLearnItem(input: {
  learnerId: string;
  itemId: string;
  language?: string;
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
  };
  competency: Record<string, { mastery: number; depth: string; independence: number }>;
}> {
  const item = await prisma.roadmapItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new Error("Roadmap item not found");

  const skillIds = JSON.parse(item.skillIds) as string[];

  // Mark the item active.
  await prisma.roadmapItem.update({ where: { id: item.id }, data: { status: "active" } });

  const lesson = await ensureLessonForItem({ learnerId: input.learnerId, itemId: item.id, language: input.language });

  // Reuse the item's existing validated task, or generate + validate a new one.
  let taskRecord = item.taskId
    ? await prisma.task.findUnique({ where: { id: item.taskId } })
    : null;

  if (!taskRecord) {
    const primary = skillIds[0];
    const comp = await getCompetencyView(input.learnerId, primary);
    const difficulty = clampDifficulty(comp?.mastery ?? 0.2, getSkill(primary)?.difficulty ?? 0.3);

    const task = await generateTask({
      skillIds,
      difficulty,
      cognitiveLevel: item.type === "transfer" ? "analyze" : "apply",
      transferLevel: item.type === "transfer" ? 0.8 : item.type === "project" ? 0.5 : 0.15,
      independenceRequired: item.type === "assessment" ? 0.9 : 0.5,
      misconceptions: comp?.misconceptions,
      language: input.language,
    });

    const taskId = await persistTask(task);
    await prisma.roadmapItem.update({ where: { id: item.id }, data: { taskId } });
    taskRecord = await prisma.task.findUnique({ where: { id: taskId } });
  }

  if (!taskRecord) throw new Error("Failed to produce a task");

  const tests = JSON.parse(taskRecord.tests) as { input: string; expected: string }[];

  const competency: Record<string, { mastery: number; depth: string; independence: number }> = {};
  for (const id of skillIds) {
    const c = await getCompetencyView(input.learnerId, id);
    if (c) competency[id] = { mastery: c.mastery, depth: c.depth, independence: c.independence };
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
      starterCode: taskRecord.starterCode,
      hints: JSON.parse(taskRecord.hints) as string[],
      family: taskRecord.family,
      difficulty: taskRecord.difficulty,
      cognitiveLevel: taskRecord.cognitiveLevel,
      transferLevel: taskRecord.transferLevel,
      example: tests[0] ?? { input: "", expected: "" },
      testCount: tests.length,
    },
    competency,
  };
}

function clampDifficulty(mastery: number, base: number): number {
  // Personalize difficulty (§78, §119): stretch beyond current mastery.
  return Math.min(0.95, Math.max(0.1, mastery * 0.5 + base * 0.5 + 0.15));
}
