import { prisma, LOCAL_LEARNER_ID } from "@/lib/db";
import { recommendNext } from "@/lib/core/student-twin";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const { searchParams } = new URL(req.url);
    const roadmapId = searchParams.get("roadmapId") ?? undefined;
    const active = await prisma.goal.findFirst({
      where: { learnerId: LOCAL_LEARNER_ID, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { roadmap: true },
    });
    const rId = roadmapId ?? active?.roadmap?.id;
    return recommendNext(LOCAL_LEARNER_ID, rId);
  });
}
