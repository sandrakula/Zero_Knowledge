import { importRoadmapFromOutline } from "@/lib/core/roadmap";
import { handle, requireUser, ApiError } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Build the plan around a roadmap the learner supplied themselves. The outline
 * is authoritative: its nodes are kept in order, existing sub-items are kept,
 * and only nodes without sub-items are expanded into substeps.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const outline = String(body.outline ?? "").trim();
    if (!outline) throw new ApiError("Roadmap outline is required", 400);
    if (outline.length > 20000) throw new ApiError("Roadmap outline is too long", 400);
    return importRoadmapFromOutline({
      goalId: String(body.goalId ?? ""),
      learnerId: userId,
      outline,
      language: normalizeLang(body.lang),
    });
  });
}
