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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return fail("No file provided.", 400);

    const filename = file.name || "material";
    const ext = "." + (filename.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.includes(ext)) return fail(`Unsupported file type "${ext}". Use .txt, .md, .pdf or .docx.`, 400);
    if (file.size > MAX_SIZE) return fail("File exceeds the 100 MB limit.", 400);

    // Admin may upload global (shared) materials for all students.
    const scope = user?.role === "admin" && formData.get("scope") === "global" ? "global" : "user";

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";
    try {
      text = await extractText(buffer, filename);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not extract readable text from this file.", 422);
    }
    if (text.trim().length < 40) return fail("Could not extract readable text from this file.", 422);

    const language = detectLanguage(text);

    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = join(process.cwd(), "storage", "materials", userId);
    await mkdir(dir, { recursive: true });
    const storedName = `${id}${ext}`;
    await writeFile(join(dir, storedName), buffer);

    const chunks = chunkText(text);
    const material = await prisma.material.create({
      data: {
        learnerId: userId,
        filename,
        storedName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        scope,
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
        payload: JSON.stringify({ materialId: material.id, filename, chunks: chunks.length, topics, scope }),
      },
    });

    return { id: material.id, filename, size: file.size, language, scope, chunkCount: chunks.length, summary, topics, skillIds };
  });
}

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = user?.role === "admin";

    // Admin sees everything; students see their own + global (shared) materials.
    const materials = isAdmin
      ? await prisma.material.findMany({ orderBy: { createdAt: "desc" } })
      : await prisma.material.findMany({
          where: { OR: [{ learnerId: userId }, { scope: "global" }] },
          orderBy: { createdAt: "desc" },
        });

    return {
      isAdmin,
      materials: materials.map((m) => ({
        id: m.id,
        filename: m.filename,
        size: m.size,
        mimeType: m.mimeType,
        language: m.language,
        scope: m.scope,
        status: m.status,
        chunkCount: m.chunkCount,
        summary: m.summary,
        skillIds: JSON.parse(m.skillIds) as string[],
        isOwner: m.learnerId === userId,
        // Materials are always original uploads (never generated content);
        // provenance distinguishes whose original it is (§8).
        provenance: m.scope === "global" ? "teacher-provided" : "user-provided",
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
