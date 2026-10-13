import { DOMAINS, SKILLS } from "@/lib/core/knowledge-graph";
import { getAllSkillMetrics } from "@/lib/core/student-twin";
import { handle, requireUser } from "@/lib/api";
import { emptySkillState, skillMetrics } from "@/lib/core/competency";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const metrics = await getAllSkillMetrics(userId);
    const blank = skillMetrics(emptySkillState());

    const skills = SKILLS.map((s) => {
      const m = metrics.get(s.id) ?? blank;
      return {
        id: s.id,
        name: s.name,
        domain: s.domain,
        description: s.description,
        difficulty: s.difficulty,
        category: s.category,
        cognitiveLevel: s.cognitiveLevel,
        prerequisites: s.prerequisites,
        // Null means NOT ASSESSED — the UI must never invent a percentage.
        status: m.status,
        mastery: m.mastery.value,
        masteryInterval: m.masteryInterval,
        sufficiency: m.sufficiency,
        evidenceCount: m.evidenceCount,
        independentSuccesses: m.independentSuccesses,
        taskFamilies: m.taskFamilies,
        depth: m.depth,
        independence: m.independence.value,
        application: m.application.value,
        transfer: m.transfer.value,
        retention: m.retention.value,
        supportDependence: m.supportDependence.value,
        lastAssessmentAt: m.lastAssessmentAt,
      };
    });

    return { domains: DOMAINS, skills };
  });
}
