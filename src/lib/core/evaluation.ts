import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { runTests } from "./code-runner";
import { createEvidence } from "./evidence";
import { applyEvidence, getCompetencyView } from "./student-twin";
import { markItemCompleted } from "./roadmap";
import { getSkill } from "./knowledge-graph";
import { langInstruction } from "@/lib/lang";
import { clamp } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Assessment Intelligence (§25, §137–139). Deterministic verification first,
// AI interpretation as a supporting signal — never ground truth on its own.
// ─────────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  correct: z.boolean(),
  feedback: z.string(),
  misconceptions: z.array(z.string()).default([]),
  hintLevel: z.number().int().min(0).max(6).default(0),
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

  const tests = JSON.parse(task.tests) as { input: string; expected: string }[];
  const skillIds = JSON.parse(task.skillIds) as string[];

  // 1) Deterministic verification — execution against tests (§25, §126).
  const run = await runTests(input.code, tests);
  const passedAll = run.passed === run.total && run.total > 0;

  let feedback = "";
  let misconceptions: string[] = [];
  let method = "deterministic";
  let strength = 1.0;

  if (passedAll) {
    const names = skillIds.map((id) => getSkill(id)?.name ?? id).join(" & ");
    feedback =
      `### ✅ All ${run.total}/${run.total} tests passed\n\n` +
      `Excellent — your solution works correctly on every provided case. ${task.transferLevel > 0 ? "You also transferred the concept to a new context, which is exactly what we're after." : ""}\n\n` +
      `**What to notice:** ` +
      `This is evidence that your **${names}** skill is strengthening. If you can, explain your approach in one sentence — teaching it back locks it in.`;
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
      method = "deterministic"; // still grounded by the failing tests
      strength = 0.85;
    } catch {
      feedback =
        `### ${run.passed}/${run.total} tests passing\n\n` +
        `Your solution doesn't satisfy all the tests yet. Compare the expected and actual outputs below, trace the first failing case by hand, and adjust.` +
        `\n\n\`\`\`\n${failing}\n\`\`\``;
    }
  }

  // 3) Evidence → Student Learning Twin update (§22, §160).
  const supportUsed = clamp((input.hintsUsed ?? 0) / 3, 0, 1);
  const value = {
    correct: passedAll,
    strength,
    supportUsed,
    hintsUsed: input.hintsUsed ?? 0,
    cognitiveLevel: task.cognitiveLevel,
    transferLevel: task.transferLevel,
    independenceRequired: task.independenceRequired,
    integrated: skillIds.length > 1,
    retentionCheck: false,
    kind: "attempt",
    method,
    misconceptions,
  };

  await applyEvidence({ learnerId: input.learnerId, skillIds, value });
  const evidenceId = await createEvidence({
    learnerId: input.learnerId,
    skillIds,
    kind: "attempt",
    method,
    value,
    summary: `${passedAll ? "Solved" : "Attempted"} "${task.title}" — ${run.passed}/${run.total} tests passed`,
    taskId: input.taskId,
    lineage: {
      taskId: input.taskId,
      hintsUsed: input.hintsUsed,
      confidence: input.confidence,
      passedAll,
    },
  });

  // Persist the attempt.
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
      verification: JSON.stringify({ method, passed: run.passed, total: run.total }),
      feedback,
      evidenceId,
    },
  });

  if (input.confidence !== undefined) {
    await prisma.learningEvent.create({
      data: {
        learnerId: input.learnerId,
        type: "confidence_submitted",
        skillId: skillIds[0],
        payload: JSON.stringify({ confidence: input.confidence, correct: passedAll }),
      },
    });
  }

  // Complete the roadmap item on full success (with low support).
  if (passedAll && input.roadmapItemId && supportUsed <= 0.34) {
    await markItemCompleted(input.learnerId, input.roadmapItemId);
  }

  // Return updated competency view for the primary skill.
  const competency = await getCompetencyView(input.learnerId, skillIds[0]);

  return {
    passed: run.passed,
    total: run.total,
    passedAll,
    feedback,
    misconceptions,
    method,
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
