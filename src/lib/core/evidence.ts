import { prisma } from "@/lib/db";
import type { EvidencePayload } from "./types";

// ─────────────────────────────────────────────────────────────
// Evidence Engine (§22–25). Collects, structures, weights and
// connects observations to learning-state updates. Preserves lineage
// so any competency state can be explained.
// ─────────────────────────────────────────────────────────────

/** Reliability weight for a given verification method (§24). */
export function methodStrength(method: string): number {
  switch (method) {
    case "deterministic":
      return 1.0; // execution + tests
    case "rubric":
      return 0.75;
    case "ai-interpretation":
      return 0.45;
    case "trace":
      return 0.35;
    default:
      return 0.4;
  }
}

export async function createEvidence(input: {
  learnerId: string;
  skillIds: string[];
  kind: string;
  method: string;
  value: EvidencePayload | Record<string, unknown>;
  summary: string;
  taskId?: string;
  attemptId?: string;
  lineage?: Record<string, unknown>;
}): Promise<string> {
  const strength =
    typeof input.value === "object" && input.value && "strength" in input.value
      ? (input.value as EvidencePayload).strength
      : methodStrength(input.method);

  const ev = await prisma.evidence.create({
    data: {
      learnerId: input.learnerId,
      skillIds: JSON.stringify(input.skillIds),
      kind: input.kind,
      method: input.method,
      strength,
      value: JSON.stringify(input.value),
      summary: input.summary,
      lineage: JSON.stringify(input.lineage ?? {}),
      taskId: input.taskId,
      attemptId: input.attemptId,
    },
  });

  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: `evidence_${input.kind}`,
      skillId: input.skillIds[0] ?? null,
      payload: JSON.stringify({ evidenceId: ev.id, summary: input.summary }),
    },
  });

  return ev.id;
}
