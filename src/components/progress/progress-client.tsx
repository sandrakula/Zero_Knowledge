"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Brain, Loader2, ShieldCheck } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import type { StateResponse } from "@/lib/types";

const SUPPORT_COLOR: Record<string, string> = {
  strong: "bg-mint",
  moderate: "bg-cyan",
  uncertain: "bg-amber",
  insufficient: "bg-rose",
};

export function ProgressClient() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setState(d)))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-rose">{error}</p>;
  if (!state) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  const { summary, misconceptions } = state;
  const skills = summary.skills;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2"><Brain className="h-3.5 w-3.5" /> Student Learning Twin</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">Your learning state — explainable</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Every value below is estimated from evidence, with explicit uncertainty. Nothing is a
          single global score, and nothing is invented.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={ShieldCheck} label="Evidence" value={summary.evidenceCount} color="text-mint" />
        <Stat icon={Activity} label="Attempts" value={summary.attemptCount} color="text-cyan" />
        <Stat icon={AlertTriangle} label="Misconceptions" value={misconceptions.length} color="text-amber" />
        <Stat icon={Brain} label="Skills modeled" value={skills.length} color="text-accent-soft" />
      </div>

      {/* Competency vectors */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-text">Competency vectors</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-faint">
                <th className="pb-2 pr-3 font-medium">Skill</th>
                <th className="pb-2 pr-3 font-medium">Mastery</th>
                <th className="pb-2 pr-3 font-medium">Support</th>
                <th className="pb-2 pr-3 font-medium">Depth</th>
                <th className="pb-2 pr-3 font-medium">Independence</th>
                <th className="pb-2 font-medium">Transfer</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.skillId} className="border-t border-white/[0.05]">
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-text">{s.name}</span>
                    <span className="ml-2 text-[11px] text-text-faint">{s.domain}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${s.mastery * 100}%` }} transition={{ duration: 0.6 }} />
                      </div>
                      <span className="text-xs text-text-muted">{Math.round(s.mastery * 100)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      <span className={cn("h-1.5 w-1.5 rounded-full", SUPPORT_COLOR[s.support] ?? "bg-text-faint")} />
                      {s.support}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-text-muted">{s.depth}</td>
                  <td className="py-2.5 pr-3">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-cyan" style={{ width: `${s.independence * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-2.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-mint" style={{ width: `${s.transfer * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              {skills.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-sm text-text-faint">No competencies modeled yet — start learning.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Misconceptions */}
      {misconceptions.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            <AlertTriangle className="h-4 w-4 text-amber" /> Misconception states
          </h2>
          <div className="mt-3 space-y-2">
            {misconceptions.map((m) => (
              <div key={m.code} className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">{m.name}</span>
                  <span className={cn("chip", m.status === "active" ? "border-amber/30 text-amber" : "border-cyan/30 text-cyan")}>{m.status}</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">{m.description}</p>
                {m.correction && <p className="mt-1.5 text-xs text-mint/90">↳ {m.correction}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Evidence timeline */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <ShieldCheck className="h-4 w-4 text-mint" /> Evidence lineage
        </h2>
        <div className="mt-4 space-y-3">
          {summary.recentEvidence.map((e) => (
            <div key={e.id} className="flex items-start gap-3 border-l border-white/[0.06] pl-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text/90">{e.summary}</p>
                <p className="mt-0.5 text-[11px] text-text-faint">
                  <span className="capitalize">{e.method}</span> · strength {Math.round(e.strength * 100)}% · {timeAgo(e.createdAt)}
                </p>
              </div>
              <span className="chip shrink-0">{e.kind}</span>
            </div>
          ))}
          {summary.recentEvidence.length === 0 && <p className="text-sm text-text-faint">No evidence yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, color }: { icon: typeof Brain; label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <Icon className={cn("h-4 w-4", color)} />
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-text-faint">{label}</p>
    </div>
  );
}
