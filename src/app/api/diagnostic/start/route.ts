import { prisma } from "@/lib/db";
import { startDiagnostic } from "@/lib/core/diagnostic";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const { goalId, lang } = await req.json();
    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.learnerId !== userId) return { error: "Goal not found", status: 404 };
    return startDiagnostic(goalId, userId, normalizeLang(lang));
  });
}
