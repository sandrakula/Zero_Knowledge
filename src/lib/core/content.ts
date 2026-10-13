import { prisma } from "@/lib/db";
import { generateText } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { getSkill } from "./knowledge-graph";
import { getCompetencyView } from "./student-twin";

// ─────────────────────────────────────────────────────────────
// Content Intelligence (§39–64). Curriculum (what to learn) is separate
// from content (how it is taught). Generated content carries provenance.
// ─────────────────────────────────────────────────────────────

export async function generateLesson(input: {
  learnerId: string;
  skillIds: string[];
  title: string;
  cognitiveLevel?: string;
}): Promise<string> {
  const prompt = getPrompt("lesson")!;
  const skills = input.skillIds.map((id) => getSkill(id)).filter(Boolean);
  const names = skills.map((s) => `${s!.name} (${s!.id})`).join(", ");

  // Calibrate to learner state (§59): level + misconceptions + prior depth.
  const comps = [];
  for (const id of input.skillIds) {
    const c = await getCompetencyView(input.learnerId, id);
    if (c) comps.push(`${c.name}: mastery ${c.mastery.toFixed(2)}, depth ${c.depth}, independence ${c.independence.toFixed(2)}`);
  }
  const mis = await prisma.misconception.findMany({
    where: { learnerId: input.learnerId, status: { in: ["active", "monitoring"] }, skillId: { in: input.skillIds } },
  });

  const body = await generateText(
    prompt.capability,
    prompt.system,
    [
      `Lesson title: ${input.title}`,
      `Target skills: ${names}`,
      `Requested cognitive level: ${input.cognitiveLevel ?? "apply"}`,
      `Learner state: ${comps.join("; ") || "unknown"}`,
      `Watch for misconceptions: ${mis.map((m) => m.code).join(", ") || "none"}`,
    ].join("\n"),
    { maxTokens: 2200 },
  );

  return body;
}

/** Get or create the lesson content for a roadmap item (provenance: generated). */
export async function ensureLessonForItem(input: {
  learnerId: string;
  itemId: string;
}): Promise<{ id: string; title: string; body: string }> {
  const item = await prisma.roadmapItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new Error("Roadmap item not found");

  if (item.contentId) {
    const existing = await prisma.contentItem.findUnique({ where: { id: item.contentId } });
    if (existing) return { id: existing.id, title: existing.title, body: existing.body };
  }

  const skillIds = JSON.parse(item.skillIds) as string[];
  const body = await generateLesson({
    learnerId: input.learnerId,
    skillIds,
    title: item.title,
  });

  const content = await prisma.contentItem.create({
    data: {
      skillId: skillIds[0] ?? null,
      title: item.title,
      body,
      kind: "lesson",
      provenance: "generated",
      status: "generated",
      meta: JSON.stringify({ roadmapItemId: item.id, skillIds }),
    },
  });

  await prisma.roadmapItem.update({ where: { id: item.id }, data: { contentId: content.id } });
  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "content_generated",
      skillId: skillIds[0] ?? null,
      payload: JSON.stringify({ contentId: content.id, title: item.title, provenance: "generated" }),
    },
  });

  return { id: content.id, title: content.title, body: content.body };
}
