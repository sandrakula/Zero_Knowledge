import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { createEvidence, effectiveWeight, TASK_VALIDITY } from "./evidence";
import { applyEvidence, getCompetencyView } from "./student-twin";

// ─────────────────────────────────────────────────────────────
// Teach-back assessment (§95) — the learner explains a concept in their own
// words and the explanation is judged against a rubric. This produces RUBRIC
// evidence (weaker than execution, stronger than a bare AI opinion) and is a
// real depth-of-understanding signal, not a multiple-choice guess.
// ─────────────────────────────────────────────────────────────

const ExplainEvalSchema = z.object({
  correct: z.boolean(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  misconceptions: z.array(z.string()).default([]),
});

export async function evaluateExplanation(input: {
  learnerId: string;
  skillId: string;
  answer: string;
  language?: string;
}): Promise<{
  correct: boolean;
  confidence: number;
  feedback: string;
  misconceptions: string[];
  competency: Awaited<ReturnType<typeof getCompetencyView>>;
}> {
  const skill = getSkill(input.skillId);
  if (!skill) throw new Error("Skill not found");

  const prompt = getPrompt("diagnostic-evaluate")!;
  const res = await generateObject(
    ExplainEvalSchema,
    prompt.capability,
    prompt.system,
    [
      `Skill being explained: ${skill.name} (${skill.id})\nDescription: ${skill.description}`,
      `Learner's teach-back explanation:\n${input.answer.slice(0, 3000)}`,
      langInstruction(input.language),
    ].join("\n\n"),
    { maxTokens: 4000 },
  );

  const strength = effectiveWeight({
    method: "rubric",
    role: "primary",
    taskValidity: TASK_VALIDITY.unvalidated,
  });
  const value = {
    correct: res.correct,
    strength,
    supportUsed: 0,
    hintsUsed: 0,
    cognitiveLevel: "understanding",
    transferLevel: 0,
    integrationLevel: 0,
    independenceRequired: 0,
    integrated: false,
    retentionCheck: false,
    retentionDelayed: false,
    taskFamily: "teach-back",
    kind: "explanation",
    method: "rubric",
    misconceptions: res.misconceptions ?? [],
  };

  await applyEvidence({ learnerId: input.learnerId, skillIds: [input.skillId], primarySkillId: input.skillId, value });
  await createEvidence({
    learnerId: input.learnerId,
    skillIds: [input.skillId],
    kind: "explanation",
    method: "rubric",
    value,
    strength,
    summary: `Teach-back on ${skill.name}`,
  });

  const competency = await getCompetencyView(input.learnerId, input.skillId);
  return {
    correct: res.correct,
    confidence: res.confidence,
    feedback: res.explanation,
    misconceptions: res.misconceptions ?? [],
    competency,
  };
}
