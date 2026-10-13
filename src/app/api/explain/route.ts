import { evaluateExplanation } from "@/lib/core/explain";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Teach-back evaluation (§95): judge a free-text explanation against a rubric. */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const skillId = String(body.skillId ?? "");
    const answer = String(body.answer ?? "").trim();
    if (!skillId || !answer) return { error: "skillId and answer are required", status: 400 };
    return evaluateExplanation({
      learnerId: userId,
      skillId,
      answer,
      language: normalizeLang(body.lang),
    });
  });
}
