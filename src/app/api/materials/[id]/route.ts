import { rm } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { handle, fail, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await requireUser();
    const { id } = await ctx.params;
    const material = await prisma.material.findUnique({ where: { id } });
    if (!material || material.learnerId !== userId) return fail("Material not found", 404);

    await prisma.materialChunk.deleteMany({ where: { materialId: id } });
    await prisma.material.delete({ where: { id } });

    const filePath = join(process.cwd(), "storage", "materials", userId, material.storedName);
    await rm(filePath, { force: true }).catch(() => {});

    return { ok: true };
  });
}
