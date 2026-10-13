"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Plus, X } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { ChatComposer, ChatThread, GoalCta } from "@/components/tutor/chat-ui";
import { useTutor } from "@/components/tutor/use-tutor";
import { cn } from "@/lib/utils";

/**
 * Persistent floating tutor (§48–51). Mounted once in the authenticated app
 * shell, so it survives navigation, and it reads the SAME persisted
 * conversation as the full tutor page.
 */
export function FloatingTutor() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const tutor = useTutor();

  // Close the panel when navigating to a full-screen learning view is not
  // required — but keep it out of the way on the coding screen.
  const compact = pathname.startsWith("/learn");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-label={t("tutor.title")}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-ink-900/95 shadow-card backdrop-blur-xl",
              compact
                ? "bottom-20 right-4 h-[60vh] w-[min(92vw,360px)]"
                : "bottom-4 right-4 h-[min(78vh,620px)] w-[min(94vw,400px)]",
              "max-sm:inset-x-2 max-sm:bottom-2 max-sm:h-[72vh] max-sm:w-auto max-sm:right-2",
            )}
          >
            <header className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
              <MessageSquare className="h-4 w-4 text-accent-soft" />
              <span className="text-sm font-semibold text-text">{t("tutor.title")}</span>
              {tutor.context && (
                <span className="chip ml-1 hidden truncate text-[10px] sm:inline">{tutor.context.title}</span>
              )}
              <button onClick={tutor.newConversation} className="ml-auto rounded-lg p-1.5 text-text-faint transition-colors hover:text-text" aria-label={t("tutor.newChat")}>
                <Plus className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-text-faint transition-colors hover:text-rose" aria-label={t("common.close")}>
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <ChatThread
                messages={tutor.messages}
                greeting={tutor.greeting}
                sending={tutor.sending}
                bottomRef={tutor.bottomRef}
                compact
              />
            </div>

            {tutor.error && <p className="px-4 pb-2 text-xs text-rose">{tutor.error}</p>}

            <div className="border-t border-white/[0.07] p-3">
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
                compact
              />
              {tutor.goalId && !tutor.context && <GoalCta goalId={tutor.goalId} />}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.94 }}
        aria-label={open ? t("common.close") : t("tutor.title")}
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 right-4 z-50 grid h-12 w-12 place-items-center rounded-2xl border shadow-glow transition-colors",
          open ? "border-white/[0.14] bg-ink-800 text-text" : "border-accent/40 bg-accent text-white hover:bg-accent-deep",
          compact && "bottom-20",
          "max-sm:h-11 max-sm:w-11",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </motion.button>
    </>
  );
}
