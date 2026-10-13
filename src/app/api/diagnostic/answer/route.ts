import { LOCAL_LEARNER_ID } from "@/lib/db";
import { answerDiagnostic } from "@/lib/core/diagnostic";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    return answerDiagnostic({
      goalId: body.goalId,
      ladder: body.ladder,
      index: body.index,
      questionId: body.questionId,
      skillId: body.skillId,
      selectedIndex: body.selectedIndex,
      confidence: body.confidence ?? 0.5,
      learnerId: LOCAL_LEARNER_ID,
    });
  });
}
