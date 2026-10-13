import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Legacy seed learner id (no longer used for authenticated users). */
export const LOCAL_LEARNER_ID = "local-learner";

/** Ensure a Learner row exists for an authenticated user (learner.id === user.id). */
export async function ensureLearner(userId: string, name = "Learner") {
  const existing = await prisma.learner.findUnique({ where: { id: userId } });
  if (existing) return existing;
  return prisma.learner.create({ data: { id: userId, userId, name } });
}
