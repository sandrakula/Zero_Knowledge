import { getDueReviews } from "@/lib/core/student-twin";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Spaced-retrieval review queue (§87–88): skills due for a retention check. */
export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const due = await getDueReviews(userId);
    return { due };
  });
}
