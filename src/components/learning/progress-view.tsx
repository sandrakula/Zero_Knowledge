"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { MetricValue, StatusBadge, StatusDot } from "@/components/learning/status";
import { cn, timeAgo } from "@/lib/utils";
import type { StateResponse } from "@/lib/types";

/** Progress as a history of competence (§9) — not a single percentage. */
export function ProgressView() {
  const { t } = useI18n();
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setState(d)))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-rose">{error}</p>;
  if (!state) return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  const { summary, misconceptions } = state;
  const assessed = summary.skills.filter((s) => s.status !== "not_assessed");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-text">{t("progress.subtitle")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">{t("progress.note")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={ShieldCheck} label={t("progress.evidence")} value={summary.evidenceCount} color="text-mint" />
        <Stat icon={Activity} label={t("progress.attempts")} value={summary.attemptCount} color="text-cyan" />
        <Stat icon={AlertTriangle} label={t("progress.misconceptions")} value={misconceptions.length} color="text-amber" />
        <Stat icon={Activity} label={t("hub.demonstrated")} value={summary.counts.demonstrated} color="text-accent-soft" />
      </div>

      <section className="card p-5">
        <h3 className="text-sm font-semibold text-text">{t("progress.vectors")}</h3>
        <p className="mt-1 text-[11px] text-text-faint">{t("hub.roadmapNote")}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-faint">
                <th className="pb-2 pr-3 font-medium">{t("progress.skill")}</th>
                <th className="pb-2 pr-3 font-medium">{t("status.legend")}</th>
                <th className="pb-2 pr-3 font-medium">{t("progress.mastery")}</th>
                <th className="pb-2 pr-3 font-medium">{t("metric.evidence")}</th>
                <th className="pb-2 pr-3 font-medium">{t("metric.noHints")}</th>
                <th className="pb-2 pr-3 font-medium">{t("progress.application")}</th>
                <th className="pb-2 pr-3 font-medium">{t("metric.newTasks")}</th>
                <th className="pb-2 font-medium">{t("progress.retention")}</th>
              </tr>
            </thead>
            <tbody>
              {assessed.map((s) => (
                <tr key={s.skillId} className="border-t border-white/[0.05]">
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <StatusDot status={s.status} />
                      <span className="font-medium text-text">{s.name}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-3"><StatusBadge status={s.status} /></td>
                  <td className="py-2.5 pr-3 text-xs text-text">
                    {s.mastery === null ? t("metric.notAssessed") : `${Math.round(s.mastery * 100)}%`}
                    {s.masteryInterval && (
                      <span className="ml-1 text-[10px] text-text-faint">
                        [{Math.round(s.masteryInterval.lower * 100)}–{Math.round(s.masteryInterval.upper * 100)}]
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[11px] text-text-muted">
                    {s.evidenceCount} {t("metric.observations")}
                    <span className="block text-text-faint">
                      {s.independentSuccesses} {t("metric.independentSuccesses")} · {s.taskFamilies} {t("metric.families")}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs">{fmt(s.independence)}</td>
                  <td className="py-2.5 pr-3 text-xs">{fmt(s.application)}</td>
                  <td className="py-2.5 pr-3 text-xs">{fmt(s.transfer)}</td>
                  <td className="py-2.5 text-xs">{fmt(s.retention)}</td>
                </tr>
              ))}
              {assessed.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-sm text-text-faint">{t("progress.noSkills")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {misconceptions.length > 0 && (
        <section className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            <AlertTriangle className="h-4 w-4 text-amber" /> {t("progress.misconceptionStates")}
          </h3>
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

      <section className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <ShieldCheck className="h-4 w-4 text-mint" /> {t("progress.lineage")}
        </h3>
        <p className="mt-1 text-[11px] text-text-faint">{t("metric.def.evidence")}</p>
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
          {summary.recentEvidence.length === 0 && <p className="text-sm text-text-faint">{t("progress.noEvidence")}</p>}
        </div>
      </section>
    </div>
  );
}

function fmt(v: number | null) {
  return v === null ? <span className="text-text-faint">—</span> : <span className="text-text-muted">{Math.round(v * 100)}%</span>;
}

function Stat({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <Icon className={cn("h-4 w-4", color)} />
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-text-faint">{label}</p>
    </div>
  );
}
