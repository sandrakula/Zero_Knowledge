"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Route,
  Network,
  MessageSquare,
  Activity,
  Sparkles,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV = [
  { href: "/home", label: "Home", icon: LayoutDashboard },
  { href: "/roadmap", label: "Roadmap", icon: Route },
  { href: "/map", label: "Knowledge Map", icon: Network },
  { href: "/tutor", label: "Tutor", icon: MessageSquare },
  { href: "/progress", label: "Progress", icon: Activity },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/[0.06] bg-ink-900/50 backdrop-blur-xl md:flex">
        <div className="flex h-16 items-center border-b border-white/[0.06] px-5">
          <Link href="/home">
            <Logo />
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "text-text" : "text-text-muted hover:text-text",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl border border-white/[0.08] bg-white/[0.05]"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon className="relative h-[18px] w-[18px]" />
                <span className="relative">{item.label}</span>
                {active && (
                  <motion.span
                    layoutId="nav-dot"
                    className="relative ml-auto h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(124,108,255,0.9)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="rounded-xl border border-accent/20 bg-accent/[0.07] p-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-soft">
              <Sparkles className="h-3.5 w-3.5" />
              Learning Intelligence
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
              Your next step is chosen from evidence — not a fixed sequence.
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center border-b border-white/[0.06] bg-ink-900/70 px-4 backdrop-blur-xl md:hidden">
        <Logo />
        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg p-2 transition-colors",
                  active ? "bg-white/[0.08] text-text" : "text-text-muted",
                )}
                aria-label={item.label}
              >
                <Icon className="h-5 w-5" />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main */}
      <main className="min-h-screen flex-1 md:pl-60">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-14 md:px-8 md:pt-8">{children}</div>
      </main>
    </div>
  );
}
