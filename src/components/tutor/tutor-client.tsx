"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";
import type { StateResponse } from "@/lib/types";

type ChatMsg = { role: "user" | "assistant"; content: string; actionType?: string };

const ACTION_LABEL: Record<string, string> = {
  ASK_QUESTION: "asking",
  GIVE_HINT: "hint",
  EXPLAIN: "explain",
  SHOW_EXAMPLE: "example",
  GIVE_COUNTEREXAMPLE: "counterexample",
  REQUEST_REFLECTION: "reflection",
  REQUEST_ATTEMPT: "practice",
  ESCALATE: "check-in",
};

export function TutorClient() {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: "assistant", content: "" }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [context, setContext] = useState<{ itemId: string; title: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: "assistant", content: t("tutor.greeting"), actionType: "EXPLAIN" }]);
  }, [t]);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((d: StateResponse & { error?: string }) => {
        if (d.error) return;
        const active = d.roadmap?.items.find((i) => i.status === "active" || i.status === "ready");
        if (active) setContext({ itemId: active.id, title: active.title });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, roadmapItemId: context?.itemId, lang }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t("common.error"));
      setMessages((m) => [...m, { role: "assistant", content: d.reply, actionType: d.actionType }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : t("common.error")}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex items-center gap-2">
        <div>
          <p className="eyebrow flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" /> {t("tutor.title")}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-text">{t("tutor.subtitle")}</h1>
        </div>
        {context && (
          <span className="ml-auto chip border-accent/30 bg-accent/10 text-accent-soft">
            <Brain className="h-3.5 w-3.5" /> {t("tutor.context")}: {context.title}
          </span>
        )}
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-white/[0.06] bg-ink-900/30 p-4">
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-accent text-white" : "border border-white/[0.08] bg-ink-850/80")}>
                {m.role === "assistant" && m.actionType && (
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-accent-soft">
                    {ACTION_LABEL[m.actionType] ?? m.actionType}
                  </span>
                )}
                {m.role === "assistant" ? (
                  <div className="text-sm leading-relaxed text-text/90">
                    <Markdown>{m.content}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-ink-850/80 px-4 py-3 text-sm text-text-muted">
              <Sparkles className="h-4 w-4 animate-pulse text-accent-soft" /> {t("tutor.thinking")}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("tutor.placeholder")} className="input flex-1" />
        <button onClick={send} disabled={sending || !input.trim()} className="btn-primary px-4">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
