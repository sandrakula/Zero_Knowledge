import { prisma, LOCAL_LEARNER_ID, getOrCreateLearner } from "@/lib/db";
import { getLearnerSummary, getActiveMisconceptions, recommendNext } from "@/lib/core/student-twin";
import { getRoadmapView } from "@/lib/core/roadmap";
import { handle } from "@/lib/api";
import { DOMAINS, SKILLS } from "@/lib/core/knowledge-graph";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await getOrCreateLearner();

    const [summary, misconceptions, goal, roadmap, skills] = await Promise.all([
      getLearnerSummary(LOCAL_LEARNER_ID),
      getActiveMisconceptions(LOCAL_LEARNER_ID),
      prisma.goal.findFirst({ where: { learnerId: LOCAL_LEARNER_ID, status: "active" }, orderBy: { createdAt: "desc" } }),
      prisma.goal.findFirst({ where: { learnerId: LOCAL_LEARNER_ID, status: "active" }, orderBy: { createdAt: "desc" } }).then((g) => (g ? getRoadmapView(g.id) : null)),
      prisma.skill.count(),
    ]);

    const nextBest = roadmap ? await recommendNext(LOCAL_LEARNER_ID, roadmap.id) : { next: null, queue: [] };

    // Domain coverage for the knowledge map.
    const domainStats = DOMAINS.map((d) => {
      const domainSkills = SKILLS.filter((s) => s.domain === d.id);
      const withState = domainSkills.filter((s) => summary.skills.some((c) => c.skillId === s.id));
      const mastered = summary.skills.filter((c) => domainSkills.some((s) => s.id === c.skillId) && c.mastery >= 0.6);
      return {
        id: d.id,
        name: d.name,
        icon: d.icon,
        color: d.color,
        total: domainSkills.length,
        seen: withState.length,
        mastered: mastered.length,
      };
    });

    return {
      hasGoal: Boolean(goal),
      goal: goal
        ? {
            id: goal.id,
            title: goal.title,
            domain: goal.domain,
            targetLevel: goal.targetLevel,
            statement: goal.statement,
          }
        : null,
      roadmap: roadmap
        ? {
            id: roadmap.id,
            summary: roadmap.summary,
            items: roadmap.items,
            progress: {
              total: roadmap.items.length,
              completed: roadmap.items.filter((i) => i.status === "completed").length,
            },
          }
        : null,
      summary,
      misconceptions,
      nextBest,
      domainStats,
      skillsSeeded: skills,
    };
  });
}
