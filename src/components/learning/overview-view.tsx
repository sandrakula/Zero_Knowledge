"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Layers, Sparkles, Target, TrendingUp, Upload } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { StatusBadge, StatusDot } from "@/components/learning/status";
import { cn, timeAgo } from "@/lib/utils";
import type { StateResponse } from "@/lib/types";

/**
 * Overview of the unified Learning hub (§5, §6).
 *
 * Roadmap completion, demonstrated competence, evidence volume and retention
 * are presented as SEPARATE metrics — 8 of 10 roadmap items is not "80% of the
 * subject" and the UI says so explicitly.
 */
export function OverviewView({ state }: { state: StateResponse }) {
  const { t } = useI18n();

  const { goal, roadmap, summary, misconceptions, nextBest, materialCount, targetSkills, domainStats } = state;
  const counts = summary.counts;
  // Distinct target skills represented on the roadmap — NOT a sum over items
  // (a skill referenced by several steps must be counted once).
  const roadmapTargetSkills = roadmap
    ? new Set(roadmap.items.flatMap((i) => i.skillIds)).size
    : 0;
  const assessed = summary.skills.filter((s) => s.status !== "not_assessed");
  const dueReview = summary.skills.filter((s) => s.retentionDue);
  const attention = summary.skills.filter((s) => s.status === "needs_attention");

  // All goal target skills grouped by domain ("where"), including the ones with
  // no evidence yet — the deterministic read model, never a fabricated score.
  const skillsByDomain = domainStats
    .map((d) => ({ domain: d, skills: targetSkills.filter((s) => s.domain === d.id) }))
    .filter((g) => g.skills.length > 0);

  // Bottleneck: an unresolved misconception first, then the weakest skill.
  const worstMisconception = misconceptions[0] ?? null;
  const weakest = [...assessed].sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Recommended next action */}
      {nextBest.next && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-ink-800/70 to-accent/[0.07] p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-[80px]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> {t("hub.nextAction")}</p>
              <p className="mt-2 font-semibold text-text">{nextBest.next.title}</p>
              <p className="text-xs text-text-faint">{nextBest.next.description}</p>
            </div>
            <Link href={`/learn/${nextBest.next.itemId}`} className="btn-primary">
              {t("home.continue")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.section>
      )}

      {/* Separate metric families (§6) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-text">{t("hub.title")}</h2>
          <p className="mt-1 text-xs text-text-faint">{goal?.title}</p>
          <div className="mt-4 space-y-2.5">
            <Row icon={CheckCircle2} color="text-mint" label={t("hub.demonstrated")} value={`${counts.demonstrated}`} />
            <Row icon={TrendingUp} color="text-amber" label={t("hub.developing")} value={`${counts.developing}`} />
            <Row icon={AlertTriangle} color="text-rose" label={t("hub.attention")} value={`${counts.needsAttention}`} />
            <Row icon={Clock} color="text-text-faint" label={t("hub.notAssessed")} value={`${counts.notAssessed}`} />
          </div>
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="text-xs text-text-muted">
              <span className="font-semibold text-text">{counts.demonstrated}</span> {t("hub.ofTargetSkills")}
              <span className="text-text-faint"> ({assessed.length}/{summary.skills.length})</span>
            </p>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-text">{t("hub.roadmapProgress")}</h2>
          <div className="mt-4">
            <p className="text-3xl font-bold text-text">
              {roadmap ? `${roadmap.progress.completed}` : "0"}
              <span className="text-base font-normal text-text-faint"> / {roadmap?.progress.total ?? 0}</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-cyan"
                initial={{ width: 0 }}
                animate={{ width: `${roadmap ? (roadmap.progress.completed / Math.max(1, roadmap.progress.total)) * 100 : 0}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{t("hub.roadmapNote")}</p>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3 text-xs">
            <div className="flex justify-between"><span className="text-text-faint">{t("hub.evidenceVolume")}</span><span className="text-text">{summary.evidenceCount}</span></div>
            <div className="flex justify-between"><span className="text-text-faint">{t("hub.tab.materials")}</span><span className="text-text">{materialCount}</span></div>
            <div className="flex justify-between"><span className="text-text-faint">{t("hub.targetSkills")}</span><span className="text-text">{roadmapTargetSkills}</span></div>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-text">{t("hub.bottleneck")}</h2>
          <div className="mt-3 space-y-3">
            {worstMisconception ? (
              <div className="rounded-xl border border-rose/25 bg-rose/[0.05] p-3">
                <p className="text-sm font-medium text-rose">{worstMisconception.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{worstMisconception.description}</p>
                <p className="mt-1.5 text-[11px] text-mint/90">↳ {worstMisconception.correction}</p>
              </div>
            ) : null}

            {weakest ? (
              <div className="flex items-start gap-2.5">
                <StatusDot status={weakest.status} className="mt-1" />
                <div>
                  <p className="text-sm text-text">{weakest.name}</p>
                  <p className="text-[11px] text-text-faint">
                    {weakest.mastery === null
                      ? t("metric.notAssessed")
                      : `${t("progress.mastery")} ${Math.round(weakest.mastery * 100)}%`}
                    {" · "}
                    {weakest.evidenceCount} {t("metric.observations")}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-faint">{t("hub.notAssessed")}</p>
            )}

            {attention.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
                {attention.slice(0, 4).map((s) => (
                  <StatusBadge key={s.skillId} status={s.status} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Layers className="h-4 w-4 text-accent-soft" />
          {t("skills.title")}
          <span className="chip ml-auto">{targetSkills.length}</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-text-faint">{t("skills.hint")}</p>

        <div className="mt-4 space-y-5">
          {skillsByDomain.map(({ domain, skills }) => (
            <div key={domain.id}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                <span className="text-sm" style={{ color: domain.color }}>{domain.icon}</span>
                {domain.name}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {skills.map((s) => (
                  <div
                    key={s.skillId}
                    title={t(`status.${s.status}`)}
                    className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                  >
                    <StatusDot status={s.status} />
                    <span className="truncate text-sm text-text">{s.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-text-faint">
                      {s.mastery === null ? t("metric.notAssessed") : `${Math.round(s.mastery * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {targetSkills.length === 0 && <p className="text-sm text-text-faint">{t("skills.empty")}</p>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><Clock className="h-4 w-4 text-amber" /> {t("hub.needsReview")}</h2>
          {dueReview.length === 0 ? (
            <p className="mt-3 text-xs text-text-faint">{t("metric.notAssessed")}</p>
          ) : (
            <div className="mt-3 space-y-2">
              {dueReview.slice(0, 5).map((s) => (
                <div key={s.skillId} className="flex items-center gap-2.5">
                  <StatusDot status={s.status} />
                  <span className="text-sm text-text">{s.name}</span>
                  <span className="ml-auto text-[11px] text-text-faint">
                    {s.retention === null ? "—" : `${Math.round(s.retention * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-text">{t("home.recentEvidence")}</h2>
          <div className="mt-3 space-y-2.5">
            {summary.recentEvidence.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-start gap-2.5">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", e.method === "deterministic" ? "bg-mint" : "bg-cyan")} />
                <div className="min-w-0">
                  <p className="truncate text-xs text-text/90">{e.summary}</p>
                  <p className="text-[10px] text-text-faint">{e.method} · {timeAgo(e.createdAt)}</p>
                </div>
              </div>
            ))}
            {summary.recentEvidence.length === 0 && (
              <p className="text-xs text-text-faint">{t("home.noEvidence")}</p>
            )}
          </div>
        </section>
      </div>

      <Link href="/materials" className="card card-hover flex items-center gap-4 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
          <Upload className="h-5 w-5 text-accent-soft" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text">{materialCount > 0 ? `${materialCount} ${t("home.materialsUploaded")}` : t("home.uploadMaterials")}</p>
          <p className="text-xs text-text-faint">{t("materials.subtitle")}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-text-faint" />
      </Link>

      <p className="flex items-center justify-center gap-2 text-center text-[11px] text-text-faint">
        <Target className="h-3.5 w-3.5" /> {t("home.footer")}
      </p>
    </div>
  );
}

function Row({ icon: Icon, color, label, value }: { icon: typeof Target; color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <Icon className={cn("h-3.5 w-3.5", color)} />
      <span className="text-text-faint">{label}</span>
      <span className="ml-auto font-medium text-text">{value}</span>
    </div>
  );
}
