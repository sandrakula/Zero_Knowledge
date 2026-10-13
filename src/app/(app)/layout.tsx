import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
