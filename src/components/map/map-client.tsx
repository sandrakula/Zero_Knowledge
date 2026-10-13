"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Network, X } from "lucide-react";
import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/utils";

type Skill = {
  id: string;
  name: string;
  domain: string;
  difficulty: number;
  category: string;
  prerequisites: string[];
  mastery: number | null;
  uncertainty: number;
  depth: string | null;
  independence: number | null;
  transfer: number | null;
  retention: number | null;
  attempts: number;
  seen: boolean;
};

type Domain = { id: string; name: string; icon: string; color: string };

function stateColor(s: Skill): string {
  if (!s.seen || s.mastery === null) return "rgba(255,255,255,0.16)";
  if (s.mastery < 0.35) return "#fb7185";
  if (s.mastery < 0.6) return "#fbbf24";
  return "#34d399";
}

export function MapClient() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeDomain, setActiveDomain] = useState<string>("programming");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        setDomains(d.domains);
        setSkills(d.skills);
        setActiveDomain(d.domains[0]?.id ?? "programming");
      })
      .finally(() => setLoading(false));
  }, []);

  const domainSkills = useMemo(() => {
    // Topological-ish: sort by difficulty ascending (prerequisites first).
    return skills
      .filter((s) => s.domain === activeDomain)
      .sort((a, b) => a.difficulty - b.difficulty);
  }, [skills, activeDomain]);

  const selectedFull = useMemo(
    () => skills.find((s) => s.id === selected?.id) ?? selected,
    [skills, selected],
  );

  if (loading)
    return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow flex items-center gap-2"><Network className="h-3.5 w-3.5" /> Knowledge map</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">What you know — and what blocks you</h1>
        <p className="mt-2 text-sm text-text-muted">Color shows mastery. Tap any node to see the full competency vector and its prerequisites.</p>
      </div>

      {/* Domain tabs */}
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

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Nodes */}
        <div className="card p-4">
          <div className="space-y-2">
            {domainSkills.map((s, i) => {
              const color = stateColor(s);
              const prereqNames = s.prerequisites.map((p) => skills.find((x) => x.id === p)?.name ?? p);
              return (
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
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{s.name}</span>
                      <span className="hidden text-[10px] uppercase tracking-wide text-text-faint sm:inline">{s.category}</span>
                    </div>
                    {prereqNames.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-text-faint">requires: {prereqNames.join(", ")}</p>
                    )}
                  </div>
                  {s.seen && s.mastery !== null ? (
                    <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full" style={{ width: `${s.mastery * 100}%`, background: color }} />
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-faint">unexplored</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <AnimatePresence mode="wait">
            {selectedFull ? (
              <motion.div key={selectedFull.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-faint">{selectedFull.domain}</p>
                    <h2 className="mt-1 text-lg font-bold text-text">{selectedFull.name}</h2>
                  </div>
                  <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-text-faint hover:bg-white/[0.05] hover:text-text">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <ProgressRing value={selectedFull.mastery ?? 0} size={64} label={selectedFull.seen ? `${Math.round((selectedFull.mastery ?? 0) * 100)}` : "—"} color={stateColor(selectedFull)} />
                  <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <Metric label="depth" value={selectedFull.depth ?? "—"} />
                    <Metric label="independence" value={selectedFull.independence === null ? "—" : `${Math.round(selectedFull.independence * 100)}%`} />
                    <Metric label="transfer" value={selectedFull.transfer === null ? "—" : `${Math.round(selectedFull.transfer * 100)}%`} />
                    <Metric label="attempts" value={String(selectedFull.attempts)} />
                  </div>
                </div>

                {selectedFull.prerequisites.length > 0 && (
                  <div className="mt-4">
                    <p className="eyebrow">Prerequisites</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedFull.prerequisites.map((p) => (
                        <span key={p} className="chip">
                          {skills.find((x) => x.id === p)?.name ?? p}
                          <ArrowRight className="h-3 w-3 text-text-faint" />
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-4 rounded-lg border border-white/[0.06] bg-ink-900/50 p-3 text-[11px] leading-relaxed text-text-faint">
                  Mastery is estimated from evidence, with explicit uncertainty — a green node doesn&apos;t mean you&apos;ve merely seen the concept; it means you&apos;ve demonstrated it.
                </p>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-5 text-center">
                <Network className="mx-auto h-6 w-6 text-text-faint" />
                <p className="mt-3 text-sm text-text-faint">Select a skill to inspect its competency state.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text-faint">{label}</p>
      <p className="font-medium text-text">{value}</p>
    </div>
  );
}
