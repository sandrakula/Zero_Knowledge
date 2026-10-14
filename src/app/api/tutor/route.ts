import { tutor } from "@/lib/core/tutor";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    return tutor({
      learnerId: userId,
      message: String(body.message ?? ""),
      conversationId: body.conversationId ? String(body.conversationId) : undefined,
      roadmapItemId: body.roadmapItemId ? String(body.roadmapItemId) : undefined,
      taskId: body.taskId ? String(body.taskId) : undefined,
      code: body.code ? String(body.code) : undefined,
      language: normalizeLang(body.lang),
    });
  });
}
