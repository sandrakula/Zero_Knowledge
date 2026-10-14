"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, LayoutDashboard, Loader2 } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { OverviewView } from "@/components/learning/overview-view";
import { MaterialsClient } from "@/components/materials/materials-client";
import type { StateResponse } from "@/lib/types";

const SECTIONS = [
  { id: "overview", label: "hub.tab.overview", icon: LayoutDashboard },
  { id: "materials", label: "hub.tab.materials", icon: FileText },
] as const;

/**
 * Unified Learning hub (§4): ONE destination that renders Overview and
 * Materials as sections of a single page — no inner tabs.
 *
 * Every section reads the SAME snapshot of the deterministic competency core
 * (`/api/state`), so every metric agrees across the page and nothing is
 * re-derived per view (§12, §28).
 */
export function LearningHub() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/state")
      .then((r) => r.json())
      .then((s) => {
        if (cancelled) return;
        if (s.error) setError(s.error);
        else setState(s);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : t("common.error")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // The old `/materials` route redirects here with `?tab=materials`; scroll to
  // the matching section instead of switching a tab.
  useEffect(() => {
    if (loading) return;
    const target = params.get("tab");
    if (target) scrollTo(target);
  }, [params, loading, scrollTo]);

  if (error) return <p className="text-rose">{error}</p>;
  if (loading || !state) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>;
  }

  return (
    <div className="space-y-10">
      <div>
        <p className="eyebrow">{t("hub.title")}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-text">{t("hub.subtitle")}</h1>
      </div>

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section key={section.id} id={section.id} className="scroll-mt-24 space-y-4">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
              <Icon className="h-4 w-4 text-accent-soft" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{t(section.label)}</h2>
            </div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {section.id === "overview" && <OverviewView state={state} />}
              {section.id === "materials" && <MaterialsClient />}
            </motion.div>
          </section>
        );
      })}
    </div>
  );
}
