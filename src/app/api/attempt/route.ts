import { LOCAL_LEARNER_ID } from "@/lib/db";
import { evaluateAttempt } from "@/lib/core/evaluation";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    return evaluateAttempt({
      learnerId: LOCAL_LEARNER_ID,
      taskId: body.taskId,
      roadmapItemId: body.roadmapItemId,
      code: body.code ?? "",
      hintsUsed: body.hintsUsed ?? 0,
      confidence: body.confidence,
      timeSpentSeconds: body.timeSpentSeconds,
    });
  });
}
