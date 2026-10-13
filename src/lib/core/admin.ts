import { prisma } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// Admin overview (§222, §208): a short, evidence-based digest of every
// student — knowledge level, roadmap progress, and study frequency.
// ─────────────────────────────────────────────────────────────

export type StudentRow = {
  id: string;
  name: string;
  email: string;
  goalTitle: string | null;
  diagnosed: boolean;
  roadmap: { total: number; completed: number } | null;
  avgMastery: number;
  masteredSkills: number;
  seenSkills: number;
  attempts: number;
  attempts7d: number;
  evidenceCount: number;
  misconceptionCount: number;
  materialCount: number;
  lastActivityAt: string | null;
};

export async function getAdminOverview() {
  const users = await prisma.user.findMany({ where: { role: "student" }, orderBy: { createdAt: "asc" } });
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const students: StudentRow[] = [];
  for (const u of users) {
    const learnerId = u.id;
    const [goal, comps, attempts, attempts7d, evidence, misconceptions, materials, lastEvent, diagnosed] = await Promise.all([
      prisma.goal.findFirst({
        where: { learnerId, status: "active" },
        orderBy: { createdAt: "desc" },
        include: { roadmap: { include: { items: true } } },
      }),
      prisma.competencyState.findMany({ where: { learnerId } }),
      prisma.taskAttempt.count({ where: { learnerId } }),
      prisma.taskAttempt.count({ where: { learnerId, createdAt: { gte: weekAgo } } }),
      prisma.evidence.count({ where: { learnerId } }),
      prisma.misconception.count({ where: { learnerId, status: { in: ["active", "monitoring"] } } }),
      prisma.material.count({ where: { learnerId } }),
      prisma.learningEvent.findFirst({ where: { learnerId }, orderBy: { createdAt: "desc" } }),
      prisma.evidence.findFirst({ where: { learnerId, kind: "diagnostic" } }),
    ]);

    const items = goal?.roadmap?.items ?? [];
    const completed = items.filter((i) => i.status === "completed").length;
    const avgMastery = comps.length ? comps.reduce((a, c) => a + c.mastery, 0) / comps.length : 0;

    students.push({
      id: u.id,
      name: u.name,
      email: u.email,
      goalTitle: goal?.title ?? null,
      diagnosed: Boolean(diagnosed),
      roadmap: goal?.roadmap ? { total: items.length, completed } : null,
      avgMastery,
      masteredSkills: comps.filter((c) => c.mastery >= 0.6).length,
      seenSkills: comps.length,
      attempts,
      attempts7d,
      evidenceCount: evidence,
      misconceptionCount: misconceptions,
      materialCount: materials,
      lastActivityAt: lastEvent?.createdAt.toISOString() ?? null,
    });
  }

  return {
    students,
    totals: {
      students: students.length,
      globalMaterials: await prisma.material.count({ where: { scope: "global" } }),
      totalAttempts: await prisma.taskAttempt.count(),
      totalEvidence: await prisma.evidence.count(),
    },
  };
}
