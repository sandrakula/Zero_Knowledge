import { importRoadmapFromOutline } from "@/lib/core/roadmap";
import { extractText } from "@/lib/core/materials";
import { handle, requireUser, ApiError } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Build the plan around a roadmap the learner supplied themselves — either as
 * pasted text (JSON `outline`) or as an uploaded document (multipart `file`,
 * .txt/.md/.pdf/.docx) that is text-extracted. The outline is authoritative:
 * its nodes are kept in order, existing sub-items are kept, and only nodes
 * without sub-items are expanded into substeps.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const contentType = req.headers.get("content-type") ?? "";

    let goalId = "";
    let outline = "";
    let lang: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      goalId = String(form.get("goalId") ?? "");
      lang = String(form.get("lang") ?? "");
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError("File is required", 400);
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > MAX_FILE_BYTES) throw new ApiError("File is too large (max 10 MB)", 400);
      outline = (await extractText(buffer, file.name)).trim();
    } else {
      const body = await req.json();
      goalId = String(body.goalId ?? "");
      outline = String(body.outline ?? "").trim();
      lang = body.lang ? String(body.lang) : undefined;
    }

    if (!outline) throw new ApiError("Roadmap outline is empty", 400);
    if (outline.length > 20000) throw new ApiError("Roadmap outline is too long", 400);

    return importRoadmapFromOutline({
      goalId,
      learnerId: userId,
      outline,
      language: normalizeLang(lang),
    });
  });
}
