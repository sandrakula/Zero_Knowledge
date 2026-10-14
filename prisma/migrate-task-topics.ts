import { prisma } from "@/lib/db";

/**
 * One-off repair for the "async topic got a functions task" mismatch.
 *
 * Tasks are now keyed by the roadmap topic they were written for (`Task.topic`).
 * Legacy tasks have an empty topic and were reused purely by skill, so a step
 * could show a task about a different subject. Clearing the link makes the step
 * regenerate a task specific to its own topic the next time it is opened.
 */
async function main() {
  const items = await prisma.roadmapItem.findMany({
    where: { taskId: { not: null } },
    select: { id: true, title: true, taskId: true },
  });

  let cleared = 0;
  for (const item of items) {
    const task = await prisma.task.findUnique({ where: { id: item.taskId! } });
    if (!task) continue;
    if (task.topic === item.title) continue; // already topic-correct
    await prisma.roadmapItem.update({ where: { id: item.id }, data: { taskId: null } });
    cleared++;
    console.log(`reset "${item.title}" (was task "${task.title}", topic "${task.topic || "—"}")`);
  }

  console.log(`Done. Reset ${cleared} of ${items.length} linked task(s); they regenerate on next open.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
