import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { DiagnosticFlow } from "@/components/diagnostic/diagnostic-flow";

export const dynamic = "force-dynamic";

export default async function DiagnosticPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-text-muted">Loading…</div>}>
      <DiagnosticFlow />
    </Suspense>
  );
}
