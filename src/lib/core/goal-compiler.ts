import { z } from "zod";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { SKILLS, getSkill } from "./knowledge-graph";

// ─────────────────────────────────────────────────────────────
// Goal Compiler (§31–33). Natural-language goal → structured target:
// desired outcome → competencies → prerequisites → roadmap.
// ─────────────────────────────────────────────────────────────

export type GoalSpec = {
  title: string;
  domain: string;
  targetLevel: string;
  targetSkills: string[];
  summary: string;
};

const GoalSchema = z.object({
  title: z.string(),
  domain: z.string(),
  targetLevel: z.string(),
  targetSkills: z.array(z.string()),
  summary: z.string(),
});

export function skillCatalogForPrompt(): string {
  return JSON.stringify(
    SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      difficulty: s.difficulty,
      prerequisites: s.prerequisites,
    })),
  );
}

export async function compileGoal(input: {
  statement: string;
  level: string;
  language?: string;
}): Promise<GoalSpec> {
  const prompt = getPrompt("goal-compiler")!;
  const catalog = skillCatalogForPrompt();

  const spec = await generateObject(GoalSchema, prompt.capability, prompt.system, [
    `Learner goal: "${input.statement}"\nStated level: ${input.level}\n\nSkill catalog (id, name, domain, difficulty, prerequisites):\n${catalog}`,
    langInstruction(input.language),
  ].join("\n"), { maxTokens: 4096 });

  // Validate skill ids against the catalog; drop unknown ones and keep order.
  const valid = new Set(SKILLS.map((s) => s.id));
  const targetSkills = spec.targetSkills.filter((id) => valid.has(id));

  // Ensure prerequisites of targeted skills are included for completeness.
  const closure = new Set<string>(targetSkills);
  const addPrereqs = (ids: string[]) => {
    for (const id of ids) {
      const s = getSkill(id);
      if (!s) continue;
      for (const p of s.prerequisites) {
        if (!closure.has(p)) {
          closure.add(p);
          addPrereqs([p]);
        }
      }
    }
  };
  addPrereqs(targetSkills);

  return {
    title: spec.title,
    domain: spec.domain,
    targetLevel: spec.targetLevel,
    targetSkills: [...closure],
    summary: spec.summary,
  };
}
