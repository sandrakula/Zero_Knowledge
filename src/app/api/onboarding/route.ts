import { handle, fail, requireUser } from "@/lib/api";
import { createGoalFromStatement } from "@/lib/core/goal";
import { normalizeLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const userId = await requireUser();
    const body = await req.json();
    const statement = String(body.statement ?? "").trim();
    const level = String(body.level ?? "beginner");
    const hoursPerWeek = Math.max(1, Math.min(40, Number(body.hoursPerWeek ?? 5)));
    const lang = normalizeLang(body.lang);

    if (!statement) return fail("Please describe your learning goal.", 400);

    const result = await createGoalFromStatement({
      learnerId: userId,
      statement,
      level,
      hoursPerWeek,
      language: lang,
      confirmed: Boolean(body.confirmed),
    });

    if (!result.ok) {
      return {
        needsConfirmation: true,
        notice: result.notice,
        reframedStatement: result.reframedStatement,
      };
    }

    // The roadmap is generated AFTER the skill-level diagnostic, once we have
    // evidence about the learner — not from the goal alone.
    return { goalId: result.goalId, spec: { ...result.spec, targetSkills: result.spec.targetSkills.slice(0, 8) } };
  });
}
