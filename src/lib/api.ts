import { NextResponse } from "next/server";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function handle(
  fn: () => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const data = await fn();
    return ok(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish provider failures so the UI can surface them honestly.
    const isProvider = msg.includes("AI") || msg.includes("provider") || msg.includes("timed out");
    return fail(msg, isProvider ? 502 : 500);
  }
}
