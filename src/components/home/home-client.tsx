"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  AlertTriangle,
  Brain,
  Gauge,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Reveal } from "@/components/ui/reveal";
import { useI18n } from "@/components/i18n";
import { cn, timeAgo } from "@/lib/utils";
import type { StateResponse } from "@/lib/types";

export function HomeClient() {
  const { t } = useI18n();
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setState(d)))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="card p-10 text-center"><p className="text-rose">{error}</p></div>;
  if (!state) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  const { goal, roadmap, summary, misconceptions, nextBest, domainStats, materialCount } = state;

  const seenSkills = summary.skills;
  const avgMastery = seenSkills.length ? seenSkills.reduce((a, s) => a + s.mastery, 0) / seenSkills.length : 0;
  const avgIndependence = seenSkills.length ? seenSkills.reduce((a, s) => a + s.independence, 0) / seenSkills.length : 0;
  const avgTransfer = seenSkills.length ? seenSkills.reduce((a, s) => a + s.transfer, 0) / seenSkills.length : 0;

  const readyItem = roadmap?.items.find((i) => i.status === "ready" || i.status === "active");
  const nextItemId = nextBest.next?.itemId?.includes(":") ? readyItem?.id : nextBest.next?.itemId;
  const ctaItemId = nextItemId ?? readyItem?.id;

  return (
    <div className="space-y-8">
      <Reveal>
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/80 via-ink-850 to-accent/[0.06] p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-cyan/10 blur-[90px]" />

          <div className="relative">
            <p className="eyebrow flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-accent-soft" /> {goal?.title ?? "Learning"}
            </p>
            <h1 className="mt-3 max-w-2xl text-2xl font-bold leading-tight tracking-tight text-text sm:text-4xl">
              {nextBest.next ? t("home.next") : t("home.roadmapReady")}
            </h1>

            <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-lg">
                {nextBest.next ? (
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Target className="h-4 w-4 text-accent-soft" />
                    <span className="font-medium text-accent-soft">{nextBest.next.title}</span>
                    <span className="chip">{t(`type.${nextBest.next.type}`) ?? nextBest.next.type}</span>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-text-muted">{t("home.roadmapReady")}</p>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  {ctaItemId && (
                    <Link href={`/learn/${ctaItemId}`} className="btn-primary">
                      <Play className="h-4 w-4" /> {t("home.continue")}
                    </Link>
                  )}
                  <Link href="/roadmap" className="btn-ghost">
                    {t("home.viewRoadmap")} <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-4 sm:gap-x-8">
                <RingStat value={avgMastery} color="#7c6cff" caption={t("progress.mastery")} />
                <RingStat value={avgIndependence} color="#22d3ee" caption={t("progress.independence")} />
                <RingStat value={avgTransfer} color="#34d399" caption={t("progress.transfer")} />
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Materials CTA */}
      <Reveal delay={0.03}>
        <Link href="/materials" className="card card-hover flex items-center gap-4 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <Upload className="h-5 w-5 text-accent-soft" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-text">
              {materialCount > 0 ? `${materialCount} ${t("home.materialsUploaded")}` : t("home.uploadMaterials")}
            </p>
            <p className="text-xs text-text-faint">{t("materials.subtitle")}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-faint" />
        </Link>
      </Reveal>

      {misconceptions.length > 0 && (
        <Reveal delay={0.05}>
          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <AlertTriangle className="h-4 w-4 text-amber" />
              {t("home.misconceptions")}
              <span className="ml-1 rounded-full bg-amber/15 px-2 py-0.5 text-xs text-amber">{misconceptions.length}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {misconceptions.slice(0, 4).map((m) => (
                <div key={m.code} className="flex items-start gap-3 rounded-xl border border-amber/20 bg-amber/[0.04] p-3">
                  <div>
                    <p className="text-sm font-medium text-text">{m.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-faint">{m.description}</p>
                  </div>
                  <span className="ml-auto shrink-0 rounded-md bg-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber">{Math.round(m.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Reveal delay={0.1} className="lg:col-span-2">
          <section className="card h-full p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Layers className="h-4 w-4 text-accent-soft" /> {t("home.domains")}
            </div>
            <div className="mt-4 space-y-3.5">
              {domainStats.map((d) => {
                const pct = d.total ? d.mastered / d.total : 0;
                return (
                  <div key={d.id}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-text-muted">
                        <span className="text-sm" style={{ color: d.color }}>{d.icon}</span> {d.name}
                      </span>
                      <span className="text-text-faint">{d.mastered}/{d.total} {t("home.mastered")}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div className="h-full rounded-full" style={{ background: d.color }} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </Reveal>

        <Reveal delay={0.15}>
          <section className="card h-full p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <ShieldCheck className="h-4 w-4 text-mint" /> {t("home.recentEvidence")}
              </div>
              <span className="chip">{summary.evidenceCount} {t("home.total")}</span>
            </div>
            <div className="mt-4 space-y-3">
              {summary.recentEvidence.slice(0, 6).map((e) => (
                <div key={e.id} className="flex items-start gap-3">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", e.method === "deterministic" ? "bg-mint" : "bg-cyan")} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text/90">{e.summary}</p>
                    <p className="text-[11px] text-text-faint">{e.method} · {timeAgo(e.createdAt)}</p>
                  </div>
                </div>
              ))}
              {summary.recentEvidence.length === 0 && <p className="text-sm text-text-faint">{t("home.noEvidence")}</p>}
            </div>
          </section>
        </Reveal>
      </div>

      {nextBest.queue.length > 0 && (
        <Reveal delay={0.2}>
          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Gauge className="h-4 w-4 text-cyan" /> {t("home.considering")}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {nextBest.queue.map((q, i) => (
                <span key={i} className="chip">{q.title}<span className="text-text-faint">· {q.reason}</span></span>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      <p className="flex items-center justify-center gap-2 text-center text-[11px] text-text-faint">
        <Brain className="h-3.5 w-3.5" /> {t("home.footer")}
      </p>
    </div>
  );
}

/** Ring + caption underneath (captions stay outside so long words never overlap). */
function RingStat({ value, color, caption }: { value: number; color: string; caption: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <ProgressRing value={value} size={68} color={color} />
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-text-faint">{caption}</span>
    </div>
  );
}
