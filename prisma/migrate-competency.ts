// Non-destructive migration for the Beta-Binomial competency model (§24).
//
// Adds persistent posterior parameters to EXISTING competency states by
// reconstructing them from the legacy (mastery, masteryUncertainty) pair.
// Nothing is deleted: learners, evidence, tasks, materials, messages and
// roadmaps are untouched.
//
// Documented assumptions for legacy rows:
//  - legacy uncertainty u meant "1 / (n + 1)", so n = 1/u - 1;
//  - the legacy prior was 1 success / 3 failures, so s = p*(n+4) - 1, f = n - s;
//  - alpha = s + 1, beta = f + 3 (same prior, now stored explicitly);
//  - independent successes, task families and depth counters were NOT recorded
//    before, so they start empty and are only filled by new evidence;
//  - supportDependence inherits the old hintDependence value;
//  - a stored retention value with a retrieval timestamp counts as one check.
//
// Run: pnpm db:migrate-competency

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PRIOR_S = 1;
const PRIOR_F = 3;
const PRIOR_N = PRIOR_S + PRIOR_F;

async function main() {
  const rows = await prisma.competencyState.findMany();
  let migrated = 0;

  for (const r of rows) {
    const posteriorAlreadySet = !(r.masteryAlpha === 1 && r.masteryBeta === 3);
    const hasLegacyEvidence = r.mastery > 0 || r.attempts > 0 || (r.masteryUncertainty ?? 1) < 1;
    if (posteriorAlreadySet || !hasLegacyEvidence) continue;

    const n = Math.max(0, 1 / Math.max(r.masteryUncertainty ?? 1, 1e-6) - 1);
    const s = Math.min(n, Math.max(0, r.mastery * (n + PRIOR_N) - PRIOR_S));
    const f = Math.max(0, n - s);

    await prisma.competencyState.update({
      where: { id: r.id },
      data: {
        masteryAlpha: s + PRIOR_S,
        masteryBeta: f + PRIOR_F,
        evidenceCount: Math.max(r.evidenceCount, r.attempts, Math.round(n)),
        supportDependence: r.hintDependence,
        retentionChecks: r.lastRetrievedAt ? Math.max(r.retentionChecks, 1) : r.retentionChecks,
        retentionSuccesses: r.lastRetrievedAt
          ? Math.max(r.retentionSuccesses, r.retention >= 0.5 ? 1 : 0)
          : r.retentionSuccesses,
        lastAssessmentAt: r.lastAssessmentAt ?? r.lastSeenAt,
      },
    });
    migrated++;
  }

  console.log(`Competency migration: ${migrated} of ${rows.length} states updated.`);
  console.log("Existing learners, evidence, tasks, materials, messages and roadmaps were preserved.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
