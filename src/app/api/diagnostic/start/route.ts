import { startDiagnostic } from "@/lib/core/diagnostic";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const { goalId } = await req.json();
    return startDiagnostic(goalId);
  });
}
