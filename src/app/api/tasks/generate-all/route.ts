import { cancelTaskGeneration, getTaskGenerationJob, startTaskGeneration } from "@/lib/core/task-bank-job";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

/** Progress of the background "generate tasks for every subtopic" job. */
export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    return { job: getTaskGenerationJob(userId) };
  });
}

/** Start (or resume) the bulk job. Idempotent while it is already running. */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json().catch(() => ({}));
    return { job: startTaskGeneration(userId, normalizeLang(body?.lang)) };
  });
}

/** Ask the running job to stop after the current subtopic. */
export async function DELETE() {
  return handle(async () => {
    const userId = await requireUser();
    cancelTaskGeneration(userId);
    return { job: getTaskGenerationJob(userId) };
  });
}
