import { openLearnItem } from "@/lib/core/learn";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const { itemId, lang, newTask, taskId } = await req.json();
    return openLearnItem({
      learnerId: userId,
      itemId,
      language: normalizeLang(lang),
      newTask: Boolean(newTask),
      taskId: taskId ? String(taskId) : undefined,
    });
  });
}
