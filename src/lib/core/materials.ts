import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateObject } from "@/lib/llm";
import { getPrompt } from "@/lib/prompts/registry";
import { langInstruction } from "@/lib/lang";
import { SKILLS, getSkill } from "./knowledge-graph";
import { skillCatalogForPrompt } from "./goal-compiler";

// ─────────────────────────────────────────────────────────────
// Material ingestion (§44–46). Analyze uploads → extract concepts/skills →
// chunk for retrieval → map to competencies → drive coverage & gap detection.
// ─────────────────────────────────────────────────────────────

/** Extract plain text from an uploaded file by extension. */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (ext === "txt" || ext === "md" || ext === "text" || ext === "csv" || ext === "json") {
    return buffer.toString("utf8");
  }

  if (ext === "pdf") {
    const pdfParse = await import("pdf-parse").then((m) => (m as any).default ?? m);
    const data = await pdfParse(buffer);
    return typeof data?.text === "string" ? data.text : "";
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }

  throw new Error(`Unsupported file type ".${ext}". Use .txt, .md, .pdf or .docx.`);
}

/** Heuristic language detection (Cyrillic ratio). */
export function detectLanguage(text: string): "en" | "ru" {
  const sample = text.slice(0, 4000);
  const letters = sample.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (!letters) return "en";
  const cyrillic = (sample.match(/[А-Яа-яЁё]/g) ?? []).length;
  return cyrillic / letters.length > 0.35 ? "ru" : "en";
}

export type Chunk = { heading: string; text: string };

/** Split text into retrievable chunks (~1200 chars, broken at paragraph boundaries). */
export function chunkText(text: string, maxChars = 1400): Chunk[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buf = "";
  let heading = "";

  const push = () => {
    if (buf.trim().length > 20) {
      chunks.push({ heading, text: buf.trim() });
    }
    buf = "";
    heading = "";
  };

  for (const p of paragraphs) {
    const isHeading = p.length < 90 && !/[.!?]$/.test(p) && p.split(/\s+/).length <= 12;
    if (isHeading) {
      push();
      heading = p;
      continue;
    }
    if (buf.length + p.length > maxChars && buf) push();
    buf += (buf ? "\n\n" : "") + p;
  }
  push();
  return chunks;
}

const AnalysisSchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()),
  skillIds: z.array(z.string()),
});

/** LLM analysis: map a material to the knowledge graph. */
export async function analyzeMaterial(input: {
  text: string;
  language?: string;
}): Promise<{ summary: string; topics: string[]; skillIds: string[] }> {
  const prompt = getPrompt("material-analysis")!;
  const catalog = skillCatalogForPrompt();
  const sample = input.text.slice(0, 18000);

  const result = await generateObject(
    AnalysisSchema,
    prompt.capability,
    prompt.system,
    [
      `Skill catalog (id, name, domain, prerequisites):\n${catalog}`,
      `${langInstruction(input.language)}`,
      `MATERIAL EXCERPT (first ~18k chars):\n${sample}`,
    ].join("\n\n"),
    { maxTokens: 3000 },
  );

  const valid = new Set(SKILLS.map((s) => s.id));
  return {
    summary: result.summary,
    topics: result.topics,
    skillIds: result.skillIds.filter((id) => valid.has(id)),
  };
}

/** Keyword-overlap retrieval of the most relevant chunks (no embeddings needed). */
export async function retrieveChunks(input: {
  learnerId: string;
  skillIds: string[];
  limit?: number;
}): Promise<{ materialId: string; materialName: string; heading: string; text: string; score: number }[]> {
  const queryTerms = tokenize(
    input.skillIds
      .map((id) => `${getSkill(id)?.name ?? ""} ${getSkill(id)?.description ?? ""}`)
      .join(" "),
  );
  if (queryTerms.size === 0) return [];

  const chunks = await prisma.materialChunk.findMany({
    where: { learnerId: input.learnerId },
    include: { material: true },
  });

  const scored = chunks
    .map((c) => {
      const terms = tokenize(c.text + " " + c.heading);
      const overlap = [...queryTerms].filter((t) => terms.has(t)).length;
      const score = queryTerms.size ? overlap / queryTerms.size : 0;
      return { c, score };
    })
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 4);

  return scored.map(({ c, score }) => ({
    materialId: c.materialId,
    materialName: c.material.filename,
    heading: c.heading,
    text: c.text,
    score,
  }));
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Which materials cover a given set of skills (for provenance display). */
export async function materialSourcesForSkills(learnerId: string, skillIds: string[]): Promise<{ id: string; filename: string; skillIds: string[] }[]> {
  const materials = await prisma.material.findMany({ where: { learnerId, status: "ready" } });
  const target = new Set(skillIds);
  return materials
    .map((m) => ({ id: m.id, filename: m.filename, skillIds: JSON.parse(m.skillIds) as string[] }))
    .filter((m) => m.skillIds.some((s) => target.has(s)));
}
