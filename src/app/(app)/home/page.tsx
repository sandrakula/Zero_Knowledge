import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { HomeClient } from "@/components/home/home-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const goal = await prisma.goal.findFirst({ where: { learnerId: userId, status: "active" } });
  if (!goal) redirect("/tutor");
  // Learning only starts after the skill-level diagnostic, which also generates
  // the roadmap from the resulting evidence.
  const roadmap = await prisma.roadmap.findUnique({ where: { goalId: goal.id } });
  const diagnosed = await prisma.evidence.findFirst({ where: { learnerId: userId, kind: "diagnostic" } });
  if (!roadmap || !diagnosed) redirect(`/diagnostic?goalId=${goal.id}`);
  return <HomeClient />;
}
