import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction, normalizeLang } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { createEvidence, effectiveWeight, TASK_VALIDITY } from "./evidence";
import { applyEvidence, AGGREGATE_SCOPE } from "./student-twin";
import { createGoalFromStatement } from "./goal";
import {
  appendMessage,
  getOrCreateActiveConversation,
  recentConversationContext,
  searchConversationHistory,
} from "./conversation";
import { describeActionResult, executeTutorAction, type TutorAction, type TutorActionResult } from "./tutor-actions";
import { safeJson } from "./json";

// ─────────────────────────────────────────────────────────────
// Contextual tutor (§48–71).
//
// The tutor sees a CONSTRUCTED context, not the whole history (§58): the
// current task, the roadmap map, the competency vector, recent attempts,
// misconceptions, materials and a bounded slice of the conversation.
// ─────────────────────────────────────────────────────────────

const TutorActionSchema = z
  .object({
    type: z.string(),
    targetNodeId: z.string().nullable().default(null),
    count: z.number().int().min(1).max(6).nullable().default(null),
    difficulty: z.string().nullable().default(null),
    focus: z.string().nullable().default(null),
    kind: z.string().nullable().default(null),
    substeps: z
      .array(z.object({ title: z.string(), objective: z.string().default(""), type: z.string().default("practice") }))
      .nullable()
      .default(null),
    title: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    objective: z.string().nullable().default(null),
  })
  .nullable()
  .default(null);

const TutorSchema = z.object({
  intent: z.string(),
  actionType: z.string(),
  reply: z.string(),
  misconceptionCode: z.string().nullable().default(null),
  hintLevel: z.number().int().min(0).max(6).nullable().default(null),
  action: TutorActionSchema,
});

export type TutorResult = {
  conversationId: string;
  intent: string;
  actionType: string;
  reply: string;
  misconceptionCode: string | null;
  goalId?: string;
  action?: TutorActionResult | null;
};

/**
 * Build a task-specific context (§61). Deliberately bounded — unrelated learner
 * history is never appended just because it exists (§58).
 */
export async function buildTutorContext(input: {
  learnerId: string;
  conversationId: string;
  roadmapItemId?: string;
  question?: string;
}): Promise<string> {
  const parts: string[] = [];

  const goal = await prisma.goal.findFirst({
    where: { learnerId: input.learnerId, status: "active" },
    orderBy: { createdAt: "desc" },
    include: { roadmap: true },
  });
  if (goal) parts.push(`Active goal: ${goal.title} (target level: ${goal.targetLevel}).`);

  // Roadmap map with stable ids so the model can reference nodes (§62).
  if (goal?.roadmap) {
    const nodes = await prisma.roadmapItem.findMany({
      where: { roadmapId: goal.roadmap.id },
      orderBy: [{ index: "asc" }],
      take: 60,
    });
    const lines = nodes
      .filter((n) => !n.parentId)
      .map((n) => `- [${n.id}] "${n.title}" (${n.type}, status: ${n.status}${n.origin === "tutor" ? ", tutor branch" : ""})`)
      .join("\n");
    if (lines) parts.push(`Roadmap steps (use these exact ids in targetNodeId):\n${lines}`);
    const branches = nodes.filter((n) => n.origin === "tutor");
    if (branches.length) {
      parts.push(`Existing tutor practice branches: ${branches.length} node(s), e.g. ${branches.slice(0, 3).map((b) => `"${b.title}"`).join(", ")}`);
    }
  }

  // Current task context.
  let currentNodeId = input.roadmapItemId ?? null;
  if (!currentNodeId) {
    const current = await prisma.roadmapItem.findFirst({
      where: { roadmap: { goal: { learnerId: input.learnerId } }, status: "active" },
      orderBy: { index: "asc" },
    });
    currentNodeId = current?.id ?? null;
  }

  const skillIds: string[] = [];
  if (currentNodeId) {
    const node = await prisma.roadmapItem.findUnique({ where: { id: currentNodeId } });
    if (node) {
      parts.push(`Current roadmap step: [${node.id}] "${node.title}" — ${node.objective || node.description}`);
      skillIds.push(...safeJson<string[]>(node.skillIds, []));
      if (node.taskId) {
        const task = await prisma.task.findUnique({ where: { id: node.taskId } });
        if (task) parts.push(`Current task: "${task.title}"\nStatement:\n${task.statement.slice(0, 1200)}`);
        const attempt = await prisma.taskAttempt.findFirst({
          where: { learnerId: input.learnerId, taskId: node.taskId },
          orderBy: { createdAt: "desc" },
        });
        if (attempt) {
          parts.push(
            `Learner's latest code (task "${task?.title ?? ""}"):\n\`\`\`python\n${attempt.code.slice(0, 1500)}\n\`\`\``,
          );
          parts.push(`Latest verification: ${attempt.passed}/${attempt.total} tests passed, hints used: ${attempt.hintsUsed}.`);
        }
      }
      if (node.contentId) {
        const lesson = await prisma.contentItem.findUnique({ where: { id: node.contentId } });
        if (lesson) parts.push(`Current lesson (excerpt the learner just read):\n${lesson.body.slice(0, 900)}`);
      }
    }
  }

  // Competency vector for the relevant skills only.
  if (skillIds.length) {
    const comps = await prisma.competencyState.findMany({
      where: { learnerId: input.learnerId, topicId: AGGREGATE_SCOPE, skillId: { in: skillIds } },
    });
    for (const c of comps) {
      const name = getSkill(c.skillId)?.name ?? c.skillId;
      const mastery = c.evidenceCount > 0 ? `${Math.round((c.masteryAlpha / (c.masteryAlpha + c.masteryBeta)) * 100)}% over ${c.evidenceCount} observation(s)` : "not assessed";
      parts.push(
        `Competency ${name}: ${mastery}; independence ${Math.round(c.independence * 100)}%, transfer ${Math.round(c.transfer * 100)}%, retention checks ${c.retentionChecks}, depth ${c.depth}`,
      );
    }
  }

  // Confidence calibration history (§100) — observable, labelled, bounded.
  if (skillIds.length) {
    const confEvents = await prisma.learningEvent.findMany({
      where: { learnerId: input.learnerId, type: "confidence_submitted", skillId: { in: skillIds } },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    if (confEvents.length) {
      parts.push(
        `Confidence calibration (recent): ${confEvents
          .map((e) => {
            const p = safeJson<{ confidence?: number; correct?: boolean }>(e.payload, {});
            const conf = Math.round((p.confidence ?? 0) * 100);
            return `${p.correct ? "correct" : "missed"}@${conf}%`;
          })
          .join(", ")}`,
      );
    }
  }

  const misconceptions = await prisma.misconception.findMany({
    where: { learnerId: input.learnerId, topicId: AGGREGATE_SCOPE, status: { in: ["active", "monitoring"] } },
    orderBy: { confidence: "desc" },
    take: 5,
  });
  if (misconceptions.length) {
    parts.push(
      `Active misconceptions: ${misconceptions.map((m) => `${m.code} (skill ${m.skillId}, confidence ${m.confidence.toFixed(2)}, ${m.status})`).join("; ")}`,
    );
  }

  // Recent attempts — recurring errors, labelled and specific (§62).
  const attempts = await prisma.taskAttempt.findMany({
    where: { learnerId: input.learnerId },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { task: true },
  });
  if (attempts.length) {
    parts.push(
      `Recent attempts (newest first):\n${attempts
        .map((a) => `- task "${a.task?.title ?? a.taskId}" — ${a.passed}/${a.total} passed, hints ${a.hintsUsed}, ${a.createdAt.toISOString().slice(0, 10)}`)
        .join("\n")}`,
    );
    const hintTotal = attempts.reduce((n, a) => n + a.hintsUsed, 0);
    parts.push(`Hint usage across recent attempts: ${hintTotal} hint(s) over ${attempts.length} attempt(s) — adjust support accordingly (§73).`);
  }

  // Available learning materials (titles only — content comes via grounding).
  const materials = await prisma.material.findMany({
    where: { OR: [{ learnerId: input.learnerId }, { scope: "global" }], status: "ready" },
    take: 8,
    select: { filename: true, scope: true },
  });
  if (materials.length) {
    parts.push(`Available materials: ${materials.map((m) => `${m.filename}${m.scope === "global" ? " (shared)" : ""}`).join(", ")}`);
  }

  // What the tutor already did in this conversation — avoid repeating itself.
  const pastActions = await prisma.message.findMany({
    where: {
      learnerId: input.learnerId,
      conversationId: input.conversationId,
      role: "assistant",
      actionType: { in: ["GENERATE_TASKS", "CREATE_ROADMAP_BRANCH", "ADD_ROADMAP_SUBSTEPS", "EDIT_ROADMAP_NODE", "CREATE_DIAGNOSTIC"] },
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });
  if (pastActions.length) {
    parts.push(`What the tutor already did in this conversation: ${pastActions.map((m) => m.actionType).join(", ")}.`);
  }

  // Hint ladder state (§72): which levels were already given.
  const hintMessages = await prisma.message.findMany({
    where: { learnerId: input.learnerId, conversationId: input.conversationId, role: "assistant", actionType: "GIVE_HINT" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  if (hintMessages.length) {
    const levels = hintMessages.map((m) => safeJson<{ hintLevel?: number }>(m.meta, {}).hintLevel ?? -1);
    parts.push(`Hints already given at ladder levels: ${levels.join(", ")} — escalate by at most one step, never repeat (§72).`);
  }

  // Bounded recent conversation + targeted older retrieval (§60).
  const recent = await recentConversationContext(input.learnerId, input.conversationId, 8);
  if (recent.length) parts.push(`Recent conversation:\n${recent.join("\n")}`);

  if (input.question) {
    const older = await searchConversationHistory(input.learnerId, input.question, 4);
    const recentSet = new Set(recent);
    const olderLines = older
      .map((o) => `${o.role === "user" ? "Learner" : "Tutor"}: ${o.content}`)
      .filter((l) => !recentSet.has(l));
    if (olderLines.length) parts.push(`Relevant earlier messages (from previous conversations):\n${olderLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

/** Short affirmative replies that confirm a previously offered goal reframing. */
function isConfirmation(msg: string): boolean {
  return /^(да|давай|ага|ок|окей|ok|okay|yes|yeah|yep|go|готов|готово|согласен|согласна|продолжай|продолжим)$/i.test(msg.trim());
}

/** A/B/C/D or 1..4 → option index, else null. */
function parseAnswerIndex(msg: string): number | null {
  const m = msg.trim().toLowerCase();
  if (/^[a-d]$/.test(m)) return m.charCodeAt(0) - 97;
  if (/^[1-4]$/.test(m)) return Number(m) - 1;
  return null;
}

/** Evaluate an answer to a pending tutor-created quiz (§108). */
async function checkPendingDiagnosticAnswer(
  learnerId: string,
  conversationId: string,
  message: string,
  lang: "en" | "ru",
): Promise<TutorResult | null> {
  const last = await prisma.message.findFirst({
    where: { conversationId, learnerId, role: "assistant" },
    orderBy: { createdAt: "desc" },
  });
  const pending = last ? safeJson<{ pendingDiagnostic?: { questionId: string; skillId: string } }>(last.meta, {}) : {};
  if (!pending.pendingDiagnostic) return null;

  const idx = parseAnswerIndex(message);
  if (idx === null) return null;

  const q = await prisma.diagnosticQuestion.findUnique({ where: { id: pending.pendingDiagnostic.questionId } });
  if (!q || q.learnerId !== learnerId) return null;
  await prisma.diagnosticQuestion.delete({ where: { id: q.id } }).catch(() => {});

  const correct = idx === q.correctIndex;
  const strength = effectiveWeight({ method: "deterministic", role: "primary", taskValidity: TASK_VALIDITY.keyed });
  const value = {
    correct,
    strength,
    supportUsed: 0,
    hintsUsed: 0,
    cognitiveLevel: "apply",
    transferLevel: 0,
    integrationLevel: 0,
    independenceRequired: 0,
    integrated: false,
    retentionCheck: false,
    retentionDelayed: false,
    taskFamily: "tutor-diagnostic",
    kind: "diagnostic",
    method: "deterministic",
    misconceptions: correct ? [] : q.misconception ? [q.misconception] : [],
  };
  await applyEvidence({ learnerId, skillIds: [pending.pendingDiagnostic.skillId], primarySkillId: pending.pendingDiagnostic.skillId, value });
  await createEvidence({
    learnerId,
    skillIds: [pending.pendingDiagnostic.skillId],
    kind: "diagnostic",
    method: "deterministic",
    value,
    strength,
    summary: `Tutor quiz ${correct ? "correct" : "incorrect"} on ${getSkill(pending.pendingDiagnostic.skillId)?.name ?? ""}`,
    lineage: { questionId: q.id, correct },
  });

  const reply = `${correct ? (lang === "ru" ? "Верно! " : "Correct! ") : lang === "ru" ? "Не совсем. " : "Not quite. "}${q.explanation}`;
  await appendMessage({ learnerId, conversationId, role: "assistant", content: reply, intent: "assessment", actionType: "ANSWER" });
  return {
    conversationId,
    intent: "assessment",
    actionType: "ANSWER",
    reply,
    misconceptionCode: correct ? null : q.misconception || null,
  };
}

export async function tutor(input: {
  learnerId: string;
  message: string;
  conversationId?: string;
  roadmapItemId?: string;
  language?: string;
}): Promise<TutorResult> {
  const lang = normalizeLang(input.language);
  const prompt = getPrompt("tutor")!;
  const actionPrompt = getPrompt("tutor-actions")!;

  // Resolve the conversation (ownership is enforced inside appendMessage).
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const owned = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!owned || owned.learnerId !== input.learnerId) conversationId = null;
  }
  if (!conversationId) {
    const conversation = await getOrCreateActiveConversation(input.learnerId);
    conversationId = conversation.id;
  }

  await appendMessage({ learnerId: input.learnerId, conversationId, role: "user", content: input.message });

  // No goal yet? This conversation IS the goal-setting step (§3).
  const activeGoal = await prisma.goal.findFirst({
    where: { learnerId: input.learnerId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  if (!activeGoal) {
    const trimmed = input.message.trim();

    // A short reply may be the learner confirming a previously offered,
    // out-of-scope goal that we reframed (e.g. cooking → cooking-themed Python).
    if (trimmed.length < 12) {
      const last = await prisma.message.findFirst({
        where: { conversationId, learnerId: input.learnerId, role: "assistant" },
        orderBy: { createdAt: "desc" },
      });
      const pending = last ? safeJson<{ reframedStatement?: string }>(last.meta, {}) : {};
      if (pending.reframedStatement && isConfirmation(trimmed)) {
        const confirmed = await createGoalFromStatement({
          learnerId: input.learnerId,
          statement: pending.reframedStatement,
          language: lang,
          confirmed: true,
        });
        if (confirmed.ok) {
          const reply =
            lang === "ru"
              ? `Отлично — фиксирую вашу цель: **${confirmed.spec.title}**.\n\nПрежде чем начать, определим ваш реальный уровень коротким адаптивным тестом (около 4 вопросов). Отвечайте честно — это только настраивает ваш план под вас, а не оценивает вас.\n\nГотовы? Тогда проходим тест →`
              : `Great — I'm setting your goal: **${confirmed.spec.title}**.\n\nBefore we start, let's find your real level with a short adaptive test (about 4 questions). Answer honestly — it only shapes your roadmap; it doesn't judge you.\n\nReady? Take the test →`;
          await appendMessage({ learnerId: input.learnerId, conversationId, role: "assistant", content: reply, intent: "goal_created", actionType: "EXPLAIN", meta: { goalId: confirmed.goalId } });
          return { conversationId, intent: "goal_created", actionType: "EXPLAIN", reply, misconceptionCode: null, goalId: confirmed.goalId };
        }
      }

      const ask =
        lang === "ru"
          ? "Расскажите чуть подробнее, чему вы хотите научиться? Например: «Хочу выучить Python с нуля» или «Хочу стать ML-инженером»."
          : "Tell me a bit more about what you want to learn — for example: “I want to learn Python from zero” or “I want to become an ML engineer”.";
      await appendMessage({ learnerId: input.learnerId, conversationId, role: "assistant", content: ask, intent: "clarify_goal", actionType: "ASK_CLARIFYING_QUESTION" });
      return { conversationId, intent: "clarify_goal", actionType: "ASK_CLARIFYING_QUESTION", reply: ask, misconceptionCode: null };
    }

    const result = await createGoalFromStatement({
      learnerId: input.learnerId,
      statement: input.message,
      language: lang,
    });

    // Out-of-scope subject (cooking, meteorology, …): be honest and ask first.
    if (!result.ok) {
      const reply =
        lang === "ru"
          ? `${result.notice}\n\nВот что я могу предложить вместо этого:\n\n> ${result.reframedStatement}\n\nГотовы к такому раскладу? Напишите «да», и я построю план по этой формулировке.`
          : `${result.notice}\n\nHere's what I can offer instead:\n\n> ${result.reframedStatement}\n\nReady for that? Reply “yes” and I'll build the plan from that.`;
      await appendMessage({
        learnerId: input.learnerId,
        conversationId,
        role: "assistant",
        content: reply,
        intent: "out_of_scope",
        actionType: "ASK_CLARIFYING_QUESTION",
        meta: { reframedStatement: result.reframedStatement },
      });
      return { conversationId, intent: "out_of_scope", actionType: "ASK_CLARIFYING_QUESTION", reply, misconceptionCode: null };
    }

    const { goalId, spec } = result;
    const reply =
      lang === "ru"
        ? `Отлично — фиксирую вашу цель: **${spec.title}**.\n\nПрежде чем начать, определим ваш реальный уровень коротким адаптивным тестом (около 4 вопросов). Отвечайте честно — это только настраивает ваш план под вас, а не оценивает вас.\n\nГотовы? Тогда проходим тест →`
        : `Great — I'm setting your goal: **${spec.title}**.\n\nBefore we start, let's find your real level with a short adaptive test (about 4 questions). Answer honestly — it only shapes your roadmap; it doesn't judge you.\n\nReady? Take the test →`;
    await appendMessage({ learnerId: input.learnerId, conversationId, role: "assistant", content: reply, intent: "goal_created", actionType: "EXPLAIN", meta: { goalId } });
    return { conversationId, intent: "goal_created", actionType: "EXPLAIN", reply, misconceptionCode: null, goalId };
  }

  // Answer to a pending tutor quiz is evaluated deterministically first (§108).
  const pendingAnswer = await checkPendingDiagnosticAnswer(input.learnerId, conversationId, input.message, lang);
  if (pendingAnswer) return pendingAnswer;

  const context = await buildTutorContext({
    learnerId: input.learnerId,
    conversationId,
    roadmapItemId: input.roadmapItemId,
    question: input.message,
  });

  const result = await generateObject(
    TutorSchema,
    actionPrompt.capability,
    `${actionPrompt.system}\n\n---\n\n${prompt.system}`,
    [
      `LEARNER CONTEXT:\n${context || "(no active task)"}`,
      `LEARNER MESSAGE:\n${input.message}`,
      langInstruction(lang),
    ].join("\n\n"),
    { maxTokens: 8000 },
  );

  // Execute a proposed action through the core services — never by the model.
  let actionResult: TutorActionResult | null = null;
  if (result.action?.type && result.action.type !== "ANSWER") {
    actionResult = await executeTutorAction({
      learnerId: input.learnerId,
      action: result.action as TutorAction,
      fallbackItemId: input.roadmapItemId ?? null,
      language: lang,
    });
  }

  const reply = actionResult ? `${result.reply}\n\n${describeActionResult(actionResult, lang)}` : result.reply;

  const meta: Record<string, unknown> = actionResult
    ? { action: actionResult }
    : { actionType: result.actionType };
  if (actionResult?.type === "created_diagnostic") {
    meta.pendingDiagnostic = { questionId: actionResult.questionId, skillId: actionResult.skillId };
  }
  if (result.actionType === "GIVE_HINT" && result.hintLevel !== null) {
    meta.hintLevel = result.hintLevel;
  }

  await appendMessage({
    learnerId: input.learnerId,
    conversationId,
    role: "assistant",
    content: reply,
    intent: result.intent,
    actionType: result.actionType,
    taskId: actionResult?.type === "created_tasks" ? actionResult.taskIds[0] : null,
    roadmapItemId: actionResult && "parentItemId" in actionResult ? actionResult.parentItemId : actionResult?.type === "roadmap_edit" ? actionResult.nodeId : null,
    meta,
  });

  // Conversation as micro-assessment (§107): only a clearly detected
  // misconception becomes WEAK evidence — an unverified AI opinion must never
  // carry the weight of a deterministic result (§14).
  if (result.misconceptionCode) {
    const known = await prisma.misconception.findFirst({
      where: { learnerId: input.learnerId, code: result.misconceptionCode },
    });
    const skillId = known?.skillId ?? "python.functions";
    const strength = effectiveWeight({ method: "ai-interpretation", role: "primary", taskValidity: TASK_VALIDITY.unvalidated });
    const value = {
      correct: false,
      strength,
      supportUsed: 1,
      hintsUsed: 0,
      cognitiveLevel: "understanding",
      transferLevel: 0,
      integrationLevel: 0,
      independenceRequired: 0,
      integrated: false,
      retentionCheck: false,
      retentionDelayed: false,
      taskFamily: "tutor-conversation",
      kind: "tutor",
      method: "ai-interpretation",
      misconceptions: [result.misconceptionCode],
    };
    await applyEvidence({ learnerId: input.learnerId, skillIds: [skillId], primarySkillId: skillId, value });
    await createEvidence({
      learnerId: input.learnerId,
      skillIds: [skillId],
      kind: "tutor",
      method: "ai-interpretation",
      value,
      strength,
      summary: `Tutor conversation surfaced possible misconception: ${result.misconceptionCode}`,
    });
  }

  return {
    conversationId,
    intent: result.intent,
    actionType: result.actionType,
    reply,
    misconceptionCode: result.misconceptionCode,
    action: actionResult,
  };
}
