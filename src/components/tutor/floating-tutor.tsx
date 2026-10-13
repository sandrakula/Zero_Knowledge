"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Plus, X } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { ChatComposer, ChatThread, GoalCta, QuickActions } from "@/components/tutor/chat-ui";
import { useTutor } from "@/components/tutor/use-tutor";
import { cn } from "@/lib/utils";

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

type DragState = { startX: number; startY: number; left: number; top: number };
type ResizeState = { startX: number; startY: number; w: number; h: number };

/**
 * Persistent floating tutor (§48–51). Mounted once in the authenticated app
 * shell, so it survives navigation, and it reads the SAME persisted
 * conversation as the full tutor page.
 *
 * The panel is draggable (grab the header) and resizable (drag the bottom-right
 * corner) so it never gets in the way of the editor or the roadmap.
 */
export function FloatingTutor() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [size, setSize] = useState({ w: 400, h: 600 });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tutor = useTutor();

  // Close the panel when navigating to a full-screen learning view is not
  // required — but keep it out of the way on the coding screen.
  const compact = pathname.startsWith("/learn");

  // Initial size fits the viewport (mobile-safe).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSize({
      w: Math.min(400, window.innerWidth - 16),
      h: Math.min(600, window.innerHeight - 16),
    });
  }, []);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Global pointer listeners while dragging or resizing.
  useEffect(() => {
    if (!drag && !resize) return;
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const left = clamp(drag.left + e.clientX - drag.startX, 0, window.innerWidth - 120);
        const top = clamp(drag.top + e.clientY - drag.startY, 0, window.innerHeight - 72);
        setPos({ left, top });
      }
      if (resize) {
        const w = clamp(resize.w + e.clientX - resize.startX, 300, window.innerWidth - 16);
        const h = clamp(resize.h + e.clientY - resize.startY, 320, window.innerHeight - 16);
        setSize({ w, h });
      }
    };
    const onUp = () => {
      setDrag(null);
      setResize(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, resize]);

  function startDrag(e: ReactPointerEvent<HTMLElement>) {
    // Ignore clicks on the header buttons (new chat / close).
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setDrag({ startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top });
  }

  function startResize(e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setResize({ startX: e.clientX, startY: e.clientY, w: size.w, h: size.h });
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            ref={panelRef}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-label={t("tutor.title")}
            style={{
              width: size.w,
              height: size.h,
              ...(pos
                ? { left: pos.left, top: pos.top }
                : { right: 16, bottom: compact ? 80 : 16 }),
            }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-ink-900/95 shadow-card backdrop-blur-xl"
          >
            <header
              onPointerDown={startDrag}
              className="flex cursor-grab select-none items-center gap-2 border-b border-white/[0.07] px-4 py-3 active:cursor-grabbing"
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-accent-soft" />
              <span className="truncate text-sm font-semibold text-text">{t("tutor.title")}</span>
              {tutor.context && (
                <Link href={`/learn/${tutor.context.itemId}`} className="chip ml-1 hidden truncate text-[10px] transition-colors hover:border-accent/40 sm:inline">
                  {tutor.context.title}
                </Link>
              )}
              <button onClick={tutor.newConversation} className="ml-auto rounded-lg p-1.5 text-text-faint transition-colors hover:text-text" aria-label={t("tutor.newChat")}>
                <Plus className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-text-faint transition-colors hover:text-rose" aria-label={t("common.close")}>
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
              {tutor.hasGoal === true && (
                <QuickActions
                  onPick={(text) => {
                    setInput("");
                    void tutor.send(text);
                  }}
                />
              )}
              {tutor.goalId && !tutor.context && <GoalCta goalId={tutor.goalId} />}
            </div>

            {/* Resize handle (bottom-right corner). */}
            <div
              onPointerDown={startResize}
              className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none"
              aria-hidden
            >
              <div className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b-2 border-r-2 border-white/25" />
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
