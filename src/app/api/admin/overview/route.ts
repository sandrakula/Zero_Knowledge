import { prisma } from "@/lib/db";
import { handle, requireUser, ApiError } from "@/lib/api";
import { getAdminOverview } from "@/lib/core/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const userId = await requireUser();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "admin") throw new ApiError("Forbidden", 403);
    return getAdminOverview();
  });
}
