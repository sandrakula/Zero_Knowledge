"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Target, Brain, Sparkles, Loader2, Clock } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const LEVELS = [
  { id: "beginner", label: "Beginner", hint: "I'm starting fresh" },
  { id: "intermediate", label: "Intermediate", hint: "I know the basics" },
  { id: "advanced", label: "Advanced", hint: "I want to go deep" },
];

const EXAMPLES = [
  "I want to learn Python from zero.",
  "I know Python but want competitive programming.",
  "I want to become an ML engineer.",
  "I need to prepare for an algorithms interview.",
  "I want to master statistics.",
];

export function Onboarding() {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [level, setLevel] = useState("beginner");
  const [hours, setHours] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!statement.trim()) {
      setError("Describe what you want to learn first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement, level, hoursPerWeek: hours }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.push(`/diagnostic?goalId=${data.goalId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <span className="text-xs text-text-faint">Learning Intelligence Platform</span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
        {/* Left — copy */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="chip border-accent/30 bg-accent/10 text-accent-soft">
              <Brain className="h-3.5 w-3.5" /> Adaptive learning intelligence
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-text sm:text-6xl">
              Learn with a system that{" "}
              <span className="gradient-text">understands you.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-text-muted">
              Not a course, not a chatbot. A living model of what you know that
              builds your path, picks your next step from evidence, and makes you
              more independent as you grow.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-10 space-y-3"
          >
            {[
              { icon: Target, text: "Goal → diagnosis → a roadmap built for you" },
              { icon: Brain, text: "A learning twin that tracks mastery, depth & independence" },
              { icon: Sparkles, text: "Evidence-driven next steps — not a fixed sequence" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-text-muted">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                  <f.icon className="h-4 w-4 text-accent-soft" />
                </span>
                {f.text}
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right — form */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="card p-6 shadow-card sm:p-8"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Target className="h-4 w-4 text-accent-soft" /> What do you want to learn?
          </div>

          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={3}
            placeholder="e.g. I want to become an ML engineer…"
            className="input mt-4 resize-none"
            autoFocus
          />

          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setStatement(ex)}
                className="rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-[11px] text-text-faint transition-colors hover:border-accent/40 hover:text-text-muted"
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <label className="eyebrow">Your level</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    level === l.id
                      ? "border-accent/60 bg-accent/10 shadow-glow"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]",
                  )}
                >
                  <div className={cn("text-sm font-semibold", level === l.id ? "text-accent-soft" : "text-text")}>
                    {l.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-faint">{l.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <label className="eyebrow flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Time per week — {hours}h
            </label>
            <input
              type="range"
              min={2}
              max={20}
              step={1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-3 w-full accent-[#7c6cff]"
            />
            <div className="mt-1 flex justify-between text-[10px] text-text-faint">
              <span>2h</span>
              <span>20h</span>
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 text-sm text-rose"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button onClick={submit} disabled={loading} className="btn-primary mt-6 w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Building your learning path…
              </>
            ) : (
              <>
                Start learning <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </motion.div>
      </main>
    </div>
  );
}
