import { cn } from "@/lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2.5", className)}>
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
      {label && <span className="text-sm text-text-muted">{label}</span>}
    </div>
  );
}
