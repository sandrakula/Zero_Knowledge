import { prisma } from "@/lib/db";
import { DOMAINS, SKILLS } from "@/lib/core/knowledge-graph";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const states = await prisma.competencyState.findMany({ where: { learnerId: userId } });
    const byId = new Map(states.map((s) => [s.skillId, s]));

    const skills = SKILLS.map((s) => {
      const st = byId.get(s.id);
      return {
        id: s.id,
        name: s.name,
        domain: s.domain,
        difficulty: s.difficulty,
        category: s.category,
        prerequisites: s.prerequisites,
        mastery: st?.mastery ?? null,
        uncertainty: st?.masteryUncertainty ?? 1,
        depth: st?.depth ?? null,
        independence: st?.independence ?? null,
        transfer: st?.transfer ?? null,
        retention: st?.retention ?? null,
        attempts: st?.attempts ?? 0,
        seen: Boolean(st),
      };
    });

    return { domains: DOMAINS, skills };
  });
}
