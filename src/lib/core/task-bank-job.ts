import { ensureTasksForItem, itemsMissingTasks } from "./learn";

// ─────────────────────────────────────────────────────────────
// Bulk task generation (§114). Runs in the background of the long-lived Node
// server: it walks the learner's roadmap and fills every subtopic's task bank
// (>= MIN_TASKS_PER_TOPIC) so nothing has to be generated on first open.
//
// Progress lives in memory, keyed by learner. It survives across requests but
// not across a server restart — a restart simply means "run it again".
// ─────────────────────────────────────────────────────────────

export type TaskGenerationJob = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current: string | null;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
};

type Job = TaskGenerationJob & { cancel: boolean };

const jobs = new Map<string, Job>();

/** How many subtopics are worked on at once — keeps us inside provider limits. */
const CONCURRENCY = 2;

export function getTaskGenerationJob(learnerId: string): TaskGenerationJob | null {
  return jobs.get(learnerId) ?? null;
}

export function cancelTaskGeneration(learnerId: string): void {
  const job = jobs.get(learnerId);
  if (job) job.cancel = true;
}

export function startTaskGeneration(learnerId: string, language?: string): TaskGenerationJob {
  const existing = jobs.get(learnerId);
  if (existing?.running) return existing;

  const job: Job = {
    running: true,
    total: 0,
    done: 0,
    failed: 0,
    current: null,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cancel: false,
  };
  jobs.set(learnerId, job);
  void run(job, learnerId, language);
  return job;
}

async function run(job: Job, learnerId: string, language?: string): Promise<void> {
  try {
    const pending = await itemsMissingTasks(learnerId);
    job.total = pending.length;
    const queue = [...pending];

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !job.cancel) {
        const item = queue.shift()!;
        job.current = item.title;
        try {
          await ensureTasksForItem({ learnerId, itemId: item.id, language });
          job.done += 1;
        } catch (e) {
          job.failed += 1;
          job.errors.push(`${item.title}: ${e instanceof Error ? e.message : "failed"}`);
          if (job.errors.length > 30) job.errors.shift();
        }
        job.current = null;
      }
    });
    await Promise.all(workers);
  } catch (e) {
    job.errors.push(e instanceof Error ? e.message : "job failed");
  } finally {
    job.running = false;
    job.current = null;
    job.finishedAt = new Date().toISOString();
  }
}
