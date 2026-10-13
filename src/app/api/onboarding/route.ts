import { prisma, ensureLearner } from "@/lib/db";
import { compileGoal } from "@/lib/core/goal-compiler";
import { generateRoadmap } from "@/lib/core/roadmap";
import { handle, fail, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const statement = String(body.statement ?? "").trim();
    const level = String(body.level ?? "beginner");
    const hoursPerWeek = Math.max(1, Math.min(40, Number(body.hoursPerWeek ?? 5)));
    const lang = normalizeLang(body.lang);

    if (!statement) return fail("Please describe your learning goal.", 400);

    await ensureLearner(userId);
    const spec = await compileGoal({ statement, level, language: lang });

    const goal = await prisma.goal.create({
      data: {
        learnerId: userId,
        title: spec.title,
        statement,
        domain: spec.domain,
        targetLevel: spec.targetLevel,
        hoursPerWeek,
        deadline: body.deadline ? new Date(body.deadline) : null,
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

    await generateRoadmap({
      goalId: goal.id,
      learnerId: userId,
      spec,
      competency: [],
      language: lang,
    });

    const roadmap = await prisma.roadmap.findUnique({ where: { goalId: goal.id } });

    return {
      goalId: goal.id,
      spec: { ...spec, targetSkills: spec.targetSkills.slice(0, 8) },
      roadmapId: roadmap?.id,
      roadmapSummary: roadmap?.summary,
    };
  });
}
