import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTS } from "@/lib/auth";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail("Invalid email or password.", 401);
    }

    const token = createSessionToken(user.id);
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, language: user.language } });
    res.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTS);
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Login failed", 500);
  }
}
