import { Suspense } from "react";
import { DiagnosticFlow } from "@/components/diagnostic/diagnostic-flow";

export default function DiagnosticPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-text-muted">Loading…</div>}>
      <DiagnosticFlow />
    </Suspense>
  );
}
