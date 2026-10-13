"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Network, X } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { MetricValue, StatusBadge, StatusDot, StatusLegend } from "@/components/learning/status";
import { cn, timeAgo } from "@/lib/utils";
import type { SkillStatus } from "@/lib/types";

type Skill = {
  id: string;
  name: string;
  domain: string;
  description: string;
  difficulty: number;
  category: string;
  prerequisites: string[];
  status: SkillStatus;
  mastery: number | null;
  masteryInterval: { lower: number; upper: number } | null;
  sufficiency: string;
  evidenceCount: number;
  independentSuccesses: number;
  taskFamilies: number;
  depth: string | null;
  independence: number | null;
  application: number | null;
  transfer: number | null;
  retention: number | null;
  supportDependence: number | null;
  lastAssessmentAt: string | null;
};

type Domain = { id: string; name: string; icon: string; color: string };

/** Knowledge map (§7): every metric shows "Not assessed" until evidence exists. */
export function MapView() {
  const { t } = useI18n();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeDomain, setActiveDomain] = useState("programming");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        setDomains(d.domains ?? []);
        setSkills(d.skills ?? []);
        setActiveDomain(d.domains?.[0]?.id ?? "programming");
      })
      .finally(() => setLoading(false));
  }, []);

  const domainSkills = useMemo(
    () => skills.filter((s) => s.domain === activeDomain).sort((a, b) => a.difficulty - b.difficulty),
    [skills, activeDomain],
  );

  const selectedFull = useMemo(() => skills.find((s) => s.id === selected?.id) ?? selected, [skills, selected]);

  if (loading) return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-text">{t("map.title")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("map.hint")}</p>
        </div>
        <StatusLegend className="max-w-md" />
      </div>

      <div className="flex flex-wrap gap-2">
        {domains.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDomain(d.id)}
            className={cn(
              "rounded-xl border px-3.5 py-2 text-sm font-medium transition-all",
              activeDomain === d.id ? "border-white/[0.16] bg-white/[0.06] text-text" : "border-white/[0.07] text-text-muted hover:text-text",
            )}
          >
            <span style={{ color: d.color }}>{d.icon}</span> {d.name}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="card p-4">
          <div className="space-y-2">
            {domainSkills.map((s, i) => (
              <motion.button
                key={s.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                onClick={() => setSelected(s)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                  selected?.id === s.id ? "border-accent/50 bg-accent/[0.07]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]",
                )}
              >
                <StatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text">{s.name}</span>
                    <span className="hidden text-[10px] uppercase tracking-wide text-text-faint sm:inline">{s.category}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-faint">
                    {t(`status.${s.status}`)}
                    {s.evidenceCount > 0 ? ` · ${s.evidenceCount} ${t("metric.observations")}` : ""}
                  </p>
                </div>
                <span className="text-xs font-medium text-text-muted">
                  {s.mastery === null ? t("metric.notAssessed") : `${Math.round(s.mastery * 100)}%`}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <AnimatePresence mode="wait">
            {selectedFull ? (
              <motion.div key={selectedFull.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-faint">{selectedFull.domain}</p>
                    <h3 className="mt-1 text-lg font-bold text-text">{selectedFull.name}</h3>
                  </div>
                  <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-text-faint hover:bg-white/[0.05] hover:text-text">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <StatusBadge status={selectedFull.status} />
                  <span className="text-[11px] text-text-faint">{t(`metric.sufficiency.${selectedFull.sufficiency}`)}</span>
                </div>

                {selectedFull.description && <p className="mt-3 text-xs leading-relaxed text-text-muted">{selectedFull.description}</p>}

                <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
                  <div className="flex items-baseline justify-between gap-3 text-xs" title={t("metric.def.mastery")}>
                    <span className="text-text-faint">{t("progress.mastery")}</span>
                    <span className="font-medium text-text">
                      {selectedFull.mastery === null
                        ? t("metric.notAssessed")
                        : `${Math.round(selectedFull.mastery * 100)}%`}
                      {selectedFull.masteryInterval && (
                        <span className="ml-1 text-[10px] text-text-faint">
                          [{Math.round(selectedFull.masteryInterval.lower * 100)}–{Math.round(selectedFull.masteryInterval.upper * 100)}%]
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-xs" title={t("metric.def.mastery")}>
                    <span className="text-text-faint">{t("progress.depth")}</span>
                    <span className={cn("font-medium", selectedFull.depth ? "text-text" : "text-text-faint")}>
                      {selectedFull.depth ?? t("metric.notAssessed")}
                    </span>
                  </div>
                  <MetricValue label={t("metric.noHints")} value={selectedFull.independence} hint={t("metric.def.independence")} />
                  <MetricValue label={t("progress.application")} value={selectedFull.application} hint={t("metric.def.application")} />
                  <MetricValue label={t("metric.newTasks")} value={selectedFull.transfer} hint={t("metric.def.transfer")} />
                  <MetricValue label={t("progress.retention")} value={selectedFull.retention} hint={t("metric.def.retention")} />
                </div>

                <div className="mt-4 border-t border-white/[0.06] pt-3">
                  <p className="eyebrow">{t("metric.evidence")}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Stat label={t("metric.observations")} value={selectedFull.evidenceCount} />
                    <Stat label={t("metric.independentSuccesses")} value={selectedFull.independentSuccesses} />
                    <Stat label={t("metric.families")} value={selectedFull.taskFamilies} />
                  </div>
                  {selectedFull.lastAssessmentAt && (
                    <p className="mt-2 text-[10px] text-text-faint">
                      {t("home.recentEvidence")}: {timeAgo(selectedFull.lastAssessmentAt)}
                    </p>
                  )}
                </div>

                {selectedFull.prerequisites.length > 0 && (
                  <div className="mt-4">
                    <p className="eyebrow">{t("map.prerequisites")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedFull.prerequisites.map((p) => (
                        <button
                          key={p}
                          onClick={() => setSelected(skills.find((x) => x.id === p) ?? null)}
                          className="chip hover:border-accent/40"
                        >
                          {skills.find((x) => x.id === p)?.name ?? p} <ArrowRight className="h-3 w-3 text-text-faint" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-4 rounded-lg border border-white/[0.06] bg-ink-900/50 p-3 text-[10px] leading-relaxed text-text-faint">
                  {t("map.note")}
                </p>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-5 text-center">
                <Network className="mx-auto h-6 w-6 text-text-faint" />
                <p className="mt-3 text-sm text-text-faint">{t("map.select")}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-ink-900/40 p-2">
      <p className="text-base font-semibold text-text">{value}</p>
      <p className="text-[9px] uppercase leading-tight tracking-wide text-text-faint">{label}</p>
    </div>
  );
}
