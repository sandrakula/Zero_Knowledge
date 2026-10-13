"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Users, FileText, Activity, ShieldCheck, UploadCloud, Trash2, LogOut, Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { useI18n } from "@/components/i18n";
import { cn, timeAgo } from "@/lib/utils";

type Overview = {
  students: {
    id: string;
    name: string;
    email: string;
    goalTitle: string | null;
    diagnosed: boolean;
    roadmap: { total: number; completed: number } | null;
    avgMastery: number;
    masteredSkills: number;
    seenSkills: number;
    attempts: number;
    attempts7d: number;
    evidenceCount: number;
    misconceptionCount: number;
    materialCount: number;
    lastActivityAt: string | null;
  }[];
  totals: { students: number; globalMaterials: number; totalAttempts: number; totalEvidence: number };
};

type Material = { id: string; filename: string; size: number; language: string; scope: string; chunkCount: number; isOwner: boolean };

export function AdminClient() {
  const { t } = useI18n();
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [ov, mat] = await Promise.all([
      fetch("/api/admin/overview").then((r) => r.json()),
      fetch("/api/materials").then((r) => r.json()),
    ]);
    setOverview(ov);
    setMaterials((mat.materials ?? []).filter((m: Material) => m.scope === "global"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setError("");
    for (const file of list) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("scope", "global");
        const res = await fetch("/api/materials", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("common.error"));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.error"));
      } finally {
        setUploading(false);
      }
    }
    load();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="chip border-accent/30 bg-accent/10 text-accent-soft">Admin</span>
          <LanguageToggle />
          <button onClick={logout} className="rounded-lg border border-white/[0.08] p-2 text-text-faint transition-colors hover:text-rose">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 pb-24">
        <div>
          <p className="eyebrow flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> {t("admin.title")}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">{t("admin.subtitle")}</h1>
        </div>

        {!overview ? (
          <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-soft" /></div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={Users} label={t("admin.students")} value={overview.totals.students} color="text-accent-soft" />
              <Stat icon={FileText} label={t("admin.globalCount")} value={overview.totals.globalMaterials} color="text-cyan" />
              <Stat icon={Activity} label={t("admin.totalAttempts")} value={overview.totals.totalAttempts} color="text-mint" />
              <Stat icon={ShieldCheck} label={t("admin.totalEvidence")} value={overview.totals.totalEvidence} color="text-amber" />
            </div>

            {/* Students table */}
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><Users className="h-4 w-4 text-accent-soft" /> {t("admin.students")}</h2>
              {overview.students.length === 0 ? (
                <p className="mt-3 text-sm text-text-faint">{t("admin.none")}</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-text-faint">
                        <th className="pb-2 pr-3 font-medium">{t("admin.col.student")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("admin.col.goal")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("admin.col.progress")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("admin.col.mastery")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("admin.col.activity")}</th>
                        <th className="pb-2 font-medium">{t("admin.col.lastSeen")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.students.map((s) => (
                        <tr key={s.id} className="border-t border-white/[0.05]">
                          <td className="py-3 pr-3">
                            <p className="font-medium text-text">{s.name}</p>
                            <p className="text-[11px] text-text-faint">{s.email}</p>
                          </td>
                          <td className="py-3 pr-3 text-xs text-text-muted">{s.goalTitle ?? "—"}</td>
                          <td className="py-3 pr-3 text-xs text-text-muted">
                            {s.roadmap ? `${s.roadmap.completed}/${s.roadmap.total}` : "—"}
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(s.avgMastery * 100)}%` }} />
                              </div>
                              <span className="text-xs text-text-muted">{Math.round(s.avgMastery * 100)}%</span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-text-faint">{s.masteredSkills}/{s.seenSkills} skills</p>
                          </td>
                          <td className="py-3 pr-3 text-xs text-text-muted">
                            <span className="font-medium text-text">{s.attempts7d}</span> {t("admin.attempts7d")}
                            {s.misconceptionCount > 0 && <span className="ml-1.5 text-amber">· {s.misconceptionCount} ⚠</span>}
                          </td>
                          <td className="py-3 text-xs text-text-faint">{s.lastActivityAt ? timeAgo(s.lastActivityAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Global materials */}
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><FileText className="h-4 w-4 text-cyan" /> {t("admin.globalMaterials")}</h2>
                <span className="chip">{materials.length}</span>
              </div>

              <div onClick={() => inputRef.current?.click()} className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.12] bg-ink-850/40 p-6 text-center transition-all hover:border-accent/40">
                <UploadCloud className="h-6 w-6 text-text-faint" />
                <p className="mt-2 text-sm text-text-muted">{uploading ? t("materials.uploading") : t("admin.dropGlobal")}</p>
                <input ref={inputRef} type="file" multiple accept=".txt,.md,.text,.csv,.json,.pdf,.docx" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
              </div>

              {error && <p className="mt-3 text-sm text-rose">{error}</p>}

              <div className="mt-3 space-y-2">
                {materials.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/40 p-3">
                    <FileText className="h-4 w-4 shrink-0 text-cyan" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text">{m.filename}</p>
                      <p className="text-[11px] text-text-faint">{Math.round(m.size / 1024)} KB · {m.chunkCount} {t("materials.chunks")} · {m.language.toUpperCase()}</p>
                    </div>
                    <button onClick={async () => { await fetch(`/api/materials/${m.id}`, { method: "DELETE" }); load(); }} className="rounded-lg p-2 text-text-faint transition-colors hover:bg-white/[0.05] hover:text-rose">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <Icon className={cn("h-4 w-4", color)} />
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-text-faint">{label}</p>
    </div>
  );
}
