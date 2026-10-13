import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** The single local learner used for the MVP (no auth yet). */
export const LOCAL_LEARNER_ID = "local-learner";

export async function getOrCreateLearner() {
  const existing = await prisma.learner.findUnique({
    where: { id: LOCAL_LEARNER_ID },
  });
  if (existing) return existing;
  return prisma.learner.create({
    data: { id: LOCAL_LEARNER_ID, name: "Learner" },
  });
}
