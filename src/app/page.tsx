import { redirect } from "next/navigation";
import { prisma, LOCAL_LEARNER_ID } from "@/lib/db";
import { Onboarding } from "@/components/onboarding/onboarding";

export const dynamic = "force-dynamic";

export default async function Page() {
  const goal = await prisma.goal.findFirst({
    where: { learnerId: LOCAL_LEARNER_ID, status: "active" },
  });
  if (goal) redirect("/home");
  return <Onboarding />;
}
