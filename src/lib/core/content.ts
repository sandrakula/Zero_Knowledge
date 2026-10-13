import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { getSkill } from "./knowledge-graph";
import { getCompetencyView } from "./student-twin";
import { retrieveChunks } from "./materials";

// ─────────────────────────────────────────────────────────────
// Content Intelligence (§39–64). Curriculum (what to learn) is separate
// from content (how it is taught). Generated content is grounded in the
// learner's uploaded materials where possible, with explicit provenance.
// ─────────────────────────────────────────────────────────────

const LessonSchema = z.object({
  body: z.string(),
  sourceIds: z.array(z.string()).default([]),
});

export type LessonResult = {
  body: string;
  sourceIds: string[];
  sources: { materialId: string; materialName: string; heading: string }[];
  grounded: boolean;
};

export async function generateLesson(input: {
  learnerId: string;
  skillIds: string[];
  title: string;
  cognitiveLevel?: string;
  language?: string;
}): Promise<LessonResult> {
  const prompt = getPrompt("lesson")!;
  const skills = input.skillIds.map((id) => getSkill(id)).filter(Boolean);
  const names = skills.map((s) => `${s!.name} (${s!.id})`).join(", ");

  // Calibrate to learner state (§59).
  const comps = [];
  for (const id of input.skillIds) {
    const c = await getCompetencyView(input.learnerId, id);
    if (c) {
      comps.push(
        `${c.name}: status ${c.status}, mastery ${c.mastery === null ? "not assessed" : c.mastery.toFixed(2)}, depth ${c.depth ?? "n/a"}, independence ${c.independence === null ? "n/a" : c.independence.toFixed(2)}`,
      );
    }
  }
  const mis = await prisma.misconception.findMany({
    where: { learnerId: input.learnerId, status: { in: ["active", "monitoring"] }, skillId: { in: input.skillIds } },
  });

  // Grounding: retrieve relevant chunks from the learner's uploaded materials.
  const chunks = await retrieveChunks({ learnerId: input.learnerId, skillIds: input.skillIds, limit: 4 });
  const sourceBlock = chunks.length
    ? chunks
        .map((c, i) => `[SOURCE ${i}] id="${c.materialId}" material="${c.materialName}" heading="${c.heading}"\n${c.text}`)
        .join("\n\n")
    : "(no source material available)";

  const user = [
    `Lesson title: ${input.title}`,
    `Target skills: ${names}`,
    `Requested cognitive level: ${input.cognitiveLevel ?? "apply"}`,
    `Learner state: ${comps.join("; ") || "unknown"}`,
    `Watch for misconceptions: ${mis.map((m) => m.code).join(", ") || "none"}`,
    `SOURCE MATERIAL EXCERPTS (cite as [src: <material>] when you use them):\n${sourceBlock}`,
    langInstruction(input.language),
  ].join("\n");

  const result = await generateObject(LessonSchema, prompt.capability, prompt.system, user, {
    maxTokens: 8000,
  });

  const usedIds = new Set(result.sourceIds);
  const sources = chunks
    .filter((c) => usedIds.has(c.materialId))
    .map((c) => ({ materialId: c.materialId, materialName: c.materialName, heading: c.heading }));

  return { body: result.body, sourceIds: [...usedIds], sources, grounded: sources.length > 0 };
}

/** Get or create the lesson content for a roadmap item (provenance + grounding). */
export async function ensureLessonForItem(input: {
  learnerId: string;
  itemId: string;
  language?: string;
}): Promise<{ id: string; title: string; body: string; sourceIds: string[]; sources: LessonResult["sources"]; grounded: boolean }> {
  const item = await prisma.roadmapItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new Error("Roadmap item not found");

  if (item.contentId) {
    const existing = await prisma.contentItem.findUnique({ where: { id: item.contentId } });
    if (existing) {
      const sourceIds = JSON.parse(existing.sourceIds) as string[];
      const sources = await resolveSources(sourceIds);
      return {
        id: existing.id,
        title: existing.title,
        body: existing.body,
        sourceIds,
        sources,
        grounded: sourceIds.length > 0,
      };
    }
  }

  const skillIds = JSON.parse(item.skillIds) as string[];
  const lesson = await generateLesson({
    learnerId: input.learnerId,
    skillIds,
    title: item.title,
    language: input.language,
  });

  const content = await prisma.contentItem.create({
    data: {
      skillId: skillIds[0] ?? null,
      title: item.title,
      body: lesson.body,
      kind: "lesson",
      provenance: lesson.grounded ? "enriched" : "generated",
      status: "generated",
      sourceIds: JSON.stringify(lesson.sourceIds),
      language: input.language === "ru" ? "ru" : "en",
      meta: JSON.stringify({ roadmapItemId: item.id, skillIds }),
    },
  });

  await prisma.roadmapItem.update({ where: { id: item.id }, data: { contentId: content.id } });
  await prisma.learningEvent.create({
    data: {
      learnerId: input.learnerId,
      type: "content_generated",
      skillId: skillIds[0] ?? null,
      payload: JSON.stringify({ contentId: content.id, title: item.title, provenance: content.provenance, sourceIds: lesson.sourceIds }),
    },
  });

  return { id: content.id, title: content.title, body: content.body, sourceIds: lesson.sourceIds, sources: lesson.sources, grounded: lesson.grounded };
}

async function resolveSources(ids: string[]): Promise<{ materialId: string; materialName: string; heading: string }[]> {
  if (!ids.length) return [];
  const materials = await prisma.material.findMany({ where: { id: { in: ids } } });
  return materials.map((m) => ({ materialId: m.id, materialName: m.filename, heading: "" }));
}
