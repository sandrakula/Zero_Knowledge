import { regenerateRoadmap } from "@/lib/core/roadmap";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Rebuild the roadmap from the learner's current evidence (manual trigger). */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const goalId = String(body.goalId ?? "");
    if (!goalId) return { error: "Goal id is required", status: 400 };
    return regenerateRoadmap({
      learnerId: userId,
      goalId,
      language: normalizeLang(body.lang),
    });
  });
}
