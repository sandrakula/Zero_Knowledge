"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronRight, Loader2, Lock, Play, Plus, RefreshCw, Route, Sparkles, Target, Upload } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { StatusDot, StatusLegend } from "@/components/learning/status";
import { cn } from "@/lib/utils";
import type { StateResponse, RoadmapItemView, TutorBranchView } from "@/lib/types";

// Topics that are always auto-broken into substeps (single-purpose checks stay whole).
const ELIGIBLE = new Set(["lesson", "concept", "practice", "assessment", "example", "project", "transfer"]);

const TYPE_COLOR: Record<string, string> = {
  lesson: "#7c6cff",
  concept: "#7c6cff",
  example: "#a79bff",
  practice: "#22d3ee",
  task: "#22d3ee",
  project: "#34d399",
  assessment: "#fbbf24",
  diagnostic: "#fbbf24",
  retention: "#a79bff",
  transfer: "#fb7185",
};

export function RoadmapClient() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [outline, setOutline] = useState("");
  const [importing, setImporting] = useState(false);
  const [autoBreaking, setAutoBreaking] = useState(false);
  const autoBrokeRef = useRef(false);
  const expandedOnceRef = useRef(false);
  const ensuredRef = useRef(false);

  const load = () =>
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setState(d)))
      .catch((e) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const savedLang = (): "en" | "ru" => {
    if (typeof window === "undefined") return lang;
    const s = window.localStorage.getItem("zk_lang");
    return s === "ru" || s === "en" ? s : lang;
  };

  const expandAllWithChildren = (data: StateResponse) => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const i of data.roadmap?.items ?? []) if (i.children.length) next[i.id] = true;
      return next;
    });
  };

  // Auto-breakdown: every eligible topic gets substeps without a manual click.
  useEffect(() => {
    if (!state?.roadmap) return;
    const eligible = state.roadmap.items.filter((i) => !i.children.length && ELIGIBLE.has(i.type));

    if (eligible.length === 0) {
      if (!expandedOnceRef.current) {
        expandedOnceRef.current = true;
        expandAllWithChildren(state);
      }
      return;
    }
    if (autoBrokeRef.current) return;
    autoBrokeRef.current = true;
    setAutoBreaking(true);
    (async () => {
      const pool = [...eligible];
      const workers = Array.from({ length: 3 }, async () => {
        while (pool.length) {
          const item = pool.shift()!;
          try {
            await fetch("/api/roadmap/substeps", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nodeId: item.id, lang: savedLang() }),
            });
          } catch {
            /* retried on next mount */
          }
        }
      });
      await Promise.all(workers);
      const res = await fetch("/api/state").then((r) => r.json());
      if (!res.error) {
        setState(res);
        expandedOnceRef.current = true;
        expandAllWithChildren(res);
      }
      setAutoBreaking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Safety net: if the plan has not been built yet (e.g. the learner left the
  // diagnostic before it finished preparing), build it now.
  useEffect(() => {
    if (!state || state.roadmap || !state.goal || ensuredRef.current) return;
    ensuredRef.current = true;
    (async () => {
      try {
        await fetch("/api/roadmap/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId: state.goal!.id, lang: savedLang() }),
        });
      } catch {
        /* surfaced by the following reload */
      }
      void load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Reflect tutor-made roadmap edits immediately (§ — tutor changes the plan in place).
  useEffect(() => {
    const reload = () => load();
    window.addEventListener("zk:roadmap-changed", reload);
    return () => window.removeEventListener("zk:roadmap-changed", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phases = useMemo(() => {
    if (!state?.roadmap) return [];
    const map = new Map<string, RoadmapItemView[]>();
    for (const item of state.roadmap.items) {
      const key = item.phase.split(" · ")[0];
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [state]);

  async function rebuild() {
    if (!state?.goal) return;
    setRebuilding(true);
    setError("");
    try {
      const res = await fetch("/api/roadmap/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: state.goal.id, lang }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("common.error"));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setRebuilding(false);
    }
  }

  async function importOutline() {
    if (!state?.goal || !outline.trim()) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/roadmap/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: state.goal.id, outline, lang: savedLang() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? t("common.error"));
      setImportOpen(false);
      setOutline("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setImporting(false);
    }
  }

  async function breakDown(nodeId: string) {
    setBusy(nodeId);
    try {
      const res = await fetch("/api/roadmap/substeps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, lang }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("common.error"));
      setExpanded((e) => ({ ...e, [nodeId]: true }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-rose">{error}</p>;  if (!state) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  const { goal, roadmap } = state;
  const done = roadmap?.progress.completed ?? 0;
  const total = roadmap?.progress.total ?? 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow flex items-center gap-2"><Route className="h-3.5 w-3.5" /> {t("roadmap.title")}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">{goal?.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{roadmap?.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {autoBreaking && (
            <span className="chip border-cyan/30 text-cyan">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("roadmap.autoBreaking")}
            </span>
          )}
          <button onClick={() => setImportOpen((o) => !o)} className="btn-ghost px-3 py-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" />
            {t("roadmap.import")}
          </button>
          <button onClick={rebuild} disabled={rebuilding} className="btn-ghost px-3 py-1.5 text-xs">
            {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {rebuilding ? t("roadmap.rebuilding") : t("roadmap.rebuild")}
          </button>
          <StatusLegend />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {importOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                <Upload className="h-4 w-4 text-accent-soft" /> {t("roadmap.import")}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-faint">{t("roadmap.import.hint")}</p>
              <textarea
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                rows={10}
                placeholder={t("roadmap.import.placeholder")}
                className="mt-3 w-full resize-y rounded-xl border border-white/[0.08] bg-ink-950/60 p-3 font-mono text-xs leading-6 text-text outline-none placeholder:text-text-faint focus:border-accent/50"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button onClick={() => setImportOpen(false)} className="btn-ghost px-3 py-1.5 text-xs">{t("common.cancel")}</button>
                <button onClick={importOutline} disabled={importing || !outline.trim()} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50">
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {importing ? t("roadmap.import.building") : t("roadmap.import.generate")}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-md">
        <div className="mb-1.5 flex justify-between text-xs text-text-faint">
          <span>{done} / {total}</span>
          <span>{Math.round((done / total) * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-cyan" initial={{ width: 0 }} animate={{ width: `${(done / total) * 100}%` }} transition={{ duration: 1, ease: "easeOut" }} />
        </div>
        <p className="mt-2 text-xs text-text-faint">{t("hub.roadmapNote")}</p>
      </div>

      <div className="space-y-8">
        {phases.map(([phase, items], pi) => (
          <div key={phase}>
            <h2 className="flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-text-muted">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.05] text-xs text-accent-soft">{pi + 1}</span>
              {phase}
            </h2>
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <NodeRow
                  key={item.id}
                  node={item}
                  expanded={Boolean(expanded[item.id])}
                  onToggle={() => setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))}
                  onBreakDown={() => breakDown(item.id)}
                  busy={busy === item.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {phases.length === 0 && (
        <div className="card p-10 text-center">
          <Target className="mx-auto h-6 w-6 text-accent-soft" />
          <p className="mt-3 text-sm text-text-muted">{t("roadmap.none")}</p>
        </div>
      )}
      </div>

      <aside className="h-fit space-y-4 lg:sticky lg:top-8">
        <TutorPracticePanel branches={roadmap?.tutorBranches ?? []} />
      </aside>
    </div>
  );
}

/** Collapsible window listing every tutor-generated practice branch, kept out of the main path. */
function TutorPracticePanel({ branches }: { branches: TutorBranchView[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const total = branches.reduce((n, b) => n + b.nodes.length, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan/25 bg-cyan/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-cyan/[0.05]"
        aria-expanded={open}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-cyan" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-cyan">{t("roadmap.tutorBranch")}</span>
        {total > 0 && (
          <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs font-semibold text-cyan">{total}</span>
        )}
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-cyan" /> : <ChevronRight className="h-4 w-4 shrink-0 text-cyan" />}
      </button>

      {open && (
        <div className="border-t border-cyan/15 px-4 pb-4 pt-3">
          {total === 0 ? (
            <p className="text-xs leading-relaxed text-text-faint">{t("roadmap.tutorBranchEmpty")}</p>
          ) : (
            <div className="space-y-4">
              {branches.map((b) => (
                <div key={b.branchKey}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    {t("roadmap.forTopic")} · {b.parentTitle}
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {b.nodes.map((n) => (
                      <Link key={n.id} href={`/learn/${n.id}`} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-ink-900/50 px-3 py-2 text-xs text-text transition-colors hover:border-cyan/40">
                        <Play className="h-3 w-3 shrink-0 text-cyan" />
                        <span className="min-w-0 flex-1 truncate">{n.title}</span>
                        <StatusDot status={n.skillStatus} />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NodeRow({
  node,
  expanded,
  onToggle,
  onBreakDown,
  busy,
  child = false,
}: {
  node: RoadmapItemView;
  expanded: boolean;
  onToggle: () => void;
  onBreakDown: () => void;
  busy: boolean;
  child?: boolean;
}) {
  const { t } = useI18n();
  const color = TYPE_COLOR[node.type] ?? TYPE_COLOR.lesson;
  const locked = node.status === "locked";
  const doneItem = node.status === "completed";
  // All topics are always open (§ "все темы открыты всегда") — any node may be
  // opened, including legacy "locked" rows and completed steps.
  const clickable = node.status === "ready" || node.status === "active" || node.status === "completed" || node.status === "locked";
  const hasChildren = node.children.length > 0;

  const body = (
    <div className={cn(
      "group relative flex items-start gap-3 rounded-2xl border p-4 transition-all",
      child ? "ml-4 sm:ml-8" : "",
      locked ? "border-white/[0.04] bg-white/[0.01] opacity-60" : "border-white/[0.08] bg-ink-850/60 hover:border-white/[0.16]",
      doneItem && "border-mint/25 bg-mint/[0.04]",
      node.status === "active" && "border-accent/40",
    )}>
      <div className="mt-0.5">
        <StatusDot status={node.skillStatus} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {doneItem && <Check className="h-3.5 w-3.5 text-mint" />}
          {locked && <Lock className="h-3 w-3 text-text-faint" />}
          {!locked && !doneItem && <Play className="h-3 w-3 text-accent-soft" />}
          <p className={cn("font-medium", child ? "text-sm text-text/90" : "text-text")}>{node.title}</p>
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color, background: `${color}1a` }}>
            {t(`type.${node.type}`) === `type.${node.type}` ? node.type : t(`type.${node.type}`)}
          </span>
          {node.optional && <span className="chip">{t("roadmap.optional")}</span>}
          {node.origin === "tutor" && <span className="chip border-cyan/30 text-cyan"><Sparkles className="h-3 w-3" /> {t("roadmap.tutorBranch")}</span>}
          <span className="text-[11px] text-text-faint">{node.estimatedMinutes}m</span>
          <span className="text-[11px] text-text-faint">· {t(`status.${node.skillStatus}`)}</span>
        </div>
        {node.objective && <p className="mt-1 text-xs text-text-muted">{node.objective}</p>}
        {node.description && <p className="mt-1 text-sm leading-relaxed text-text-muted">{node.description}</p>}
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
      {clickable ? <Link href={`/learn/${node.id}`}>{body}</Link> : body}

      {!child && hasChildren && (
        <button onClick={onToggle} className="ml-4 mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-text-faint transition-colors hover:text-accent-soft sm:ml-8">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? t("roadmap.collapse") : t("roadmap.expand")}
        </button>
      )}

      {!child && !hasChildren && (
        <button onClick={onBreakDown} disabled={busy} className="ml-4 mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-text-faint transition-colors hover:text-accent-soft sm:ml-8">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {t("roadmap.breakDown")}
        </button>
      )}

      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-2">
              {node.children.map((ch) => (
                <NodeRow key={ch.id} node={ch} expanded={false} onToggle={() => {}} onBreakDown={() => {}} busy={false} child />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
