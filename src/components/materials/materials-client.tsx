"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { cn } from "@/lib/utils";

type Material = {
  id: string;
  filename: string;
  size: number;
  language: string;
  status: string;
  chunkCount: number;
  summary: string;
  skillIds: string[];
  createdAt: string;
};

function fmtSize(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function MaterialsClient() {
  const { t } = useI18n();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/materials").then((r) => r.json());
    if (res.materials) setMaterials(res.materials);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, string> = {};
        for (const s of d.skills ?? []) map[s.id] = s.name;
        setSkillNames(map);
      })
      .catch(() => {});
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
        const res = await fetch("/api/materials", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("common.error"));
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.error"));
      } finally {
        setUploading(false);
      }
    }
  }

  async function remove(id: string) {
    await fetch(`/api/materials/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text">{t("materials.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">{t("materials.subtitle")}</p>
      </div>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-10 text-center transition-all",
          drag ? "border-accent/60 bg-accent/[0.06]" : "border-white/[0.12] bg-ink-850/40 hover:border-accent/40",
        )}
      >
        <UploadCloud className={cn("h-8 w-8 transition-all", drag ? "text-accent-soft" : "text-text-faint group-hover:text-accent-soft")} />
        <p className="mt-3 text-sm font-medium text-text">
          {uploading ? t("materials.uploading") : t("materials.drop")}
        </p>
        <p className="mt-1 text-xs text-text-faint">{t("materials.hint")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".txt,.md,.text,.csv,.json,.pdf,.docx"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>

      {error && <p className="text-sm text-rose">{error}</p>}

      {/* List */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {materials.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                  <FileText className="h-5 w-5 text-accent-soft" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-text">{m.filename}</p>
                    <span className="chip">{fmtSize(m.size)}</span>
                    <span className="chip uppercase">{m.language}</span>
                    <span className="chip">{m.chunkCount} {t("materials.chunks")}</span>
                  </div>
                  {m.summary && <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{m.summary}</p>}
                  {m.skillIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.skillIds.slice(0, 8).map((id) => (
                        <span key={id} className="chip border-accent/20 text-accent-soft">{skillNames[id] ?? id}</span>
                      ))}
                      {m.skillIds.length > 8 && <span className="chip">+{m.skillIds.length - 8}</span>}
                    </div>
                  )}
                </div>
                <button onClick={() => remove(m.id)} className="rounded-lg p-2 text-text-faint transition-colors hover:bg-white/[0.05] hover:text-rose" title={t("materials.delete")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {materials.length === 0 && !uploading && (
          <div className="card p-8 text-center">
            <FileText className="mx-auto h-6 w-6 text-text-faint" />
            <p className="mt-3 text-sm text-text-faint">{t("materials.empty")}</p>
          </div>
        )}
        {uploading && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent-soft" /> {t("materials.uploading")}
          </div>
        )}
      </div>
    </div>
  );
}
