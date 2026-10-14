"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  Lightbulb,
  Loader2,
  Play,
  RotateCcw,
  RefreshCw,
  Send,
  Sparkles,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";
import type { AttemptResponse, LearnResponse } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const CONFIDENCE = [
  { label: "diag.conf.notSure", value: 0.33 },
  { label: "diag.conf.fairly", value: 0.66 },
  { label: "diag.conf.very", value: 1 },
];

export function LearnClient({ itemId }: { itemId: string }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<LearnResponse | null>(null);
  const [code, setCode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [runOutput, setRunOutput] = useState<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [confidence, setConfidence] = useState(0.66);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [error, setError] = useState("");
  const [lessonOpen, setLessonOpen] = useState(true);
  const [generatingTask, setGeneratingTask] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainText, setExplainText] = useState("");
  const [explainSending, setExplainSending] = useState(false);
  const [explainResult, setExplainResult] = useState<{ correct: boolean; feedback: string } | null>(null);
  const startTime = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, lang }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setData(d);
      setCode(d.task.starterCode || "");
      setCustomInput(d.task.example.input ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [itemId, lang, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Generate a fresh task for the SAME topic — so a single subtopic offers
  // more than one exercise to practise with.
  async function anotherTask() {
    if (!data) return;
    setGeneratingTask(true);
    setError("");
    setAttempt(null);
    setRunOutput(null);
    setHintsShown(0);
    try {
      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, lang, newTask: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setData(d);
      setCode(d.task.starterCode || "");
      setCustomInput(d.task.example.input ?? "");
      startTime.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setGeneratingTask(false);
    }
  }

  // Switch to another task already in this subtopic's bank (no generation).
  async function selectTask(nextTaskId: string) {
    if (!data || nextTaskId === data.task.id) return;
    setError("");
    setAttempt(null);
    setRunOutput(null);
    setHintsShown(0);
    try {
      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, lang, taskId: nextTaskId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setData(d);
      setCode(d.task.starterCode || "");
      setCustomInput(d.task.example.input ?? "");
      startTime.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }

  async function run() {
    if (!data) return;
    setRunning(true);
    setRunOutput(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, input: customInput }),
      });
      setRunOutput(await res.json());
    } catch {
      setRunOutput({ ok: false, stdout: "", stderr: t("common.error"), timedOut: false });
    } finally {
      setRunning(false);
    }
  }

  async function submitExplanation() {
    if (!data || !explainText.trim()) return;
    setExplainSending(true);
    setExplainResult(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: data.item.skillIds[0], answer: explainText, lang }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setExplainResult({ correct: d.correct, feedback: d.feedback });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setExplainSending(false);
    }
  }

  async function submit() {
    if (!data) return;
    setSubmitting(true);
    setAttempt(null);
    try {
      const res = await fetch("/api/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: data.task.id,
          roadmapItemId: itemId,
          code,
          hintsUsed: hintsShown,
          confidence,
          timeSpentSeconds: Math.round((Date.now() - startTime.current) / 1000),
          lang,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setAttempt(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <div className="card p-10 text-center text-rose">{error}</div>;
  if (!data) return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent-soft" />
        <p className="mt-3 text-sm text-text-muted">{t("learn.loading")}</p>
      </div>
    </div>
  );

  const { item, task, competency } = data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/roadmap" className="btn-ghost px-3 py-2 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("learn.back")}
        </Link>
        <div className="min-w-0">
          <p className="text-xs text-text-faint">{item.phase}</p>
          <h1 className="truncate text-xl font-bold tracking-tight text-text">{item.title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {Object.entries(competency).map(([id, c]) => (
            <div key={id} className="hidden items-center gap-2 sm:flex">
              <ProgressRing
                value={c.mastery ?? 0}
                size={40}
                stroke={3.5}
                label={c.mastery === null ? "—" : `${Math.round(c.mastery * 100)}`}
              />
              <span className="max-w-[110px] text-[11px] leading-tight text-text-faint">
                {t(`status.${c.status}`)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: lesson + task */}
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <button onClick={() => setLessonOpen(!lessonOpen)} className="flex w-full items-center justify-between px-5 py-4 text-left">
              <span className="text-sm font-semibold text-text">{t("learn.lesson")}</span>
              <ChevronDown className={cn("h-4 w-4 text-text-faint transition-transform", lessonOpen && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {lessonOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="border-t border-white/[0.06] px-5 py-5">
                    {/* Provenance badge */}
                    {data.lesson.grounded ? (
                      <div className="mb-4 rounded-xl border border-mint/25 bg-mint/[0.05] p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-mint">
                          <FileText className="h-3.5 w-3.5" /> {t("learn.provenance.grounded")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {data.lesson.sources.map((s, i) => (
                            <span key={i} className="chip border-mint/20 text-mint">
                              {s.materialName}
                              {s.heading ? ` — ${s.heading}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 rounded-xl border border-white/[0.08] bg-ink-900/50 p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-text-faint">
                          <Sparkles className="h-3.5 w-3.5" /> {t("learn.provenance.generated")}
                        </p>
                      </div>
                    )}
                    <Markdown>{data.lesson.body}</Markdown>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <TerminalSquare className="h-4 w-4 text-accent-soft" /> {task.title}
              <span className="chip">{t(`learn.format.${task.format}`)}</span>
              <button
                onClick={anotherTask}
                disabled={generatingTask}
                title={t("learn.anotherTask.hint")}
                className="btn-ghost ml-auto px-2.5 py-1 text-[11px] disabled:opacity-50"
              >
                {generatingTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {t("learn.anotherTask")}
              </button>
            </div>
            {data.taskBank.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-text-faint">
                  {t("learn.task")} {data.taskIndex + 1} / {data.taskBank.length} {t("learn.taskBank")}
                </span>
                {data.taskBank.map((entry, i) => (
                  <button
                    key={entry.id}
                    onClick={() => selectTask(entry.id)}
                    title={entry.title}
                    className={cn(
                      "h-6 min-w-6 rounded-md px-2 text-[11px] font-semibold transition-colors",
                      entry.id === task.id ? "bg-accent/20 text-accent-soft" : "bg-white/[0.05] text-text-faint hover:text-text",
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Markdown>{task.statement}</Markdown>
            </div>
            {task.example.input !== "" && (
              <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-900/60 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">{t("learn.example")}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 font-mono text-xs">
                  <div>
                    <p className="text-text-faint">{t("learn.input")}</p>
                    <pre className="mt-1 whitespace-pre-wrap text-text/90">{task.example.input}</pre>
                  </div>
                  <div>
                    <p className="text-text-faint">{t("learn.output")}</p>
                    <pre className="mt-1 whitespace-pre-wrap text-mint">{task.example.expected}</pre>
                  </div>
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] text-text-faint">{task.testCount} {t("learn.hiddenTests")}</p>
          </section>
        </div>

        {/* Right: editor + feedback */}
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <span className="flex items-center gap-2 text-xs font-medium text-text-muted">
                <span className="h-2.5 w-2.5 rounded-full bg-rose/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
                solution.py
              </span>
              <button onClick={() => setCode(data.task.starterCode || "")} className="text-xs text-text-faint transition-colors hover:text-text-muted">
                <RotateCcw className="mr-1 inline h-3 w-3" /> {t("learn.reset")}
              </button>
            </div>
            <div className="h-[340px]">
              <MonacoEditor
                language="python"
                theme="vs-dark"
                value={code}
                onChange={(v) => setCode(v ?? "")}
                options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12 }, fontFamily: "var(--font-jetbrains), monospace" }}
                loading={<div className="grid h-full place-items-center text-sm text-text-faint">Loading editor…</div>}
              />
            </div>
          </section>

          {/* Hints */}
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                <Lightbulb className="h-4 w-4 text-amber" /> {t("learn.hints")}
                <span className="text-xs text-text-faint">({hintsShown}/{task.hints.length} {t("learn.used")})</span>
              </span>
              {hintsShown < task.hints.length && (
                <button onClick={() => setHintsShown((h) => Math.min(h + 1, task.hints.length))} className="btn-ghost px-3 py-1.5 text-xs">
                  {t("learn.revealHint")}
                </button>
              )}
            </div>
            <AnimatePresence>
              {task.hints.slice(0, hintsShown).map((h, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-lg border border-amber/20 bg-amber/[0.04] p-3 text-sm text-text-muted">
                  <span className="mr-2 text-xs font-semibold text-amber">Hint {i + 1}</span>
                  {h}
                </motion.div>
              ))}
            </AnimatePresence>
          </section>

          {/* Run controls */}
          <section className="card p-4">
            <label className="text-xs font-medium text-text-faint">{t("learn.testInput")}</label>
            <textarea value={customInput} onChange={(e) => setCustomInput(e.target.value)} rows={2} className="input mt-1.5 resize-none font-mono text-xs" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={run} disabled={running} className="btn-ghost px-4 py-2 text-xs">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t("learn.run")}
              </button>

              <div className="ml-auto flex items-center gap-2">
                <div className="flex gap-1">
                  {CONFIDENCE.map((c) => (
                    <button key={c.value} onClick={() => setConfidence(c.value)} className={cn(
                      "rounded-md border px-2 py-1.5 text-[11px] transition-all",
                      confidence === c.value ? "border-accent/50 bg-accent/10 text-accent-soft" : "border-white/[0.08] text-text-faint",
                    )}>
                      {t(c.label)}
                    </button>
                  ))}
                </div>
                <button onClick={submit} disabled={submitting} className="btn-primary px-4 py-2 text-xs">
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("learn.submit")}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {runOutput && (
                <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs leading-5">
                  {runOutput.stdout && <span className="text-text/90">{runOutput.stdout}</span>}
                  {runOutput.stderr && <span className="text-rose">{runOutput.stderr}</span>}
                  {runOutput.timedOut && <span className="text-amber">⏱ timed out</span>}
                  {!runOutput.stdout && !runOutput.stderr && !runOutput.timedOut && <span className="text-text-faint">(no output)</span>}
                </motion.pre>
              )}
            </AnimatePresence>
          </section>

          {/* Feedback */}
          <AnimatePresence>
            {attempt && (
              <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={cn("card border p-5", attempt.passedAll ? "border-mint/30" : "border-white/[0.08]")}>
                <div className="flex items-center gap-2">
                  {attempt.passedAll ? <CheckCircle2 className="h-5 w-5 text-mint" /> : <XCircle className="h-5 w-5 text-amber" />}
                  <span className={cn("text-sm font-semibold", attempt.passedAll ? "text-mint" : "text-text")}>
                    {attempt.passed} / {attempt.total} tests passed
                  </span>
                  {attempt.method === "deterministic" && <span className="chip ml-auto">{t("learn.verified")}</span>}
                </div>

                {attempt.calibration && (
                  <span className={cn(
                    "chip mt-2",
                    attempt.calibration.direction === "overconfident" && "border-amber/40 text-amber",
                    attempt.calibration.direction === "underconfident" && "border-cyan/40 text-cyan",
                    attempt.calibration.direction === "calibrated" && "border-mint/40 text-mint",
                  )}>
                    {t(`learn.calibration.${attempt.calibration.direction}`)}
                  </span>
                )}

                <div className="mt-3">
                  <Markdown>{attempt.feedback}</Markdown>
                </div>

                {attempt.issues?.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">{t("learn.issues")}</p>
                    {attempt.issues.map((iss, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-ink-900/60 p-2 text-xs">
                        <span className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-accent-soft">L{iss.line}</span>
                        <span className="text-text-muted">{iss.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {attempt.testResults.filter((x) => !x.pass).length > 0 && (
                  <div className="mt-4 space-y-2">
                    {attempt.testResults.filter((x) => !x.pass).slice(0, 3).map((x, i) => (
                      <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/60 p-2.5 font-mono text-[11px]">
                        <p className="text-text-faint">expected: <span className="text-mint">{x.expected}</span></p>
                        <p className="text-text-faint">got: <span className="text-rose">{x.got || "(empty)"}</span></p>
                        {x.stderr && <p className="mt-1 text-rose/80">{x.stderr}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {attempt.competency && (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 p-3">
                    <ProgressRing
                      value={attempt.competency.mastery ?? 0}
                      size={44}
                      stroke={4}
                      label={attempt.competency.mastery === null ? "—" : `${Math.round(attempt.competency.mastery * 100)}`}
                    />
                    <div className="text-xs leading-relaxed text-text-muted">
                      <p>
                        <span className="text-text">{attempt.competency.name}</span> — {t(`status.${attempt.competency.status}`)}
                      </p>
                      <p className="text-text-faint">
                        {t("metric.evidence")}: {attempt.competency.evidenceCount} {t("metric.observations")} ·{" "}
                        {attempt.competency.independentSuccesses} {t("metric.independentSuccesses")} · depth{" "}
                        {attempt.competency.depth ?? t("metric.notAssessed")}
                      </p>
                    </div>
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>

          {/* Teach-back (§95) — available after a successful attempt. */}
          {attempt?.passedAll && (
            <section className="card p-4">
              <button onClick={() => setExplainOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
                <span className="text-sm font-medium text-text">{t("learn.teachback")}</span>
                <ChevronDown className={cn("h-4 w-4 text-text-faint transition-transform", explainOpen && "rotate-180")} />
              </button>
              {explainOpen && (
                <div className="mt-3">
                  <p className="text-xs text-text-faint">{t("learn.teachback.hint")}</p>
                  <textarea value={explainText} onChange={(e) => setExplainText(e.target.value)} rows={3} className="input mt-2 resize-none" />
                  <button onClick={submitExplanation} disabled={explainSending || !explainText.trim()} className="btn-ghost mt-2 px-3 py-1.5 text-xs">
                    {explainSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("learn.teachback.submit")}
                  </button>
                  {explainResult && (
                    <div className={cn("mt-3 rounded-xl border p-3 text-sm", explainResult.correct ? "border-mint/30 bg-mint/[0.05]" : "border-amber/30 bg-amber/[0.05]")}>
                      <Markdown>{explainResult.feedback}</Markdown>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Sequential full-cycle navigation: same content as the roadmap tree. */}
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        {data.nav.prevId ? (
          <Link href={`/learn/${data.nav.prevId}`} className="btn-ghost px-4 py-2 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("learn.prev")}
          </Link>
        ) : (
          <span />
        )}
        {data.nav.nextId ? (
          <Link href={`/learn/${data.nav.nextId}`} className="btn-primary px-4 py-2 text-xs">
            {t("learn.next")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
