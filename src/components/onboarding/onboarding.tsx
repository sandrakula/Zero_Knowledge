"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Target, Brain, Sparkles, Loader2, Clock, Upload, MessageSquare } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

const EXAMPLES = [
  "I want to learn Python from zero.",
  "I know Python but want competitive programming.",
  "I want to become an ML engineer.",
  "I need to prepare for an algorithms interview.",
  "I want to master statistics.",
  "Хочу выучить Python с нуля.",
  "Хочу стать ML-инженером.",
];

export function Onboarding() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const [statement, setStatement] = useState("");
  const [level, setLevel] = useState("beginner");
  const [hours, setHours] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!statement.trim()) {
      setError(t("onboarding.error.empty"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement, level, hoursPerWeek: hours, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("common.error"));
      router.push(`/diagnostic?goalId=${data.goalId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
      {/* Left — copy */}
      <div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="chip border-accent/30 bg-accent/10 text-accent-soft">
            <Brain className="h-3.5 w-3.5" /> Adaptive learning intelligence
          </span>
          <h1 className="mt-5 text-3xl font-bold leading-[1.12] tracking-tight text-text sm:text-5xl">
            {t("onboarding.title.p1")} <span className="gradient-text">{t("onboarding.title.p2")}</span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-text-muted">{t("onboarding.subtitle")}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }} className="mt-8 space-y-3">
          {[
            { icon: Target, text: t("onboarding.f1") },
            { icon: Brain, text: t("onboarding.f2") },
            { icon: Sparkles, text: t("onboarding.f3") },
          ].map((f, i) => (
            <div key={i} className="flex items-center gap-3 text-sm text-text-muted">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                <f.icon className="h-4 w-4 text-accent-soft" />
              </span>
              {f.text}
            </div>
          ))}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/materials" className="btn-ghost">
            <Upload className="h-4 w-4" /> {t("onboarding.upload")}
          </Link>
          <Link href="/tutor" className="btn-ghost">
            <MessageSquare className="h-4 w-4" /> {t("nav.tutor")}
          </Link>
        </motion.div>
        <p className="mt-2 text-xs text-text-faint">{t("onboarding.uploadHint")}</p>
      </div>

      {/* Right — form */}
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, delay: 0.2 }} className="card p-6 shadow-card sm:p-7 lg:self-start">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Target className="h-4 w-4 text-accent-soft" /> {t("onboarding.goalLabel")}
        </div>

        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} placeholder={t("onboarding.goalPlaceholder")} className="input mt-4 resize-none" autoFocus />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setStatement(ex)} className="rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-[11px] text-text-faint transition-colors hover:border-accent/40 hover:text-text-muted">
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-6">
          <label className="eyebrow">{t("onboarding.level")}</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button key={l} onClick={() => setLevel(l)} className={cn(
                "rounded-xl border p-3 text-left transition-all",
                level === l ? "border-accent/60 bg-accent/10 shadow-glow" : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]",
              )}>
                <div className={cn("text-sm font-semibold", level === l ? "text-accent-soft" : "text-text")}>{t(`onboarding.level.${l}`)}</div>
                <div className="mt-0.5 text-[11px] text-text-faint">{t(`onboarding.level.${l}.hint`)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <label className="eyebrow flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> {t("onboarding.time")} — {hours}h
          </label>
          <input type="range" min={2} max={20} step={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-3 w-full accent-[#7c6cff]" />
          <div className="mt-1 flex justify-between text-[10px] text-text-faint"><span>2h</span><span>20h</span></div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4 text-sm text-rose">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button onClick={submit} disabled={loading} className="btn-primary mt-6 w-full">
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t("onboarding.building")}</>
          ) : (
            <>{t("onboarding.start")} <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </motion.div>
    </div>
  );
}
