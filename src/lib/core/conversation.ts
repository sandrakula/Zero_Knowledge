import { prisma } from "@/lib/db";
import { safeJson } from "./json";

// ─────────────────────────────────────────────────────────────
// Persistent tutor conversations (§53–56).
//
// The conversation stores WHAT WAS SAID. The Student Learning Twin stores what
// the learner can DO (§63) — a claim in chat never changes competency state.
// Every API here derives learnerId from the authenticated session.
// ─────────────────────────────────────────────────────────────

export async function getOrCreateActiveConversation(learnerId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { learnerId, archivedAt: null },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { learnerId } });
}

export async function createConversation(learnerId: string, title?: string) {
  // Archive the previous active one so history stays browsable.
  await prisma.conversation.updateMany({
    where: { learnerId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  return prisma.conversation.create({ data: { learnerId, title: title ?? "" } });
}

export async function listConversations(learnerId: string, limit = 30) {
  const rows = await prisma.conversation.findMany({
    where: { learnerId },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
  });
  return rows.map((c) => ({
    id: c.id,
    title: c.title || "Untitled conversation",
    summary: c.summary,
    messageCount: c.messageCount,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
  }));
}

/** Ownership-checked message history. */
export async function getConversationMessages(learnerId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.learnerId !== learnerId) return null;

  const rows = await prisma.message.findMany({
    where: { conversationId, learnerId },
    orderBy: { createdAt: "asc" },
  });

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      summary: conversation.summary,
      messageCount: conversation.messageCount,
    },
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      intent: m.intent,
      actionType: m.actionType,
      skillIds: safeJson<string[]>(m.skillIds, []),
      taskId: m.taskId,
      roadmapItemId: m.roadmapItemId,
      meta: safeJson<Record<string, unknown>>(m.meta, {}),
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function appendMessage(input: {
  learnerId: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string | null;
  actionType?: string | null;
  skillIds?: string[];
  taskId?: string | null;
  roadmapItemId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const conversation = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (!conversation || conversation.learnerId !== input.learnerId) {
    throw new Error("Conversation not found");
  }

  const message = await prisma.message.create({
    data: {
      learnerId: input.learnerId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      intent: input.intent ?? null,
      actionType: input.actionType ?? null,
      skillIds: JSON.stringify(input.skillIds ?? []),
      taskId: input.taskId ?? null,
      roadmapItemId: input.roadmapItemId ?? null,
      meta: JSON.stringify(input.meta ?? {}),
    },
  });

  // First user message becomes the conversation title.
  const title =
    conversation.title || (input.role === "user" ? input.content.trim().slice(0, 70) : "");

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      title,
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
    },
  });

  return message;
}

/** Recent history for context construction — bounded, never the whole log (§58). */
export async function recentConversationContext(learnerId: string, conversationId: string, take = 8) {
  const rows = await prisma.message.findMany({
    where: { conversationId, learnerId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.reverse().map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content.slice(0, 400)}`);
}

/**
 * Keyword retrieval over older messages of the learner (§60). A reliable
 * skill/keyword match is enough at this stage — no vector database.
 */
export async function searchConversationHistory(learnerId: string, query: string, limit = 5) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const rows = await prisma.message.findMany({
    where: { learnerId },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  const scored = rows
    .map((m) => {
      const hay = m.content.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      return { m, score: terms.length ? hits / terms.length : 0 };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score || +b.m.createdAt - +a.m.createdAt)
    .slice(0, limit);

  return scored.map(({ m }) => ({
    role: m.role,
    content: m.content.slice(0, 500),
    createdAt: m.createdAt.toISOString(),
  }));
}

function tokenize(s: string): string[] {
  return Array.from(
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 3),
    ),
  );
}
