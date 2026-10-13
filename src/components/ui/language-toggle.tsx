"use client";

import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={cn("flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5", className)}>
      {(["en", "ru"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-all",
            lang === l ? "bg-accent text-white" : "text-text-faint hover:text-text-muted",
          )}
        >
          {l === "en" ? "EN" : "RU"}
        </button>
      ))}
    </div>
  );
}
