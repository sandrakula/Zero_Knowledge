import { LOCAL_LEARNER_ID } from "@/lib/db";
import { openLearnItem } from "@/lib/core/learn";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const { itemId } = await req.json();
    return openLearnItem({ learnerId: LOCAL_LEARNER_ID, itemId });
  });
}
