import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction, normalizeLang } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { createEvidence } from "./evidence";
import { createGoalFromStatement } from "./goal";

// ─────────────────────────────────────────────────────────────
// Contextual tutor (§96–113). Intent-aware, grounded in the learner's
// current task and state, following the hint ladder.
// ─────────────────────────────────────────────────────────────

const TutorSchema = z.object({
  intent: z.string(),
  actionType: z.string(), // ASK_QUESTION | GIVE_HINT | EXPLAIN | SHOW_EXAMPLE | GIVE_COUNTEREXAMPLE | REQUEST_REFLECTION | REQUEST_ATTEMPT | ESCALATE
  reply: z.string(), // Markdown
  misconceptionCode: z.string().nullable(),
});

export async function buildTutorContext(learnerId: string, roadmapItemId?: string): Promise<string> {
  const parts: string[] = [];

  let taskId: string | null = null;
  let itemTitle = "";

  if (roadmapItemId) {
    const item = await prisma.roadmapItem.findUnique({ where: { id: roadmapItemId } });
    if (item) {
      itemTitle = item.title;
      parts.push(`Current roadmap item: "${item.title}" (phase: ${item.phase})`);
      const task = await prisma.task.findFirst({
        where: { attempts: { some: { roadmapItemId: item.id } } },
        orderBy: { createdAt: "desc" },
      });
      if (task) {
        taskId = task.id;
        parts.push(`Current task: ${task.title}\nStatement:\n${task.statement}`);
      }
    }
  }

  if (taskId) {
    const lastAttempt = await prisma.taskAttempt.findFirst({
      where: { learnerId, taskId },
      orderBy: { createdAt: "desc" },
    });
    if (lastAttempt) {
      parts.push(`Learner's latest code:\n\`\`\`python\n${lastAttempt.code}\n\`\`\``);
      parts.push(`Latest verification: ${JSON.parse(lastAttempt.verification).passed ?? 0} tests passed.`);
    }
  }

  // Relevant learner state (target skills only — context discipline, §103).
  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (task) {
      const skillIds = JSON.parse(task.skillIds) as string[];
      const comps = await prisma.competencyState.findMany({
        where: { learnerId, skillId: { in: skillIds } },
      });
      for (const c of comps) {
        parts.push(
          `Competency ${getSkill(c.skillId)?.name}: mastery ${c.mastery.toFixed(2)} (uncertainty ${c.masteryUncertainty.toFixed(2)}), independence ${c.independence.toFixed(2)}, depth ${c.depth}`,
        );
      }
    }
  }

  const mis = await prisma.misconception.findMany({
    where: { learnerId, status: { in: ["active", "monitoring"] } },
    orderBy: { confidence: "desc" },
    take: 5,
  });
  if (mis.length) {
    parts.push(`Active misconceptions: ${mis.map((m) => m.code).join(", ")}`);
  }

  const recent = await prisma.taskAttempt.findMany({
    where: { learnerId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  if (recent.length) {
    parts.push(`Recent attempts: ${recent.map((a) => `${a.passed}/${a.total} tests`).join(", ")}`);
  }

  return parts.join("\n\n");
}

export async function tutor(input: {
  learnerId: string;
  message: string;
  roadmapItemId?: string;
  language?: string;
}): Promise<{ intent: string; actionType: string; reply: string; misconceptionCode: string | null; goalId?: string }> {
  const prompt = getPrompt("tutor")!;

  await prisma.message.create({
    data: { learnerId: input.learnerId, role: "user", content: input.message },
  });

  // No goal yet? This conversation IS the goal-setting step: capture what the
  // learner wants to learn, then send them to the level diagnostic.
  const activeGoal = await prisma.goal.findFirst({
    where: { learnerId: input.learnerId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  if (!activeGoal) {
    // Too short to be a goal — ask for one instead of creating a junk goal.
    if (input.message.trim().length < 12) {
      const ask =
        normalizeLang(input.language) === "ru"
          ? "Расскажите чуть подробнее, чему вы хотите научиться? Например: «Хочу выучить Python с нуля» или «Хочу стать ML-инженером»."
          : "Tell me a bit more about what you want to learn — for example: “I want to learn Python from zero” or “I want to become an ML engineer”.";
      await prisma.message.create({
        data: { learnerId: input.learnerId, role: "assistant", content: ask, intent: "clarify_goal", meta: JSON.stringify({ actionType: "ASK_QUESTION" }) },
      });
      return { intent: "clarify_goal", actionType: "ASK_QUESTION", reply: ask, misconceptionCode: null };
    }

    const { goalId, spec } = await createGoalFromStatement({
      learnerId: input.learnerId,
      statement: input.message,
      language: normalizeLang(input.language),
    });

    const reply =
      normalizeLang(input.language) === "ru"
        ? `Отлично — фиксирую вашу цель: **${spec.title}**.\n\nПрежде чем начать, определим ваш реальный уровень коротким адаптивным тестом (около 4 вопросов). Отвечайте честно — это только настраивает ваш план под вас, а не оценивает вас.\n\nГотовы? Тогда проходим тест →`
        : `Great — I'm setting your goal: **${spec.title}**.\n\nBefore we start, let's find your real level with a short adaptive test (about 4 questions). Answer honestly — it only shapes your roadmap; it doesn't judge you.\n\nReady? Take the test →`;

    await prisma.message.create({
      data: {
        learnerId: input.learnerId,
        role: "assistant",
        content: reply,
        intent: "goal_created",
        meta: JSON.stringify({ goalId, actionType: "EXPLAIN" }),
      },
    });

    return { intent: "goal_created", actionType: "EXPLAIN", reply, misconceptionCode: null, goalId };
  }

  const context = await buildTutorContext(input.learnerId, input.roadmapItemId);

  const result = await generateObject(
    TutorSchema,
    prompt.capability,
    prompt.system,
    [
      `LEARNER CONTEXT:\n${context || "(no active task)"}`,
      `LEARNER MESSAGE:\n${input.message}`,
      `Return JSON with fields: intent, actionType, reply (Markdown), misconceptionCode (or null).`,
      langInstruction(input.language),
    ].join("\n\n"),
    { maxTokens: 6000 },
  );

  await prisma.message.create({
    data: {
      learnerId: input.learnerId,
      role: "assistant",
      content: result.reply,
      intent: result.intent,
      meta: JSON.stringify({ actionType: result.actionType, misconceptionCode: result.misconceptionCode }),
    },
  });

  // Conversation as micro-assessment (§107): only a clearly detected
  // misconception becomes low-strength evidence, never a hard state change.
  if (result.misconceptionCode) {
    const skill = await prisma.misconception.findFirst({
      where: { learnerId: input.learnerId, code: result.misconceptionCode },
    });
    const skillId = skill?.skillId ?? "python.functions";
    await createEvidence({
      learnerId: input.learnerId,
      skillIds: [skillId],
      kind: "tutor",
      method: "ai-interpretation",
      value: {
        correct: false,
        strength: 0.35,
        supportUsed: 1,
        hintsUsed: 0,
        cognitiveLevel: "understanding",
        transferLevel: 0,
        independenceRequired: 0,
        integrated: false,
        retentionCheck: false,
        kind: "tutor",
        method: "ai-interpretation",
        misconceptions: [result.misconceptionCode],
      },
      summary: `Tutor conversation surfaced possible misconception: ${result.misconceptionCode}`,
    });
  }

  return {
    intent: result.intent,
    actionType: result.actionType,
    reply: result.reply,
    misconceptionCode: result.misconceptionCode,
  };
}
