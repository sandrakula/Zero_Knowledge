import { LOCAL_LEARNER_ID } from "@/lib/db";
import { tutor } from "@/lib/core/tutor";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const result = await tutor({
      learnerId: LOCAL_LEARNER_ID,
      message: String(body.message ?? ""),
      roadmapItemId: body.roadmapItemId,
    });
    return result;
  });
}
