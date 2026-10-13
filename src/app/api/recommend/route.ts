import { prisma } from "@/lib/db";
import { recommendNext } from "@/lib/core/student-twin";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const { searchParams } = new URL(req.url);
    const roadmapId = searchParams.get("roadmapId") ?? undefined;
    const active = await prisma.goal.findFirst({
      where: { learnerId: userId, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { roadmap: true },
    });
    const rId = roadmapId ?? active?.roadmap?.id;
    return recommendNext(userId, rId);
  });
}
