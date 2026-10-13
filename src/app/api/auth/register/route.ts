import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTS } from "@/lib/auth";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim() || email.split("@")[0];

    if (!EMAIL_RE.test(email)) return fail("Please enter a valid email.", 400);
    if (password.length < 6) return fail("Password must be at least 6 characters.", 400);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return fail("An account with this email already exists.", 409);

    const user = await prisma.user.create({
      data: { email, name, passwordHash: hashPassword(password) },
    });

    // learner.id === user.id so all learning state is keyed by the user.
    await prisma.learner.create({ data: { id: user.id, userId: user.id, name } });

    const token = createSessionToken(user.id);
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, language: user.language } });
    res.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTS);
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Registration failed", 500);
  }
}
