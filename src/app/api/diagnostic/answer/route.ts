import { answerDiagnostic } from "@/lib/core/diagnostic";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    return answerDiagnostic({
      goalId: body.goalId,
      ladder: body.ladder,
      index: body.index,
      questionId: body.questionId,
      skillId: body.skillId,
      selectedIndex: body.selectedIndex,
      confidence: body.confidence ?? 0.5,
      learnerId: userId,
      language: normalizeLang(body.lang),
    });
  });
}
