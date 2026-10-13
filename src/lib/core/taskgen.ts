import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { runTests } from "./code-runner";

// ─────────────────────────────────────────────────────────────
// Task generation with deterministic validation (§114–128).
// Spec → generate → reference solution → execute → edge-case check → approve.
// ─────────────────────────────────────────────────────────────

const TaskSchema = z.object({
  title: z.string(),
  family: z.string(),
  statement: z.string(),
  starterCode: z.string().default(""),
  referenceSolution: z.string(),
  tests: z.array(z.object({ input: z.string(), expected: z.string() })).min(3),
  hints: z.array(z.string()).min(2),
  cognitiveLevel: z.string().default("apply"),
  misconceptionTargets: z.array(z.string()).default([]),
});

export type GeneratedTask = {
  title: string;
  family: string;
  statement: string;
  starterCode: string;
  referenceSolution: string;
  tests: { input: string; expected: string }[];
  hints: string[];
  cognitiveLevel: string;
  misconceptionTargets: string[];
  skillIds: string[];
  difficulty: number;
  transferLevel: number;
  integrationLevel: number;
  independenceRequired: number;
  language?: string;
};

function normalize(
  t: z.infer<typeof TaskSchema>,
  input: { skillIds: string[]; difficulty: number; transferLevel: number; integrationLevel: number; independenceRequired: number; language?: string },
): GeneratedTask {
  return {
    ...t,
    starterCode: t.starterCode ?? "",
    cognitiveLevel: t.cognitiveLevel ?? "apply",
    misconceptionTargets: t.misconceptionTargets ?? [],
    skillIds: input.skillIds,
    difficulty: input.difficulty,
    transferLevel: input.transferLevel,
    integrationLevel: input.integrationLevel,
    independenceRequired: input.independenceRequired,
    language: input.language,
  };
}

/** Validate a generated programming task by executing its reference solution. */
export async function validateTask(task: { referenceSolution: string; tests: { input: string; expected: string }[] }) {
  const result = await runTests(task.referenceSolution, task.tests);
  return {
    valid: result.passed === result.total && result.total > 0,
    passed: result.passed,
    total: result.total,
    failures: result.results.filter((r) => !r.pass).slice(0, 3).map((r) => ({
      input: r.expected !== undefined ? "see expected" : "",
      expected: r.expected,
      got: r.stdout.trim(),
      error: r.stderr.slice(0, 200),
    })),
  };
}

export async function generateTask(input: {
  skillIds: string[];
  difficulty: number;
  cognitiveLevel: string;
  transferLevel: number;
  integrationLevel: number;
  independenceRequired: number;
  misconceptions?: string[];
  language?: string;
}): Promise<GeneratedTask> {
  const prompt = getPrompt("task")!;
  const skills = input.skillIds.map((id) => getSkill(id)).filter(Boolean);
  const names = skills.map((s) => `${s!.name} (${s!.id})`).join(", ");

  const user = [
    `Target skills: ${names}`,
    `Difficulty: ${Math.round(input.difficulty * 100)}/100`,
    `Cognitive level: ${input.cognitiveLevel}`,
    `Transfer level: ${input.transferLevel}`,
    `Misconception targets to consider: ${(input.misconceptions ?? []).join(", ") || "none"}`,
    `The task must be solvable with ONLY these concepts.`,
    langInstruction(input.language),
  ].join("\n");

  // Deterministic validation before publishing (§126). The reference solution
  // MUST pass its own tests — otherwise the task is never shown to a learner.
  // Keep the same concept across retries and only fix internal consistency.
  let candidate = await generateObject(TaskSchema, prompt.capability, prompt.system, user, {
    maxTokens: 12000,
  });
  let validation = await validateTask(candidate);

  for (let attempt = 0; attempt < 2 && !validation.valid; attempt++) {
    const fixPrompt = [
      user,
      `Your previous task failed its own tests. Keep the SAME title and statement, but fix the reference solution and/or the expected outputs so they are exactly consistent.`,
      `Mind whitespace: the expected output is compared EXACTLY against stdout (trimmed), and the reference solution must read stdin via input() and print() only the answer.`,
      `Failures:\n${JSON.stringify(validation.failures, null, 2)}`,
      `Previous reference solution:\n\`\`\`python\n${candidate.referenceSolution}\n\`\`\``,
      `Previous tests:\n${JSON.stringify(candidate.tests)}`,
    ].join("\n\n");

    candidate = await generateObject(TaskSchema, prompt.capability, prompt.system, fixPrompt, {
      maxTokens: 12000,
    });
    validation = await validateTask(candidate);
  }

  if (!validation.valid) {
    throw new Error(`Task validation failed: ${JSON.stringify(validation.failures)}`);
  }

  return normalize(candidate, input);
}

/** Persist a validated task (provenance = generated). */
export async function persistTask(task: GeneratedTask): Promise<string> {
  const saved = await prisma.task.create({
    data: {
      skillIds: JSON.stringify(task.skillIds),
      family: task.family,
      title: task.title,
      statement: task.statement,
      difficulty: task.difficulty,
      cognitiveLevel: task.cognitiveLevel,
      independenceRequired: task.independenceRequired,
      transferLevel: task.transferLevel,
      integrationLevel: task.integrationLevel,
      starterCode: task.starterCode,
      referenceSolution: task.referenceSolution,
      tests: JSON.stringify(task.tests),
      hints: JSON.stringify(task.hints),
      status: "validated",
      provenance: "generated",
      sourceIds: "[]",
      language: task.language ?? "en",
    },
  });
  return saved.id;
}
