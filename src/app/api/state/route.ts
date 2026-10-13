import { prisma, ensureLearner } from "@/lib/db";
import { getLearnerSummary, getActiveMisconceptions, recommendNext } from "@/lib/core/student-twin";
import { getRoadmapView } from "@/lib/core/roadmap";
import { handle, requireUser } from "@/lib/api";
import { DOMAINS, SKILLS } from "@/lib/core/knowledge-graph";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    await ensureLearner(userId);

    const [summary, misconceptions, goal, roadmap] = await Promise.all([
      getLearnerSummary(userId),
      getActiveMisconceptions(userId),
      prisma.goal.findFirst({ where: { learnerId: userId, status: "active" }, orderBy: { createdAt: "desc" } }),
      prisma.goal
        .findFirst({ where: { learnerId: userId, status: "active" }, orderBy: { createdAt: "desc" } })
        .then((g) => (g ? getRoadmapView(g.id) : null)),
    ]);

    const nextBest = roadmap ? await recommendNext(userId, roadmap.id) : { next: null, queue: [] };

    const domainStats = DOMAINS.map((d) => {
      const domainSkills = SKILLS.filter((s) => s.domain === d.id);
      const mastered = summary.skills.filter((c) => domainSkills.some((s) => s.id === c.skillId) && c.mastery >= 0.6);
      return {
        id: d.id,
        name: d.name,
        icon: d.icon,
        color: d.color,
        total: domainSkills.length,
        seen: domainSkills.filter((s) => summary.skills.some((c) => c.skillId === s.id)).length,
        mastered: mastered.length,
      };
    });

    const materialCount = await prisma.material.count({ where: { learnerId: userId } });

    return {
      hasGoal: Boolean(goal),
      goal: goal
        ? { id: goal.id, title: goal.title, domain: goal.domain, targetLevel: goal.targetLevel, statement: goal.statement }
        : null,
      roadmap: roadmap
        ? {
            id: roadmap.id,
            summary: roadmap.summary,
            items: roadmap.items,
            progress: { total: roadmap.items.length, completed: roadmap.items.filter((i) => i.status === "completed").length },
          }
        : null,
      summary,
      misconceptions,
      nextBest,
      domainStats,
      materialCount,
    };
  });
}
