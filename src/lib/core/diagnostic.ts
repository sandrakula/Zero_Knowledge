import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { createEvidence, effectiveWeight, TASK_VALIDITY } from "./evidence";
import { applyEvidence } from "./student-twin";

// ─────────────────────────────────────────────────────────────
// Adaptive diagnostic assessment (§66–67). Probes the learner's starting
// level and seeds the Student Learning Twin with initial evidence.
// ─────────────────────────────────────────────────────────────

const QSchema = z.object({
  question: z.string(),
  code: z.string().default(""),
  options: z.array(z.string()),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  misconception: z.string().default(""),
});

export type DiagnosticQuestion = z.infer<typeof QSchema> & {
  id: string;
  skillId: string;
  skillName: string;
  difficulty: string;
};

/** Answer key is never sent to the client — only the question surface is. */
export function publicQuestion(q: DiagnosticQuestion) {
  return {
    id: q.id,
    skillId: q.skillId,
    skillName: q.skillName,
    difficulty: q.difficulty,
    question: q.question,
    code: q.code,
    options: q.options,
  };
}

function levelFor(mastery: number): string {
  if (mastery < 0.33) return "beginner";
  if (mastery < 0.66) return "intermediate";
  return "advanced";
}

export async function generateQuestion(
  learnerId: string,
  skillId: string,
  level: string,
  language?: string,
): Promise<DiagnosticQuestion> {
  const prompt = getPrompt("diagnostic-question")!;
  const skill = getSkill(skillId)!;
  const q = await generateObject(
    QSchema,
    prompt.capability,
    prompt.system,
    `Skill: ${skill.name} (${skill.id})\nDescription: ${skill.description}\nTarget difficulty: ${level}\n${langInstruction(language)}`,
    { maxTokens: 8000 },
  );
  const id = `dq_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  // Persist the answer key so an in-progress diagnostic survives a restart.
  await prisma.diagnosticQuestion.create({
    data: {
      id,
      learnerId,
      skillId,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      misconception: q.misconception ?? "",
    },
  });
  return {
    ...q,
    code: q.code ?? "",
    misconception: q.misconception ?? "",
    id,
    skillId,
    skillName: skill.name,
    difficulty: level,
  };
}

function pickSkills(goalSkills: string[]): string[] {
  // Topological-ish order: prerequisites before dependents, then by difficulty.
  const ordered = goalSkills
    .map((id) => getSkill(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .sort((a, b) => a.difficulty - b.difficulty);
  // Keep a spread across the range: foundational → mid → advanced.
  const chosen: string[] = [];
  const n = ordered.length;
  const idx = n <= 4 ? ordered.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  const seen = new Set<number>();
  for (const i of idx) {
    if (i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      chosen.push(ordered[i].id);
    }
  }
  return chosen;
}

export async function startDiagnostic(goalId: string, learnerId: string, language?: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, include: { targetSkills: true } });
  if (!goal || goal.learnerId !== learnerId) throw new Error("Goal not found");

  // Clear any stale questions from a previous interrupted diagnostic.
  await prisma.diagnosticQuestion.deleteMany({ where: { learnerId } });

  const goalSkills = goal.targetSkills.map((g) => g.skillId);
  const ladder = pickSkills(goalSkills);
  const first = ladder[0];

  const q = await generateQuestion(learnerId, first, "beginner", language);
  return {
    ladder,
    index: 0,
    question: publicQuestion(q),
  };
}

export async function answerDiagnostic(input: {
  goalId: string;
  ladder: string[];
  index: number;
  questionId: string;
  skillId: string;
  selectedIndex: number;
  confidence: number;
  learnerId: string;
  language?: string;
}) {
  const key = await prisma.diagnosticQuestion.findUnique({ where: { id: input.questionId } });
  if (!key || key.learnerId !== input.learnerId) {
    throw new Error("Question expired — please restart the diagnostic");
  }
  await prisma.diagnosticQuestion.delete({ where: { id: key.id } }).catch(() => {});

  const correct = input.selectedIndex === key.correctIndex;
  // A keyed diagnostic question is deterministic but authored, so its validity
  // multiplier is slightly below an executed test suite (see evidence.ts).
  const strength = effectiveWeight({
    method: "deterministic",
    role: "primary",
    taskValidity: TASK_VALIDITY.keyed,
  });
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
    taskFamily: "diagnostic",
    kind: "diagnostic",
    method: "deterministic",
    misconceptions: correct ? [] : key.misconception ? [key.misconception] : [],
  };

  await applyEvidence({ learnerId: input.learnerId, skillIds: [input.skillId], primarySkillId: input.skillId, value });
  await createEvidence({
    learnerId: input.learnerId,
    skillIds: [input.skillId],
    kind: "diagnostic",
    method: "deterministic",
    value,
    strength,
    summary: `Diagnostic ${correct ? "correct" : "incorrect"} on ${getSkill(input.skillId)?.name}`,
    lineage: { questionId: input.questionId, confidence: input.confidence, correct },
  });

  // Confidence calibration evidence (§100).
  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "confidence_submitted",
      skillId: input.skillId,
      payload: JSON.stringify({ confidence: input.confidence, correct, calibration: correct ? 1 - input.confidence : input.confidence }),
    },
  });

  // Advance to the next ladder skill (foundational → advanced). The answer
  // adjusts the difficulty of the next question and seeds the learning twin;
  // the ladder always terminates after one pass.
  const nextIndex = input.index + 1;
  const done = nextIndex >= input.ladder.length;
  const feedback = key.explanation;

  if (done) {
    // The roadmap is built lazily by the client (POST /api/roadmap/ensure)
    // AFTER the learner sees the final verdict, so checking an answer never
    // blocks on a large generation call.
    await prisma.learningEvent.create({
      data: { learnerId: input.learnerId, type: "diagnostic_completed", payload: JSON.stringify({ goalId: input.goalId }) },
    });
    return { done: true, correct, feedback, next: null, summary: "Diagnostic complete — your learning twin is initialized." };
  }

  const nextSkillId = input.ladder[nextIndex];
  const nextLevel = correct ? levelFor(0.6) : "beginner";
  // Verdict is returned immediately; the next question is generated by
  // `nextDiagnosticQuestion` in a separate request (see /api/diagnostic/next).
  return {
    done: false,
    correct,
    feedback,
    next: { index: nextIndex, skillId: nextSkillId, level: nextLevel },
  };
}

/** Generate the next adaptive question on demand (never blocks the verdict). */
export async function nextDiagnosticQuestion(input: {
  learnerId: string;
  skillId: string;
  level: string;
  language?: string;
}) {
  if (!getSkill(input.skillId)) throw new Error("Unknown skill for diagnostic question");
  const q = await generateQuestion(input.learnerId, input.skillId, input.level, input.language);
  return { question: publicQuestion(q) };
}
