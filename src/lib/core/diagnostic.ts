import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { getSkill } from "./knowledge-graph";
import { createEvidence } from "./evidence";
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

// In-memory answer keys. Diagnostic questions are ephemeral; on restart the
// learner simply re-does the (cheap) diagnostic. Evidence is only committed
// once an answer arrives, so state is never corrupted by a restart.
const keyStore = new Map<string, { correctIndex: number; explanation: string; misconception: string }>();

/** Answer key is never sent to the client — only the question surface is. */
function publicQuestion(q: DiagnosticQuestion) {
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

async function generateQuestion(
  skillId: string,
  level: string,
): Promise<DiagnosticQuestion> {
  const prompt = getPrompt("diagnostic-question")!;
  const skill = getSkill(skillId)!;
  const q = await generateObject(
    QSchema,
    prompt.capability,
    prompt.system,
    `Skill: ${skill.name} (${skill.id})\nDescription: ${skill.description}\nTarget difficulty: ${level}`,
    { maxTokens: 2000 },
  );
  const id = `dq_${Math.random().toString(36).slice(2, 10)}`;
  keyStore.set(id, { correctIndex: q.correctIndex, explanation: q.explanation, misconception: q.misconception ?? "" });
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

export async function startDiagnostic(goalId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, include: { targetSkills: true } });
  if (!goal) throw new Error("Goal not found");

  const goalSkills = goal.targetSkills.map((g) => g.skillId);
  const ladder = pickSkills(goalSkills);
  const first = ladder[0];

  const q = await generateQuestion(first, "beginner");
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
}) {
  const key = keyStore.get(input.questionId);
  if (!key) throw new Error("Question expired — please restart the diagnostic");

  const correct = input.selectedIndex === key.correctIndex;
  const value = {
    correct,
    strength: 0.85,
    supportUsed: 0,
    hintsUsed: 0,
    cognitiveLevel: "apply",
    transferLevel: 0,
    independenceRequired: 0,
    integrated: false,
    retentionCheck: false,
    kind: "diagnostic",
    method: "deterministic",
    misconceptions: correct ? [] : key.misconception ? [key.misconception] : [],
  };

  await applyEvidence({ learnerId: input.learnerId, skillIds: [input.skillId], value });
  await createEvidence({
    learnerId: input.learnerId,
    skillIds: [input.skillId],
    kind: "diagnostic",
    method: "deterministic",
    value,
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

  // Adaptive next step: correct → advance; wrong → reinforce same skill one notch down.
  const nextIndex = correct ? input.index + 1 : input.index;
  const nextSkillId = input.ladder[Math.min(nextIndex, input.ladder.length - 1)];
  const nextLevel = correct ? levelFor(0.5) : "beginner";

  const done = correct ? nextIndex >= input.ladder.length : nextIndex >= input.ladder.length - 1;

  const feedback = key.explanation;

  if (done) {
    return { done: true, correct, feedback, summary: "Diagnostic complete — your learning twin is initialized." };
  }

  const nextQ = await generateQuestion(nextSkillId, nextLevel);
  return { done: false, correct, feedback, index: Math.min(nextIndex, input.ladder.length - 1), question: publicQuestion(nextQ) };
}
