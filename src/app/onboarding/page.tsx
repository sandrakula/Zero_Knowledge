import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { Onboarding } from "@/components/onboarding/onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const goal = await prisma.goal.findFirst({ where: { learnerId: userId, status: "active" } });
  if (goal) redirect("/home");
  return <Onboarding />;
}
