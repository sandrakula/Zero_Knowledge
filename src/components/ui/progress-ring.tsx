"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function ProgressRing({
  value,
  size = 72,
  stroke = 5,
  color = "#7c6cff",
  label,
  sublabel,
  className,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-semibold text-text">{label ?? `${Math.round(pct * 100)}`}</span>
        {sublabel && <span className="text-[10px] uppercase tracking-wider text-text-faint">{sublabel}</span>}
      </div>
    </div>
  );
}
