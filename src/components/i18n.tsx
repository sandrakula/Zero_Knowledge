"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { dicts } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
};

const Ctx = createContext<I18nValue>({
  lang: "en",
  setLang: () => {},
  toggle: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Initialize synchronously from localStorage to avoid an "en → ru" flip on
  // mount, which re-rendered the tree and double-fired effect-driven requests
  // (e.g. the diagnostic's first question being generated twice).
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("zk_lang");
      if (saved === "ru" || saved === "en") return saved;
    }
    return "en";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("zk_lang", l);
  }, []);

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "en" ? "ru" : "en";
      localStorage.setItem("zk_lang", next);
      return next;
    });
  }, []);

  const t = useCallback((key: string) => dicts[lang][key] ?? key, [lang]);

  return <Ctx.Provider value={{ lang, setLang, toggle, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
