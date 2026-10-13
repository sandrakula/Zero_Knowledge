import { generateSubsteps } from "@/lib/core/roadmap";
import { handle, requireUser } from "@/lib/api";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Break a roadmap node into editable substeps (also used on first expand). */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const nodeId = String(body.nodeId ?? "");
    const count = body.count ? Number(body.count) : undefined;
    const created = await generateSubsteps({
      learnerId: userId,
      nodeId,
      language: normalizeLang(body.lang),
      count,
    });
    return { created };
  });
}
