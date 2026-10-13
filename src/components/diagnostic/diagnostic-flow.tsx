"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Check, X, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

type Question = {
  id: string;
  skillId: string;
  skillName: string;
  difficulty: string;
  question: string;
  code: string;
  options: string[];
};

const CONFIDENCE = [
  { label: "Not sure", value: 0.33 },
  { label: "Fairly sure", value: 0.66 },
  { label: "Very sure", value: 1 },
];

export function DiagnosticFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const goalId = params.get("goalId") ?? "";

  const [ladder, setLadder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState<Question | null>(null);
  const [confidence, setConfidence] = useState(0.66);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);

  const start = useCallback(async () => {
    try {
      const res = await fetch("/api/diagnostic/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start diagnostic");
      setLadder(data.ladder);
      setIndex(data.index);
      setQuestion(data.question);
      setProgress(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    if (goalId) start();
  }, [goalId, start]);

  async function answer(i: number) {
    if (selected !== null || !question) return;
    setSelected(i);
    try {
      const res = await fetch("/api/diagnostic/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          ladder,
          index,
          questionId: question.id,
          skillId: question.skillId,
          selectedIndex: i,
          confidence,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to grade answer");
      setFeedback({ correct: data.correct, text: data.feedback });
      setProgress(Math.round(((index + 1) / Math.max(ladder.length, 1)) * 100));
      if (data.done) {
        setDone(true);
      } else {
        // stash the next question for "Continue"
        setQuestion(data.question);
        setIndex(data.index);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to grade answer");
    }
  }

  function next() {
    setSelected(null);
    setFeedback(null);
    setConfidence(0.66);
  }

  return (
    <div className="relative min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Logo />
        <span className="flex items-center gap-2 text-xs text-text-faint">
          <Brain className="h-3.5 w-3.5" /> Initial diagnosis
        </span>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {/* Progress */}
        <div className="mb-8 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent to-cyan"
            animate={{ width: `${Math.min(100, Math.max(4, progress))}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>

        <AnimatePresence mode="wait">
          {loading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="card p-10 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent-soft" />
              <p className="mt-4 text-sm text-text-muted">Calibrating your starting point…</p>
            </motion.div>
          )}

          {error && (
            <motion.div key="error" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-8 text-center">
              <p className="text-rose">{error}</p>
              <button onClick={start} className="btn-primary mt-4">Retry</button>
            </motion.div>
          )}

          {done && (
            <motion.div key="done" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-10 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-mint/10">
                <Sparkles className="h-8 w-8 text-mint" />
              </div>
              <h2 className="mt-6 text-2xl font-bold text-text">Your learning twin is initialized</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">
                I&apos;ve used your answers to seed a model of what you know — with honest
                uncertainty. Your personalized roadmap is ready.
              </p>
              <button onClick={() => router.push("/home")} className="btn-primary mt-8">
                Open your dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          )}

          {!loading && !done && !error && question && (
            <motion.div
              key={question.id + (feedback ? "-fb" : "")}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="card p-6 sm:p-8"
            >
              <div className="flex items-center justify-between">
                <span className="chip">{question.skillName}</span>
                <span className="text-xs capitalize text-text-faint">{question.difficulty}</span>
              </div>

              <h2 className="mt-5 text-xl font-semibold leading-snug text-text">{question.question}</h2>
              {question.code && (
                <pre className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-950 p-4 font-mono text-sm leading-6">
                  {question.code}
                </pre>
              )}

              <div className="mt-6 space-y-2.5">
                {question.options.map((opt, i) => {
                  const isSelected = selected === i;
                  const isCorrect = feedback && i === selected && feedback.correct;
                  const isWrong = feedback && i === selected && !feedback.correct;
                  return (
                    <button
                      key={i}
                      onClick={() => answer(i)}
                      disabled={selected !== null}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all",
                        selected === null && "border-white/[0.08] bg-white/[0.02] hover:border-accent/50 hover:bg-accent/[0.06]",
                        isCorrect && "border-mint/60 bg-mint/10",
                        isWrong && "border-rose/60 bg-rose/10",
                        selected !== null && !isCorrect && !isWrong && "border-white/[0.05] opacity-60",
                      )}
                    >
                      <span className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-sm font-semibold",
                        isCorrect ? "border-mint/60 text-mint" : isWrong ? "border-rose/60 text-rose" : "border-white/[0.1] text-text-muted",
                      )}>
                        {isCorrect ? <Check className="h-4 w-4" /> : isWrong ? <X className="h-4 w-4" /> : String.fromCharCode(65 + i)}
                      </span>
                      <span className="text-sm leading-relaxed text-text/90">{opt}</span>
                    </button>
                  );
                })}
              </div>

              {/* Confidence calibration (§100) */}
              <div className="mt-6 rounded-xl border border-white/[0.06] bg-ink-900/50 p-4">
                <p className="text-xs font-medium text-text-faint">How confident are you?</p>
                <div className="mt-2 flex gap-2">
                  {CONFIDENCE.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setConfidence(c.value)}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                        confidence === c.value
                          ? "border-accent/50 bg-accent/10 text-accent-soft"
                          : "border-white/[0.08] text-text-faint hover:text-text-muted",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <AnimatePresence>
                {feedback && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className={cn(
                      "mt-5 rounded-xl border p-4",
                      feedback.correct ? "border-mint/30 bg-mint/[0.06]" : "border-amber/30 bg-amber/[0.06]",
                    )}>
                      <p className={cn("text-sm font-semibold", feedback.correct ? "text-mint" : "text-amber")}>
                        {feedback.correct ? "Correct" : "Not quite"}
                      </p>
                      <div className="mt-2 text-sm leading-relaxed text-text-muted">
                        <Markdown>{feedback.text}</Markdown>
                      </div>
                    </div>
                    <button onClick={next} className="btn-primary mt-4">
                      {done ? "Finish" : "Continue"} <ArrowRight className="h-4 w-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
