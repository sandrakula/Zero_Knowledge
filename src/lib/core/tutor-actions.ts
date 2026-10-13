import { prisma } from "@/lib/db";
import { getSkill } from "./knowledge-graph";
import { generateTask, persistTask } from "./taskgen";
import { addChildNodes, createTutorBranch, generateSubsteps, getOwnedNode, updateNode } from "./roadmap";
import { classifyActivity } from "./competency";
import { safeJson } from "./json";
import { getCompetencyView } from "./student-twin";

// ─────────────────────────────────────────────────────────────
// Structured tutor actions (§37, §40, §45, §69–71).
//
// An LLM may PROPOSE an action; the application validates and executes it.
// Every referenced id is ownership-checked, every task goes through the real
// validated task pipeline, and the learner is only told what actually happened.
// ─────────────────────────────────────────────────────────────

export type TutorAction = {
  type: string;
  targetNodeId?: string | null;
  count?: number | null;
  difficulty?: string | null;
  focus?: string | null;
  kind?: string | null;
  substeps?: { title: string; objective: string; type: string }[] | null;
  title?: string | null;
  description?: string | null;
  objective?: string | null;
};

export type TutorActionResult =
  | { type: "created_tasks"; branchKey: string; parentItemId: string; taskIds: string[]; nodeIds: string[]; titles: string[] }
  | { type: "roadmap_edit"; nodeId: string; added: number; titles: string[] }
  | { type: "error"; message: string };

type ResolvedNode = {
  id: string;
  title: string;
  phase: string;
  roadmapId: string;
  skillIds: string[];
};

async function resolveNode(
  learnerId: string,
  targetNodeId?: string | null,
  fallbackItemId?: string | null,
): Promise<ResolvedNode | null> {
  const fromId = async (id: string): Promise<ResolvedNode | null> => {
    const node = await getOwnedNode(learnerId, id);
    if (!node) return null;
    return { id: node.id, title: node.title, phase: node.phase, roadmapId: node.roadmapId, skillIds: safeJson<string[]>(node.skillIds, []) };
  };

  if (targetNodeId) {
    const n = await fromId(targetNodeId);
    if (n) return n;
  }
  if (fallbackItemId) {
    const n = await fromId(fallbackItemId);
    if (n) return n;
  }

  const goal = await prisma.goal.findFirst({
    where: { learnerId, status: "active" },
    orderBy: { createdAt: "desc" },
    include: { roadmap: true },
  });
  if (!goal?.roadmap) return null;
  const first =
    (await prisma.roadmapItem.findFirst({
      where: { roadmapId: goal.roadmap.id, status: "active", parentId: null },
      orderBy: { index: "asc" },
    })) ??
    (await prisma.roadmapItem.findFirst({
      where: { roadmapId: goal.roadmap.id, status: "ready", parentId: null },
      orderBy: { index: "asc" },
    })) ??
    (await prisma.roadmapItem.findFirst({
      where: { roadmapId: goal.roadmap.id, parentId: null },
      orderBy: { index: "asc" },
    }));
  if (!first) return null;
  return { id: first.id, title: first.title, phase: first.phase, roadmapId: first.roadmapId, skillIds: safeJson<string[]>(first.skillIds, []) };
}

async function difficultyFor(learnerId: string, skillId: string, base = 0.3): Promise<number> {
  const comp = await getCompetencyView(learnerId, skillId);
  const mastery = comp?.mastery ?? 0.2;
  return Math.min(0.95, Math.max(0.1, mastery * 0.5 + base * 0.5 + 0.15));
}

export async function executeTutorAction(input: {
  learnerId: string;
  action: TutorAction;
  fallbackItemId?: string | null;
  language?: string;
}): Promise<TutorActionResult> {
  const { learnerId, action } = input;

  try {
    switch (action.type) {
      case "GENERATE_TASKS":
      case "CREATE_ROADMAP_BRANCH":
        return await generateTaskBranch(input);

      case "EDIT_ROADMAP_NODE":
        return await editNode(input);

      case "ADD_ROADMAP_SUBSTEPS":
        return await addSubsteps(input);

      default:
        return { type: "error", message: `Unsupported action: ${action.type}` };
    }
  } catch (e) {
    return { type: "error", message: e instanceof Error ? e.message : "Action failed" };
  }
}

async function generateTaskBranch(input: {
  learnerId: string;
  action: TutorAction;
  fallbackItemId?: string | null;
  language?: string;
}): Promise<TutorActionResult> {
  const node = await resolveNode(input.learnerId, input.action.targetNodeId, input.fallbackItemId);
  if (!node) return { type: "error", message: "No roadmap step found to attach practice to." };

  const skillIds = node.skillIds.length ? node.skillIds : ["python.functions"];
  const count = Math.max(1, Math.min(6, input.action.count ?? 3));
  const difficultyBias =
    input.action.difficulty === "harder" ? 0.25 : input.action.difficulty === "easier" ? -0.15 : 0;

  const isBranch = input.action.type === "CREATE_ROADMAP_BRANCH" || input.action.kind !== "diagnostic";
  const activity = classifyActivity(
    input.action.kind === "transfer" ? "transfer" : isBranch ? "practice" : "assessment",
    skillIds.length,
  );

  const taskIds: string[] = [];
  const titles: string[] = [];
  const failures: string[] = [];

  // Generate each requested task independently: one bad roll of the model must
  // not discard the whole batch (§43 — reject invalid tasks, keep the valid ones).
  for (let i = 0; i < count; i++) {
    const diff = Math.min(0.98, Math.max(0.05, (await difficultyFor(input.learnerId, skillIds[0])) + difficultyBias + i * 0.05));
    try {
      const task = await generateTask({
        skillIds,
        difficulty: diff,
        cognitiveLevel: activity.cognitiveLevel,
        transferLevel: activity.transferLevel,
        integrationLevel: activity.integrationLevel,
        independenceRequired: 0.7,
        misconceptions: [],
        language: input.language,
      });
      if (input.action.focus) {
        task.statement = `${task.statement}\n\n> Focus requested by the learner: **${input.action.focus}**`;
      }
      const id = await persistTask(task);
      taskIds.push(id);
      titles.push(task.title);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (taskIds.length === 0) {
    return {
      type: "error",
      message: failures.length
        ? `Не удалось сгенерировать ни одной валидной задачи (${failures[0]})`
        : "Task generation produced no valid tasks.",
    };
  }

  const label = input.action.focus ? `${input.action.focus}` : `Extra practice · ${node.title}`;
  const branch = await createTutorBranch({
    learnerId: input.learnerId,
    parentItemId: node.id,
    label,
    taskIds,
    skillIds,
    language: input.language,
  });

  return {
    type: "created_tasks",
    branchKey: branch.branchKey,
    parentItemId: node.id,
    taskIds,
    nodeIds: branch.nodeIds,
    titles,
  };
}

/** Edit an existing roadmap node's wording in place (§37, §67). */
async function editNode(input: {
  learnerId: string;
  action: TutorAction;
  fallbackItemId?: string | null;
  language?: string;
}): Promise<TutorActionResult> {
  const node = await resolveNode(input.learnerId, input.action.targetNodeId, input.fallbackItemId);
  if (!node) return { type: "error", message: "No roadmap step found to edit." };

  if (!input.action.title && !input.action.description && !input.action.objective) {
    return { type: "error", message: "Nothing to change on that step." };
  }

  await updateNode({
    learnerId: input.learnerId,
    nodeId: node.id,
    title: input.action.title ?? undefined,
    description: input.action.description ?? undefined,
    objective: input.action.objective ?? undefined,
  });

  return { type: "roadmap_edit", nodeId: node.id, added: 0, titles: [input.action.title ?? node.title] };
}

async function addSubsteps(input: {
  learnerId: string;
  action: TutorAction;
  fallbackItemId?: string | null;
  language?: string;
}): Promise<TutorActionResult> {
  const node = await resolveNode(input.learnerId, input.action.targetNodeId, input.fallbackItemId);
  if (!node) return { type: "error", message: "No roadmap step found to extend." };

  // Explicit substeps proposed by the model still get persisted through the
  // core roadmap service (never written directly by the model).
  if (input.action.substeps && input.action.substeps.length > 0) {
    const created = await addChildNodes({
      learnerId: input.learnerId,
      parentId: node.id,
      nodes: input.action.substeps.map((s) => ({
        title: s.title,
        objective: s.objective,
        type: s.type,
        optional: false,
      })),
      origin: "tutor",
      phase: node.phase,
    });
    return { type: "roadmap_edit", nodeId: node.id, added: created.length, titles: created.map((c) => c.title) };
  }

  // Otherwise generate the substeps from the node's objective.
  const created = await generateSubsteps({
    learnerId: input.learnerId,
    nodeId: node.id,
    language: input.language,
  });

  if (created.length === 0) {
    return { type: "error", message: "This step already has substeps." };
  }

  // A focus request also clarifies the node's objective (audited edit).
  if (input.action.focus) {
    const current = await getOwnedNode(input.learnerId, node.id);
    await updateNode({
      learnerId: input.learnerId,
      nodeId: node.id,
      objective: current?.objective ? `${current.objective} · ${input.action.focus}` : input.action.focus,
    });
  }

  return { type: "roadmap_edit", nodeId: node.id, added: created.length, titles: created.map((c) => c.title) };
}

/** Human-readable, factual confirmation of what the server actually did (§71). */
export function describeActionResult(result: TutorActionResult, lang: "en" | "ru"): string {
  const ru = lang === "ru";
  if (result.type === "created_tasks") {
    const list = result.titles.map((t) => `- ${t}`).join("\n");
    return ru
      ? `**Готово:** создано ${result.titles.length} проверенных задач(и) и добавлена параллельная ветка практики в план.\n\n${list}`
      : `**Done:** created ${result.titles.length} validated task(s) and added a parallel practice branch to your roadmap.\n\n${list}`;
  }
  if (result.type === "roadmap_edit") {
    if (result.added === 0) {
      return ru
        ? `**Готово:** шаг плана обновлён: ${result.titles[0] ?? ""}`
        : `**Done:** updated the roadmap step: ${result.titles[0] ?? ""}`;
    }
    const list = result.titles.map((t) => `- ${t}`).join("\n");
    return ru
      ? `**Готово:** добавлено ${result.added} подшага(ов) к выбранному шагу плана.\n\n${list}`
      : `**Done:** added ${result.added} substep(s) to the selected roadmap step.\n\n${list}`;
  }
  return ru ? `Не удалось выполнить действие: ${result.message}` : `The action could not be completed: ${result.message}`;
}
