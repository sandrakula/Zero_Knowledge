import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { runTests } from "./code-runner";
import { createEvidence, effectiveWeight, TASK_VALIDITY } from "./evidence";
import { applyEvidence, getCompetencyView, AGGREGATE_SCOPE } from "./student-twin";
import { getOwnedNode, markItemCompleted, maybeRegenerateRoadmap } from "./roadmap";
import { getSkill } from "./knowledge-graph";
import { classifyFailureCause, RULES } from "./competency";
import { retentionEstimate, RETENTION_DUE_THRESHOLD } from "./mastery";
import { langInstruction } from "@/lib/lang";
import { clamp } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Assessment Intelligence (§25, §137–139). Deterministic verification first,
// AI interpretation as a supporting signal — never ground truth on its own.
// Evidence is built here with explicit per-dimension classification so that
// ordinary practice cannot inflate transfer, application or retention.
// ─────────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  correct: z.boolean(),
  feedback: z.string(),
  misconceptions: z.array(z.string()).default([]),
  hintLevel: z.number().int().min(0).max(6).default(0),
  issues: z.array(z.object({ line: z.number().int().min(1), message: z.string() })).default([]),
});

export async function evaluateAttempt(input: {
  learnerId: string;
  taskId: string;
  roadmapItemId?: string;
  code: string;
  hintsUsed: number;
  confidence?: number;
  timeSpentSeconds?: number;
  language?: string;
}) {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task) throw new Error("Task not found");

  // Ownership check (§64): the referenced roadmap node, if any, must belong to
  // the learner — an attempt must not complete or grade someone else's node.
  if (input.roadmapItemId) {
    const owned = await getOwnedNode(input.learnerId, input.roadmapItemId);
    if (!owned) throw new Error("Roadmap item not found");
  }

  const tests = JSON.parse(task.tests) as { input: string; expected: string }[];
  const skillIds = JSON.parse(task.skillIds) as string[];

  // 1) Deterministic verification — execution against tests (§25, §126).
  const run = await runTests(input.code, tests);
  const passedAll = run.passed === run.total && run.total > 0;
  const passedRatio = run.total > 0 ? run.passed / run.total : 0;

  let feedback = "";
  let misconceptions: string[] = [];
  let issues: { line: number; message: string }[] = [];

  if (passedAll) {
    const names = skillIds.map((id) => getSkill(id)?.name ?? id).join(" & ");
    feedback =
      `### ✅ All ${run.total}/${run.total} tests passed\n\n` +
      `Your solution works correctly on every provided case. ${task.transferLevel >= RULES.transferThreshold ? "You also transferred the concept to a new context, which is exactly what we're after." : ""}\n\n` +
      `**What to notice:** this is evidence that **${names}** is strengthening. If you can, explain your approach in one sentence — teaching it back locks it in.`;
  } else {
    // 2) AI interpretation as a supporting signal on top of the deterministic failure.
    const prompt = getPrompt("task-evaluate")!;
    const failing = run.results
      .filter((r) => !r.pass)
      .slice(0, 3)
      .map((r, i) => `Case ${i + 1}:\n  expected: "${r.expected}"\n  got: "${r.stdout.trim()}"\n  stderr: "${r.stderr.slice(0, 200)}"`)
      .join("\n\n");

    try {
      const review = await generateObject(
        ReviewSchema,
        prompt.capability,
        prompt.system,
        [
          `Task: ${task.title}\n\nStatement:\n${task.statement}`,
          `Learner submission:\n\`\`\`python\n${input.code}\n\`\`\``,
          `Test results (${run.passed}/${run.total} passed):\n${failing}`,
          langInstruction(input.language),
        ].join("\n\n"),
        { maxTokens: 6000 },
      );
      feedback = `### ${review.correct ? "Nearly there" : `${run.passed}/${run.total} tests passing`}\n\n${review.feedback}`;
      misconceptions = review.misconceptions ?? [];
      issues = review.issues ?? [];
    } catch {
      feedback =
        `### ${run.passed}/${run.total} tests passing\n\n` +
        `Your solution doesn't satisfy all the tests yet. Compare the expected and actual outputs below, trace the first failing case by hand, and adjust.` +
        `\n\n\`\`\`\n${failing}\n\`\`\``;
    }
  }

  // Diagnose the failure cause (§86) BEFORE the evidence moves the state.
  let cause: string | null = null;
  let calibration: { confidence: number; correct: boolean; direction: "overconfident" | "underconfident" | "calibrated" } | null = null;
  const primarySkillId = skillIds[0];

  if (!passedAll) {
    const [before, raw] = await Promise.all([
      primarySkillId ? getCompetencyView(input.learnerId, primarySkillId) : Promise.resolve(null),
      primarySkillId
        ? prisma.competencyState.findUnique({ where: { learnerId_skillId_topicId: { learnerId: input.learnerId, skillId: primarySkillId, topicId: input.roadmapItemId ?? AGGREGATE_SCOPE } } })
        : Promise.resolve(null),
    ]);
    const retentionStale = Boolean(
      raw && raw.retentionChecks > 0 && retentionEstimate(raw.retention, raw.lastRetrievedAt) < RETENTION_DUE_THRESHOLD,
    );
    cause = classifyFailureCause({
      wasDemonstrated: before?.status === "demonstrated",
      retentionStale,
      activeMisconception: Boolean(before?.misconceptions?.length),
    });
  }

  if (input.confidence !== undefined) {
    const direction: "overconfident" | "underconfident" | "calibrated" =
      input.confidence > 0.66 && !passedAll ? "overconfident" : input.confidence < 0.5 && passedAll ? "underconfident" : "calibrated";
    calibration = { confidence: input.confidence, correct: passedAll, direction };
  }

  // 3) Evidence → Student Learning Twin update (§22, §160).
  const supportUsed = clamp((input.hintsUsed ?? 0) / 3, 0, 1);
  const strength = effectiveWeight({
    method: "deterministic",
    role: "primary",
    taskValidity: TASK_VALIDITY.validated,
  });

  const value = {
    correct: passedAll,
    strength,
    supportUsed,
    hintsUsed: input.hintsUsed ?? 0,
    cognitiveLevel: task.cognitiveLevel,
    transferLevel: task.transferLevel,
    integrationLevel: task.integrationLevel,
    independenceRequired: task.independenceRequired,
    integrated: task.integrationLevel >= RULES.integrationThreshold,
    retentionCheck: false,
    retentionDelayed: false,
    passedRatio,
    taskFamily: task.family,
    kind: "attempt",
    method: "deterministic",
    misconceptions,
  };

  await applyEvidence({ learnerId: input.learnerId, skillIds, primarySkillId, topicId: input.roadmapItemId, value });
  const evidenceId = await createEvidence({
    learnerId: input.learnerId,
    skillIds,
    kind: "attempt",
    method: "deterministic",
    value,
    strength,
    summary: `${passedAll ? "Solved" : "Attempted"} "${task.title}" — ${run.passed}/${run.total} tests passed`,
    taskId: input.taskId,
    lineage: {
      taskId: input.taskId,
      hintsUsed: input.hintsUsed,
      confidence: input.confidence,
      passedAll,
      passedRatio,
      primarySkillId,
    },
  });

  await prisma.taskAttempt.create({
    data: {
      learnerId: input.learnerId,
      taskId: input.taskId,
      roadmapItemId: input.roadmapItemId,
      code: input.code,
      passed: run.passed,
      total: run.total,
      passedAll,
      hintsUsed: input.hintsUsed ?? 0,
      supportUsed,
      confidence: input.confidence,
      timeSpentSeconds: input.timeSpentSeconds ?? 0,
      verification: JSON.stringify({ method: "deterministic", passed: run.passed, total: run.total, passedRatio }),
      feedback,
      evidenceId,
    },
  });

  if (input.confidence !== undefined) {
    await prisma.learningEvent.create({
      data: {
        learnerId: input.learnerId,
        type: "confidence_submitted",
        skillId: primarySkillId,
        payload: JSON.stringify({ confidence: input.confidence, correct: passedAll }),
      },
    });
  }

  // Explain the diagnosis to the learner (§86, §100).
  if (cause) {
    const labels: Record<string, string> = {
      misconception: input.language === "ru" ? "активное заблуждение — разберём его отдельно" : "an active misconception — we'll address it separately",
      forgetting: input.language === "ru" ? "материал забылся — нужно повторение" : "forgetting — a review is due",
      never_mastered: input.language === "ru" ? "тема ещё не освоена — вернёмся к основам" : "this was not yet mastered — let's revisit the foundations",
      execution_error: input.language === "ru" ? "похоже на случайную ошибку — проверь детали" : "likely a slip — double-check the details",
    };
    feedback += `\n\n**${input.language === "ru" ? "Диагноз" : "Diagnosis"}:** ${labels[cause] ?? cause}.`;
  }

  // Complete the roadmap item on full success with little support.
  if (passedAll && input.roadmapItemId && supportUsed <= 0.34) {
    await markItemCompleted(input.learnerId, input.roadmapItemId);
    // If the plan now has redundant (already-mastered) topics, re-plan it.
    await maybeRegenerateRoadmap(input.learnerId, input.roadmapItemId, input.language);
  }

  const competency = primarySkillId ? await getCompetencyView(input.learnerId, primarySkillId) : null;

  return {
    passed: run.passed,
    total: run.total,
    passedAll,
    feedback,
    misconceptions,
    issues,
    cause,
    calibration,
    method: "deterministic",
    testResults: run.results.map((r) => ({
      pass: r.pass,
      expected: r.expected,
      got: r.stdout.trim(),
      stderr: r.stderr.slice(0, 300),
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    })),
    competency,
  };
}
