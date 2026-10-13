"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Circle, Loader2, Lock, Play, Route, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StateResponse, RoadmapItemView } from "@/lib/types";

const TYPE_META: Record<string, { label: string; color: string }> = {
  lesson: { label: "Lesson", color: "#7c6cff" },
  task: { label: "Practice", color: "#22d3ee" },
  project: { label: "Project", color: "#34d399" },
  assessment: { label: "Checkpoint", color: "#fbbf24" },
  retention: { label: "Review", color: "#a79bff" },
  transfer: { label: "Transfer", color: "#fb7185" },
};

export function RoadmapClient() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setState(d)))
      .catch((e) => setError(e.message));
  }, []);

  const phases = useMemo(() => {
    if (!state?.roadmap) return [];
    const map = new Map<string, RoadmapItemView[]>();
    for (const item of state.roadmap.items) {
      if (!map.has(item.phase)) map.set(item.phase, []);
      map.get(item.phase)!.push(item);
    }
    return [...map.entries()];
  }, [state]);

  if (error) return <p className="text-rose">{error}</p>;
  if (!state) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  const { goal, roadmap } = state;
  const done = roadmap?.progress.completed ?? 0;
  const total = roadmap?.progress.total ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2"><Route className="h-3.5 w-3.5" /> Personalized roadmap</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">{goal?.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{roadmap?.summary}</p>

        <div className="mt-5 max-w-md">
          <div className="mb-1.5 flex justify-between text-xs text-text-faint">
            <span>{done} of {total} complete</span>
            <span>{Math.round((done / total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent to-cyan"
              initial={{ width: 0 }}
              animate={{ width: `${(done / total) * 100}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-text-faint">This is a hypothesis — it adapts as the system learns about you.</p>
      </div>

      <div className="space-y-8">
        {phases.map(([phase, items], pi) => (
          <div key={phase}>
            <h2 className="flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-text-muted">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.05] text-xs text-accent-soft">{pi + 1}</span>
              {phase}
            </h2>
            <div className="mt-3 space-y-2.5">
              {items.map((item, i) => {
                const meta = TYPE_META[item.type] ?? TYPE_META.lesson;
                const locked = item.status === "locked";
                const doneItem = item.status === "completed";
                const clickable = item.status === "ready" || item.status === "active";
                const Inner = (
                  <div
                    className={cn(
                      "group relative flex items-start gap-4 rounded-2xl border p-4 transition-all",
                      locked
                        ? "border-white/[0.04] bg-white/[0.01] opacity-50"
                        : "border-white/[0.08] bg-ink-850/60 hover:border-white/[0.16] hover:bg-ink-800/70",
                      doneItem && "border-mint/25 bg-mint/[0.04]",
                      clickable && "border-accent/30",
                    )}
                  >
                    <div className="mt-0.5">
                      {doneItem ? (
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-mint/15 text-mint"><Check className="h-4 w-4" /></span>
                      ) : locked ? (
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.04] text-text-faint"><Lock className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span className="grid h-7 w-7 place-items-center rounded-full border border-accent/40 bg-accent/10 text-accent-soft"><Play className="h-3.5 w-3.5" /></span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-text">{item.title}</p>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: meta.color, background: `${meta.color}1a` }}>
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-text-faint">{item.estimatedMinutes}m</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.description}</p>
                    </div>
                    {clickable && <span className="text-xs font-medium text-accent-soft opacity-0 transition-opacity group-hover:opacity-100">Start →</span>}
                  </div>
                );
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.04 }}
                  >
                    {clickable ? <Link href={`/learn/${item.id}`}>{Inner}</Link> : Inner}
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {phases.length === 0 && (
        <div className="card p-10 text-center">
          <Target className="mx-auto h-6 w-6 text-accent-soft" />
          <p className="mt-3 text-sm text-text-muted">No roadmap yet.</p>
        </div>
      )}
    </div>
  );
}
