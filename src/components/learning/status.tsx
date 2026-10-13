"use client";

import { HelpCircle } from "lucide-react";import { ALL_STATUSES, STATUS_COLOR, type SkillStatus } from "@/lib/core/competency";
import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";

// Colours come from the educational core (competency.ts) — components never
// derive their own status colours (§27).

export function StatusDot({ status, className }: { status: SkillStatus; className?: string }) {
  const { t } = useI18n();
  const color = STATUS_COLOR[status];
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)}
      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      role="img"
      aria-label={t(`status.${status}`)}
      title={t(`status.${status}`)}
    />
  );
}

export function StatusBadge({ status, className }: { status: SkillStatus; className?: string }) {
  const { t } = useI18n();
  const color = STATUS_COLOR[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", className)}
      style={{ color, background: `${color}1a` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {t(`status.${status}`)}
    </span>
  );
}

/** Visible legend — colour is never the only carrier of meaning (§30). */
export function StatusLegend({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("card p-3", className)}>
      <p className="eyebrow flex items-center gap-1.5">
        <HelpCircle className="h-3 w-3" /> {t("status.legend")}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="flex items-center gap-2 text-[11px] text-text-muted">
            <StatusDot status={s} />
            <span>{t(`status.${s}`)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-text-faint">{t("status.legend.hint")}</p>
    </div>
  );
}

/**
 * A metric that must never fabricate a value: shows "Not assessed" when the
 * core reports no evidence (§7, §22, §80).
 */
export function MetricValue({
  label,
  value,
  hint,
  format = "percent",
  digits = 0,
}: {
  label: string;
  value: number | null;
  hint?: string;
  format?: "percent" | "text";
  digits?: number;
}) {
  const { t } = useI18n();
  const unassessed = value === null;
  const shown =
    unassessed
      ? t("metric.notAssessed")
      : format === "percent"
        ? `${Math.round(value * 100)}%`
        : value.toFixed(digits);
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs" title={hint}>
      <span className="text-text-faint">{label}</span>
      <span className={cn("font-medium", unassessed ? "text-text-faint" : "text-text")}>{shown}</span>
    </div>
  );
}
