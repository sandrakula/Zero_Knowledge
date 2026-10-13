"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, MessageSquare, Plus } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { ChatComposer, ChatThread, GoalCta, QuickActions } from "@/components/tutor/chat-ui";
import { useTutor } from "@/components/tutor/use-tutor";
import { cn, timeAgo } from "@/lib/utils";

/**
 * Full tutor workspace. It uses the SAME backend conversation and context logic
 * as the floating panel (§52) — there is only one history.
 */
export function TutorClient() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const tutor = useTutor();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex items-center gap-2">
        <div>
          <p className="eyebrow flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" /> {t("tutor.title")}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-text">
            {tutor.hasGoal === false ? t("tutor.goal.title") : t("tutor.subtitle")}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {tutor.context && (
            <span className="chip border-accent/30 bg-accent/10 text-accent-soft">
              <Brain className="h-3.5 w-3.5" /> {t("tutor.context")}: {tutor.context.title}
            </span>
          )}
          <button onClick={() => setShowHistory((s) => !s)} className="btn-ghost px-3 py-2 text-xs">
            {t("tutor.history")}
          </button>
          <button onClick={tutor.newConversation} className="btn-ghost px-3 py-2 text-xs">
            <Plus className="h-3.5 w-3.5" /> {t("tutor.newChat")}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {showHistory && (
          <aside className="hidden w-64 shrink-0 overflow-y-auto rounded-2xl border border-white/[0.06] bg-ink-900/30 p-2 sm:block">
            {tutor.conversations.length === 0 && <p className="p-3 text-xs text-text-faint">{t("tutor.noHistory")}</p>}
            {tutor.conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => tutor.selectConversation(c.id)}
                className={cn(
                  "mb-1 block w-full rounded-xl px-3 py-2 text-left transition-colors",
                  c.id === tutor.conversationId ? "bg-white/[0.07] text-text" : "text-text-muted hover:bg-white/[0.04]",
                )}
              >
                <p className="truncate text-xs font-medium">{c.title}</p>
                <p className="text-[10px] text-text-faint">{c.messageCount} · {timeAgo(c.lastMessageAt)}</p>
              </button>
            ))}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto rounded-2xl border border-white/[0.06] bg-ink-900/30 p-4">
            {tutor.loading ? (
              <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>
            ) : (
              <ChatThread
                messages={tutor.messages}
                greeting={tutor.greeting}
                sending={tutor.sending}
                bottomRef={tutor.bottomRef}
              />
            )}
          </div>

          {tutor.error && <p className="mt-2 text-xs text-rose">{tutor.error}</p>}

          <div className="mt-3">
            <ChatComposer
              value={input}
              onChange={setInput}
              sending={tutor.sending}
              placeholder={tutor.hasGoal === false ? t("tutor.goal.title") : t("tutor.placeholder")}
              onSend={() => {
                const v = input;
                setInput("");
                void tutor.send(v);
              }}
            />
            {tutor.hasGoal === true && (
              <QuickActions
                onPick={(text) => {
                  setInput("");
                  void tutor.send(text);
                }}
              />
            )}
            {tutor.goalId && !tutor.context && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <GoalCta goalId={tutor.goalId} />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
