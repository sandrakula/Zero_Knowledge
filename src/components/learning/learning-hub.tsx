"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, FileText, LayoutDashboard, Network } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { OverviewView } from "@/components/learning/overview-view";
import { MapView } from "@/components/learning/map-view";
import { ProgressView } from "@/components/learning/progress-view";
import { MaterialsClient } from "@/components/materials/materials-client";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "hub.tab.overview", icon: LayoutDashboard },
  { id: "map", label: "hub.tab.map", icon: Network },
  { id: "materials", label: "hub.tab.materials", icon: FileText },
  { id: "progress", label: "hub.tab.progress", icon: Activity },
];

/**
 * Unified Learning hub (§4): ONE top-level destination containing Overview,
 * Knowledge Map, Materials and Progress as internal views. Old routes redirect
 * here with a preselected tab, so nothing is duplicated.
 */
export function LearningHub() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab") ?? "overview";
  const tab = TABS.some((x) => x.id === requested) ? requested : "overview";

  const setTab = useCallback(
    (next: string) => router.replace(`${pathname}?tab=${next}`, { scroll: false }),
    [pathname, router],
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">{t("hub.title")}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-text">{t("hub.subtitle")}</h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-2">
        {TABS.map((x) => {
          const Icon = x.icon;
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={cn(
                "relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                active ? "text-text" : "text-text-muted hover:text-text",
              )}
            >
              {active && (
                <motion.span layoutId="hub-tab" className="absolute inset-0 rounded-xl border border-white/[0.1] bg-white/[0.05]" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{t(x.label)}</span>
            </button>
          );
        })}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {tab === "overview" && <OverviewView onOpenTab={setTab} />}
        {tab === "map" && <MapView />}
        {tab === "materials" && <MaterialsClient />}
        {tab === "progress" && <ProgressView />}
      </motion.div>
    </div>
  );
}
