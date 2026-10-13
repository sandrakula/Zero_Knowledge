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

    const goal = await prisma.goal.findFirst({
      where: { learnerId: userId, status: "active" },
      orderBy: { createdAt: "desc" },
    });

    const [summary, misconceptions, roadmap] = await Promise.all([
      getLearnerSummary(userId),
      getActiveMisconceptions(userId),
      goal ? getRoadmapView(goal.id, userId) : Promise.resolve(null),
    ]);

    const nextBest = roadmap ? await recommendNext(userId, roadmap.id) : { next: null, queue: [] };

    const domainStats = DOMAINS.map((d) => {
      const domainSkills = SKILLS.filter((s) => s.domain === d.id);
      const mastered = summary.skills.filter(
        (c) => domainSkills.some((s) => s.id === c.skillId) && c.status === "demonstrated",
      );
      return {
        id: d.id,
        name: d.name,
        icon: d.icon,
        color: d.color,
        total: domainSkills.length,
        seen: domainSkills.filter((s) => summary.skills.some((c) => c.skillId === s.id && c.status !== "not_assessed")).length,
        mastered: mastered.length,
      };
    });

    const materialCount = await prisma.material.count({ where: { learnerId: userId } });

    // Ring metrics follow the topic currently being worked through. Only
    // assessed values are averaged; if nothing is assessed the ring is null.
    const roots = roadmap?.items ?? [];
    const currentItem = roots.find((i) => i.status === "active") ?? roots.find((i) => i.status === "ready");
    let scopeSet = new Set<string>(currentItem?.skillIds ?? []);
    if (scopeSet.size === 0 && goal) {
      const goalSkillRows = await prisma.goalSkill.findMany({ where: { goalId: goal.id } });
      scopeSet = new Set(goalSkillRows.map((g) => g.skillId));
    }
    const scoped = scopeSet.size ? summary.skills.filter((s) => scopeSet.has(s.skillId)) : [];
    const avgOf = (pick: (s: (typeof scoped)[number]) => number | null): number | null => {
      const vals = scoped.map(pick).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    return {
      hasGoal: Boolean(goal),
      goal: goal
        ? { id: goal.id, title: goal.title, domain: goal.domain, targetLevel: goal.targetLevel, statement: goal.statement }
        : null,
      roadmap: roadmap
        ? { id: roadmap.id, summary: roadmap.summary, items: roadmap.items, progress: roadmap.progress }
        : null,
      summary,
      misconceptions,
      nextBest,
      domainStats,
      materialCount,
      goalMetrics: {
        mastery: avgOf((s) => s.mastery),
        independence: avgOf((s) => s.independence),
        transfer: avgOf((s) => s.transfer),
        touched: scoped.length,
        total: scopeSet.size,
      },
    };
  });
}
