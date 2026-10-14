import { nextDiagnosticQuestion } from "@/lib/core/diagnostic";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Generate the next diagnostic question. Kept separate from /answer so the
 *  verdict for the previous question is returned without waiting on the model. */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    return nextDiagnosticQuestion({
      learnerId: userId,
      skillId: String(body.skillId ?? ""),
      level: String(body.level ?? "beginner"),
      language: normalizeLang(body.lang),
    });
  });
}
