import { createConversation, getOrCreateActiveConversation, listConversations } from "@/lib/core/conversation";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Conversation history is scoped to the authenticated learner (§64). */
export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const conversations = await listConversations(userId);
    const active = await getOrCreateActiveConversation(userId);
    return { conversations, activeId: active.id };
  });
}

export async function POST() {
  return handle(async () => {
    const userId = await requireUser();
    const created = await createConversation(userId);
    return { conversation: { id: created.id, title: created.title, createdAt: created.createdAt.toISOString() } };
  });
}
