"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n";
import type { ConversationSummary, StateResponse } from "@/lib/types";

export type TutorActionMeta =
  | { type: "created_tasks"; parentItemId: string; nodeIds: string[]; titles: string[] }
  | { type: "roadmap_edit"; nodeId: string; added: number; titles: string[] }
  | { type: "error"; message: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionType?: string | null;
  action?: TutorActionMeta | null;
};

/**
 * Shared tutor state (§52). The authoritative history is the server-side
 * conversation — this hook only mirrors it, so the floating panel and the full
 * tutor page can never diverge.
 */
export function useTutor() {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasGoal, setHasGoal] = useState<boolean | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [context, setContext] = useState<{ itemId: string; title: string } | null>(null);
  // What the learn view publishes for the screen the learner is on right now:
  // the exact item, the current bank task and the unsent editor code.
  const [liveContext, setLiveContext] = useState<{ itemId: string; title: string; taskId?: string; code?: string } | null>(null);
  const pathname = usePathname();
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/tutor/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(
      (data.messages ?? [])
        .filter((m: { role: string }) => m.role !== "system")
        .map((m: { id: string; role: string; content: string; actionType: string | null; meta: Record<string, unknown> }) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
          actionType: m.actionType,
          action: (m.meta?.action as TutorActionMeta) ?? null,
        })),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [convRes, stateRes] = await Promise.all([
          fetch("/api/tutor/conversations").then((r) => r.json()),
          fetch("/api/state").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setConversations(convRes.conversations ?? []);
        const activeId: string | null = convRes.activeId ?? null;
        setConversationId(activeId);
        if (!convRes.error && stateRes && !stateRes.error) {
          setHasGoal(Boolean(stateRes.hasGoal));
          if (stateRes.goal) setGoalId(stateRes.goal.id);
          const item = stateRes.roadmap?.items?.find((i: { status: string }) => i.status === "active" || i.status === "ready");
          if (item) setContext({ itemId: item.id, title: item.title });
        } else {
          setHasGoal(false);
        }
        if (activeId) await loadMessages(activeId);
      } catch {
        setHasGoal(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // The learn view emits the live context; the float tutor follows the screen.
  useEffect(() => {
    const onCtx = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { itemId: string; title: string; taskId?: string; code?: string }
        | null;
      setLiveContext(detail ?? null);
    };
    window.addEventListener("zk:learn-context", onCtx);
    return () => window.removeEventListener("zk:learn-context", onCtx);
  }, []);

  // Fallback: derive the item from the URL when on a learn screen.
  const pathItemId = pathname?.startsWith("/learn/") ? pathname.split("/")[2] : null;
  const activeContext = liveContext ?? (pathItemId ? { itemId: pathItemId, title: context?.title ?? "" } : context);

  const send = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value || sending) return;
      setSending(true);
      setError("");
      // Optimistic local echo; the server copy is the authoritative record.
      setMessages((m) => [...m, { id: `local_${Date.now()}`, role: "user", content: value }]);
      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: value,
            conversationId,
            roadmapItemId: activeContext?.itemId,
            taskId: liveContext?.taskId,
            code: liveContext?.code,
            lang,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("common.error"));
        if (data.conversationId) setConversationId(data.conversationId);
        if (data.goalId) {
          setHasGoal(true);
          setGoalId(data.goalId);
        }
        setMessages((m) => [
          ...m,
          { id: `a_${Date.now()}`, role: "assistant", content: data.reply, actionType: data.actionType, action: data.action ?? null },
        ]);
        const list = await fetch("/api/tutor/conversations").then((r) => r.json());
        setConversations(list.conversations ?? []);
        // Let any open roadmap view refresh immediately after a tutor edit.
        if (data.action && (data.action.type === "created_tasks" || data.action.type === "roadmap_edit")) {
          window.dispatchEvent(new CustomEvent("zk:roadmap-changed"));
        }
      } catch (e) {
        // A provider failure must never erase history (§100).
        setError(e instanceof Error ? e.message : t("common.error"));
        setMessages((m) => [
          ...m,
          { id: `e_${Date.now()}`, role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : t("common.error")}` },
        ]);
      } finally {
        setSending(false);
      }
    },
    [conversationId, activeContext?.itemId, liveContext?.taskId, liveContext?.code, lang, sending, t],
  );

  const newConversation = useCallback(async () => {
    const res = await fetch("/api/tutor/conversations", { method: "POST" });
    const data = await res.json();
    if (data.conversation?.id) {
      setConversationId(data.conversation.id);
      setMessages([]);
      const list = await fetch("/api/tutor/conversations").then((r) => r.json());
      setConversations(list.conversations ?? []);
    }
  }, []);

  const selectConversation = useCallback(
    async (id: string) => {
      setConversationId(id);
      setMessages([]);
      await loadMessages(id);
    },
    [loadMessages],
  );

  const greeting = hasGoal === false ? t("tutor.goal.hint") : t("tutor.greeting");

  return {
    messages,
    greeting,
    sending,
    loading,
    error,
    hasGoal,
    goalId,
    context: activeContext,
    conversationId,
    conversations,
    bottomRef,
    send,
    newConversation,
    selectConversation,
  };
}
