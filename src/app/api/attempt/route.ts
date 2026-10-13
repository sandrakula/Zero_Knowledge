import { evaluateAttempt } from "@/lib/core/evaluation";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    return evaluateAttempt({
      learnerId: userId,
      taskId: body.taskId,
      roadmapItemId: body.roadmapItemId,
      code: body.code ?? "",
      hintsUsed: body.hintsUsed ?? 0,
      confidence: body.confidence,
      timeSpentSeconds: body.timeSpentSeconds,
      language: normalizeLang(body.lang),
    });
  });
}
