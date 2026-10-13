import { prisma } from "@/lib/db";
import { getRoadmapView } from "@/lib/core/roadmap";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const { searchParams } = new URL(req.url);
    const goalId = searchParams.get("goalId");
    const goal = goalId
      ? await prisma.goal.findUnique({ where: { id: goalId } })
      : await prisma.goal.findFirst({ orderBy: { createdAt: "desc" } });
    if (!goal) return { roadmap: null };
    const view = await getRoadmapView(goal.id);
    return { roadmap: view };
  });
}
