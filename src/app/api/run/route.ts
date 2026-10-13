import { runPython } from "@/lib/core/code-runner";
import { handle, fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const code = String(body.code ?? "");
    const input = String(body.input ?? "");
    if (!code.trim()) return fail("Nothing to run yet.", 400);
    const result = await runPython(code, input);
    return {
      ok: result.ok,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  });
}
