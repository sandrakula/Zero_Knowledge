import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { handle, fail, requireUser } from "@/lib/api";
import { extractText, chunkText, detectLanguage, analyzeMaterial } from "@/lib/core/materials";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED = [".txt", ".md", ".text", ".csv", ".json", ".pdf", ".docx"];

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return fail("No file provided.", 400);

    const filename = file.name || "material";
    const ext = "." + (filename.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return fail(`Unsupported file type "${ext}". Use .txt, .md, .pdf or .docx.`, 400);
    }
    if (file.size > MAX_SIZE) return fail("File exceeds the 100 MB limit.", 400);

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1) Extract text (best-effort).
    let text = "";
    let extractOk = true;
    let extractError = "";
    try {
      text = await extractText(buffer, filename);
    } catch (e) {
      extractOk = false;
      extractError = e instanceof Error ? e.message : "extraction failed";
    }

    if (!extractOk || text.trim().length < 40) {
      return fail(extractError || "Could not extract readable text from this file.", 422);
    }

    const language = detectLanguage(text);

    // 2) Persist the file to object storage.
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = join(process.cwd(), "storage", "materials", userId);
    await mkdir(dir, { recursive: true });
    const storedName = `${id}${ext}`;
    await writeFile(join(dir, storedName), buffer);

    // 3) Chunk + store.
    const chunks = chunkText(text);
    const material = await prisma.material.create({
      data: {
        learnerId: userId,
        filename,
        storedName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        language,
        status: "processing",
        chunkCount: chunks.length,
      },
    });

    if (chunks.length) {
      await prisma.materialChunk.createMany({
        data: chunks.map((c, i) => ({
          materialId: material.id,
          learnerId: userId,
          index: i,
          heading: c.heading,
          text: c.text,
        })),
      });
    }

    // 4) Analyze → map to knowledge-graph skills (async-safe, done inline for MVP).
    let summary = "";
    let topics: string[] = [];
    let skillIds: string[] = [];
    try {
      const analysis = await analyzeMaterial({ text, language: normalizeLang(language) });
      summary = analysis.summary;
      topics = analysis.topics;
      skillIds = analysis.skillIds;
    } catch {
      summary = "Auto-analysis unavailable; material stored and searchable.";
    }

    await prisma.material.update({
      where: { id: material.id },
      data: { summary, skillIds: JSON.stringify(skillIds), status: "ready" },
    });

    await prisma.learningEvent.create({
      data: {
        learnerId: userId,
        type: "material_uploaded",
        payload: JSON.stringify({ materialId: material.id, filename, chunks: chunks.length, topics }),
      },
    });

    return {
      id: material.id,
      filename,
      size: file.size,
      language,
      chunkCount: chunks.length,
      summary,
      topics,
      skillIds,
    };
  });
}

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const materials = await prisma.material.findMany({
      where: { learnerId: userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      materials: materials.map((m) => ({
        id: m.id,
        filename: m.filename,
        size: m.size,
        language: m.language,
        status: m.status,
        chunkCount: m.chunkCount,
        summary: m.summary,
        skillIds: JSON.parse(m.skillIds) as string[],
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
