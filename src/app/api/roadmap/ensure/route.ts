import { ensureRoadmap } from "@/lib/core/roadmap";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Build the roadmap if it does not exist yet (idempotent). */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    return ensureRoadmap({
      goalId: String(body.goalId ?? ""),
      learnerId: userId,
      language: normalizeLang(body.lang),
      force: Boolean(body.force),
    });
  });
}
