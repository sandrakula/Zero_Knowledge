import { prisma, ensureLearner } from "@/lib/db";
import { compileGoal, type GoalSpec } from "./goal-compiler";

// Shared goal creation — used by the onboarding form AND by the tutor when the
// learner states their goal conversationally. The roadmap is built later, once
// the skill-level diagnostic has produced evidence (see buildRoadmapFromGoal).

export async function createGoalFromStatement(input: {
  learnerId: string;
  statement: string;
  level?: string;
  hoursPerWeek?: number;
  language?: string;
}): Promise<{ goalId: string; spec: GoalSpec }> {
  await ensureLearner(input.learnerId);

  const spec = await compileGoal({
    statement: input.statement,
    level: input.level ?? "beginner",
    language: input.language,
  });

  const goal = await prisma.goal.create({
    data: {
      learnerId: input.learnerId,
      title: spec.title,
      statement: input.statement,
      domain: spec.domain,
      targetLevel: spec.targetLevel,
      hoursPerWeek: Math.max(1, Math.min(40, input.hoursPerWeek ?? 5)),
    },
  });

  await prisma.goalSkill.createMany({
    data: spec.targetSkills.map((skillId, i) => ({
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
      payload: JSON.stringify({ goalId: goal.id, title: spec.title, domain: spec.domain }),
    },
  });

  return { goalId: goal.id, spec };
}
