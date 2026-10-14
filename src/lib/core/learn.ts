import { prisma } from "@/lib/db";
import { getSkill } from "./knowledge-graph";
import { ensureLessonForItem } from "./content";
import { findValidatedTasksByItem, generateTask, persistTask } from "./taskgen";
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
  /** Generate an extra task for this subtopic instead of reusing the current one. */
  newTask?: boolean;
  /** Open a specific task from the subtopic's bank. */
  taskId?: string;
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
  /** Every validated task for this subtopic (at least 3). */
  taskBank: { id: string; title: string }[];
  taskIndex: number;
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

  // Adaptive support fading (§70, §74): worked example → independent.
  const primary = skillIds[0];
  const comp = await getCompetencyView(input.learnerId, primary);
  const fmt = instructionFormat(comp?.mastery ?? null);
  const format = fmt.format;
  const activity = classifyActivity(item.type, skillIds.length);

  // Every subtopic is practised with a BANK of tasks (>= MIN_TASKS_PER_TOPIC),
  // not a single exercise. Generation is topic-locked and variety-aware.
  const bankInput: TaskBankInput = {
    itemId: item.id,
    topic: item.title,
    skillIds,
    difficulty: clampDifficulty(comp?.mastery ?? 0.2, getSkill(primary)?.difficulty ?? 0.3),
    cognitiveLevel: activity.cognitiveLevel,
    transferLevel: activity.transferLevel,
    integrationLevel: activity.integrationLevel,
    independenceRequired: item.type === "assessment" ? 0.9 : fmt.independenceRequired,
    misconceptions: comp?.misconceptions ?? [],
    language: input.language,
  };
  await ensureTaskBank({ ...bankInput, legacyTaskId: item.taskId });
  if (input.newTask) await generateIntoBank(bankInput);

  const bank = await findValidatedTasksByItem(item.id);
  const chosen =
    (input.taskId ? bank.find((t) => t.id === input.taskId) : undefined) ??
    (item.taskId ? bank.find((t) => t.id === item.taskId) : undefined) ??
    bank[0];
  if (!chosen) throw new Error("Failed to produce a task");
  if (item.taskId !== chosen.id) {
    await prisma.roadmapItem.update({ where: { id: item.id }, data: { taskId: chosen.id } });
  }
  const taskRecord = chosen;
  const taskIndex = Math.max(0, bank.findIndex((t) => t.id === taskRecord.id));

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
    taskBank: bank.map((t) => ({ id: t.id, title: t.title })),
    taskIndex,
    nav,
  };
}

/**
 * How many validated tasks a single subtopic must offer. One exercise is not
 * practice — a learner needs several tries on the same topic.
 */
export const MIN_TASKS_PER_TOPIC = 3;

type TaskBankInput = {
  itemId: string;
  topic: string;
  skillIds: string[];
  difficulty: number;
  cognitiveLevel: string;
  transferLevel: number;
  integrationLevel: number;
  independenceRequired: number;
  misconceptions: string[];
  language?: string;
};

/** Generate one more validated task for a subtopic and add it to its bank. */
async function generateIntoBank(input: TaskBankInput): Promise<void> {
  const bank = await findValidatedTasksByItem(input.itemId);
  const task = await generateTask({
    skillIds: input.skillIds,
    topic: input.topic,
    difficulty: input.difficulty,
    cognitiveLevel: input.cognitiveLevel,
    transferLevel: input.transferLevel,
    integrationLevel: input.integrationLevel,
    independenceRequired: input.independenceRequired,
    misconceptions: input.misconceptions,
    language: input.language,
    avoid: bank.map((t) => t.title),
    variant: { index: bank.length, total: Math.max(MIN_TASKS_PER_TOPIC, bank.length + 1) },
  });
  await persistTask(task, input.itemId);
}

/**
 * Guarantee a subtopic has at least MIN_TASKS_PER_TOPIC validated tasks.
 * Tasks are generated one after another so each new one can avoid the titles
 * already in the bank (and stays within provider rate limits). A generation
 * failure never blocks learning — whatever exists is kept.
 */
async function ensureTaskBank(input: TaskBankInput & { legacyTaskId: string | null }): Promise<void> {
  if (input.skillIds.length === 0) return;

  // Adopt a legacy single-task link into the bank.
  if (input.legacyTaskId) {
    await prisma.task.updateMany({
      where: { id: input.legacyTaskId, roadmapItemId: null },
      data: { roadmapItemId: input.itemId },
    });
  }

  let bank = await findValidatedTasksByItem(input.itemId);
  while (bank.length < MIN_TASKS_PER_TOPIC) {
    try {
      await generateIntoBank(input);
    } catch {
      break;
    }
    const next = await findValidatedTasksByItem(input.itemId);
    if (next.length === bank.length) break; // no progress
    bank = next;
  }
}

function clampDifficulty(mastery: number, base: number): number {
  // Personalize difficulty (§78, §119): stretch beyond current mastery.
  return Math.min(0.95, Math.max(0.1, mastery * 0.5 + base * 0.5 + 0.15));
}
