import { prisma, ensureLearner } from "@/lib/db";
import { compileGoal, type GoalSpec } from "./goal-compiler";
import { normalizeLang } from "@/lib/lang";

// Shared goal creation — used by the onboarding form AND by the tutor when the
// learner states their goal conversationally. The roadmap is built later, once
// the skill-level diagnostic has produced evidence (see buildRoadmapFromGoal).

export type GoalCreateResult =
  | { ok: true; goalId: string; spec: GoalSpec }
  | { ok: false; reason: "out_of_scope"; notice: string; reframedStatement: string };

/** Honest, deterministic warning for goals whose subject is outside the platform. */
export function outOfScopeNotice(lang?: string | null): string {
  return normalizeLang(lang) === "ru"
    ? "Я не могу научить вас этому предмету напрямую — платформа обучает программированию, алгоритмам, структурам данных, математике, статистике и машинному обучению. Но я могу построить план обучения программированию, где ваши задачи и проекты будут связаны с этой темой."
    : "I can't teach this subject directly — the platform teaches programming, algorithms, data structures, mathematics, statistics and machine learning. But I can build a programming plan where your tasks and projects are themed around it.";
}

export async function createGoalFromStatement(input: {
  learnerId: string;
  statement: string;
  level?: string;
  hoursPerWeek?: number;
  language?: string;
  /** Learner already accepted the reframed, in-scope version of the goal. */
  confirmed?: boolean;
}): Promise<GoalCreateResult> {
  await ensureLearner(input.learnerId);

  const spec = await compileGoal({
    statement: input.statement,
    level: input.level ?? "beginner",
    language: input.language,
  });

  // Out-of-scope subjects (cooking, meteorology, …) must be surfaced honestly,
  // never silently rewritten into a Python roadmap that ends in a cooking project.
  if (spec.outOfScope && !input.confirmed) {
    return {
      ok: false,
      reason: "out_of_scope",
      notice: outOfScopeNotice(input.language),
      reframedStatement: spec.reframedStatement,
    };
  }

  const finalStatement = spec.outOfScope ? spec.reframedStatement || input.statement : input.statement;
  const finalSpec = spec.outOfScope
    ? await compileGoal({
        statement: finalStatement,
        level: input.level ?? "beginner",
        language: input.language,
      })
    : spec;

  const goal = await prisma.goal.create({
    data: {
      learnerId: input.learnerId,
      title: finalSpec.title,
      statement: finalStatement,
      domain: finalSpec.domain,
      targetLevel: finalSpec.targetLevel,
      hoursPerWeek: Math.max(1, Math.min(40, input.hoursPerWeek ?? 5)),
    },
  });

  await prisma.goalSkill.createMany({
    data: finalSpec.targetSkills.map((skillId, i) => ({
      goalId: goal.id,
      skillId,
      priority: i,
      weight: 1,
    })),
  });

  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "goal_created",
      payload: JSON.stringify({ goalId: goal.id, title: finalSpec.title, domain: finalSpec.domain, statement: finalStatement }),
    },
  });

  return { ok: true, goalId: goal.id, spec: finalSpec };
}
