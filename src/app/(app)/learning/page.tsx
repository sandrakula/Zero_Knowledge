import { Suspense } from "react";
import { LearningHub } from "@/components/learning/learning-hub";

export const dynamic = "force-dynamic";

export default function LearningPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-text-muted">Loading…</div>}>
      <LearningHub />
    </Suspense>
  );
}
