import { NextResponse } from "next/server";
import { getSessionUserId } from "./auth";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Require an authenticated user; throws ApiError(401) otherwise. */
export async function requireUser(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError("Unauthorized", 401);
  return userId;
}

export async function handle(
  fn: () => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const data = await fn();
    return ok(data);
  } catch (e) {
    if (e instanceof ApiError) return fail(e.message, e.status);
    const msg = e instanceof Error ? e.message : String(e);
    const isProvider = msg.includes("AI") || msg.includes("provider") || msg.includes("timed out");
    return fail(msg, isProvider ? 502 : 500);
  }
}
