import { getConversationMessages } from "@/lib/core/conversation";
import { handle, requireUser, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await requireUser();
    const { id } = await ctx.params;
    const data = await getConversationMessages(userId, id);
    if (!data) return fail("Conversation not found", 404);
    return data;
  });
}
