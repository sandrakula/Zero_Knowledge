import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { createEvidence } from "./evidence";

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
}): Promise<{ intent: string; actionType: string; reply: string; misconceptionCode: string | null }> {
  const context = await buildTutorContext(input.learnerId, input.roadmapItemId);
  const prompt = getPrompt("tutor")!;

  await prisma.message.create({
    data: { learnerId: input.learnerId, role: "user", content: input.message },
  });

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
    { maxTokens: 2500 },
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
