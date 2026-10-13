import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const userId = await getSessionUserId();
    if (!userId) return { user: null };
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return {
      user: user ? { id: user.id, email: user.email, name: user.name, language: user.language, role: user.role } : null,
    };
  });
}
