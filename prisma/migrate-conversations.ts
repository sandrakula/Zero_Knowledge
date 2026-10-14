import { prisma } from "@/lib/db";

/**
 * One-off repair: attach legacy messages that predate persistent conversations
 * (conversationId = null) to their owner's own conversation.
 *
 * Every message already carries a learnerId, so this only restores per-user
 * scoping and visibility — it never moves a message to another learner.
 */
async function main() {
  const orphanGroups = await prisma.message.groupBy({
    by: ["learnerId"],
    where: { conversationId: null },
    _count: { _all: true },
  });

  if (orphanGroups.length === 0) {
    console.log("No orphan messages — nothing to do.");
    return;
  }

  let moved = 0;
  for (const g of orphanGroups) {
    const learnerId = g.learnerId;

    // A message can only belong to a conversation owned by the same learner.
    let conversation = await prisma.conversation.findFirst({
      where: { learnerId, archivedAt: null },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { learnerId } });
    }

    const rows = await prisma.message.findMany({
      where: { learnerId, conversationId: null },
      orderBy: { createdAt: "asc" },
    });

    await prisma.message.updateMany({
      where: { learnerId, conversationId: null },
      data: { conversationId: conversation.id },
    });

    const firstUser = rows.find((m) => m.role === "user");
    const lastAt = rows.length ? rows[rows.length - 1].createdAt : conversation.lastMessageAt;
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        title: conversation.title || firstUser?.content.trim().slice(0, 70) || "",
        messageCount: { increment: rows.length },
        lastMessageAt: lastAt,
      },
    });

    moved += rows.length;
    console.log(`learner ${learnerId}: attached ${rows.length} message(s) to conversation ${conversation.id}`);
  }

  console.log(`Done. Reattached ${moved} message(s) across ${orphanGroups.length} learner(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
