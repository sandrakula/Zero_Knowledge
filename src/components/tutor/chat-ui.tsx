"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, ListTree, Send, Sparkles, Target } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { useI18n } from "@/components/i18n";
import type { ChatMessage } from "@/components/tutor/use-tutor";
import { cn } from "@/lib/utils";

const ACTION_LABEL: Record<string, string> = {
  ANSWER: "answer",
  ASK_QUESTION: "asking",
  ASK_CLARIFYING_QUESTION: "asking",
  GIVE_HINT: "hint",
  EXPLAIN: "explain",
  EXPLAIN_TOPIC: "explain",
  SHOW_EXAMPLE: "example",
  GIVE_COUNTEREXAMPLE: "counterexample",
  REQUEST_REFLECTION: "reflection",
  REQUEST_ATTEMPT: "practice",
  GENERATE_TASKS: "tasks",
  CREATE_ROADMAP_BRANCH: "roadmap",
  ADD_ROADMAP_SUBSTEPS: "roadmap",
  EDIT_ROADMAP_NODE: "roadmap",
  ESCALATE: "check-in",
};

/** Message thread shared by the floating panel and the full tutor page (§52). */
export function ChatThread({
  messages,
  greeting,
  sending,
  bottomRef,
  compact = false,
}: {
  messages: ChatMessage[];
  greeting: string;
  sending: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className={cn("space-y-4", compact && "text-sm")}>
      <div className="flex justify-start">
        <div className="max-w-[92%] rounded-2xl border border-white/[0.08] bg-ink-850/80 px-4 py-3">
          <div className="text-sm leading-relaxed text-text/90">
            <Markdown>{greeting}</Markdown>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div className={cn("max-w-[92%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-accent text-white" : "border border-white/[0.08] bg-ink-850/80")}>
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

              {/* Task cards for tutor-generated practice (§46) */}
              {m.action?.type === "created_tasks" && (
                <div className="mt-3 space-y-2">
                  {m.action.titles.map((title, i) => (
                    <Link
                      key={i}
                      href={`/learn/${m.action && "nodeIds" in m.action ? m.action.nodeIds[i] : ""}`}
                      className="flex items-center gap-2 rounded-xl border border-cyan/25 bg-cyan/[0.06] p-2.5 transition-colors hover:border-cyan/50"
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan" />
                      <span className="min-w-0 flex-1 truncate text-xs text-text">{title}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-text-faint" />
                    </Link>
                  ))}
                  <Link href="/roadmap" className="flex items-center gap-2 text-[11px] text-accent-soft hover:underline">
                    <ListTree className="h-3.5 w-3.5" /> {t("roadmap.tutorBranch")} → {t("nav.roadmap")}
                  </Link>
                </div>
              )}

              {m.action?.type === "roadmap_edit" && (
                <div className="mt-3 space-y-1.5">
                  {m.action.titles.map((title, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-xl border border-mint/25 bg-mint/[0.06] p-2.5">
                      <ListTree className="h-3.5 w-3.5 shrink-0 text-mint" />
                      <span className="min-w-0 flex-1 truncate text-xs text-text">{title}</span>
                    </div>
                  ))}
                  <Link href="/roadmap" className="flex items-center gap-2 text-[11px] text-accent-soft hover:underline">
                    <ArrowRight className="h-3.5 w-3.5" /> {t("nav.roadmap")}
                  </Link>
                </div>
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
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  sending,
  placeholder,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex gap-2", compact && "gap-1.5")}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSend()}
        placeholder={placeholder}
        className="input flex-1"
        aria-label={placeholder}
      />
      <button onClick={onSend} disabled={sending || !value.trim()} className="btn-primary px-4" aria-label="Send">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function GoalCta({ goalId }: { goalId: string | null }) {
  const { t } = useI18n();
  if (!goalId) return null;
  return (
    <Link href={`/diagnostic?goalId=${goalId}`} className="btn-primary mt-3 w-full">
      <Target className="h-4 w-4" /> {t("diag.initializing")} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}
