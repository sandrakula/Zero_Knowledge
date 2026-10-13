import { prisma } from "@/lib/db";
import { getRoadmapView } from "@/lib/core/roadmap";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const { searchParams } = new URL(req.url);
    const goalId = searchParams.get("goalId");
    const goal = goalId
      ? await prisma.goal.findFirst({ where: { id: goalId, learnerId: userId } })
      : await prisma.goal.findFirst({ where: { learnerId: userId, status: "active" }, orderBy: { createdAt: "desc" } });
    if (!goal) return { roadmap: null };
    return { roadmap: await getRoadmapView(goal.id, userId) };
  });
}
