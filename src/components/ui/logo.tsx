import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative grid h-8 w-8 place-items-center">
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent to-cyan opacity-90 shadow-glow" />
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent to-cyan blur-md opacity-40" />
        <svg viewBox="0 0 24 24" className="relative h-5 w-5 text-white" fill="none">
          <path d="M12 3v3M5 8l2.5 1.5M19 8l-2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="13" r="4.2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="13" r="1.4" fill="currentColor" />
        </svg>
      </div>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-tight text-text">
          Cognos
          <span className="ml-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-[0.14em] text-text-faint">
            β
          </span>
        </span>
      )}
    </div>
  );
}
