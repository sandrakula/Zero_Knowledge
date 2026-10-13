import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { HomeClient } from "@/components/home/home-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const goal = await prisma.goal.findFirst({ where: { learnerId: userId, status: "active" } });
  if (!goal) redirect("/onboarding");
  return <HomeClient />;
}
