"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { useI18n } from "@/components/i18n";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("common.error"));
      router.push(data.user?.role === "admin" ? "/admin" : "/onboarding");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <LanguageToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="card w-full max-w-sm p-7"
        >
          <h1 className="text-xl font-bold tracking-tight text-text">
            {mode === "login" ? t("auth.login.title") : t("auth.register.title")}
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            {mode === "login" ? t("auth.login.subtitle") : t("auth.register.subtitle")}
          </p>

          <div className="mt-6 space-y-3">
            {mode === "register" && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.register.name")}
                className="input"
                autoComplete="name"
              />
            )}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.login.email")}
              type="email"
              className="input"
              autoComplete="email"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.register.password")}
              type="password"
              className="input"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {error && <p className="mt-3 text-sm text-rose">{error}</p>}

          <button onClick={submit} disabled={loading} className="btn-primary mt-5 w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "login" ? (
              t("auth.login.submit")
            ) : (
              t("auth.register.submit")
            )}
          </button>

          <p className="mt-5 text-center text-sm text-text-faint">
            {mode === "login" ? t("auth.login.noAccount") : t("auth.register.haveAccount")}{" "}
            <Link href={mode === "login" ? "/register" : "/login"} className="font-medium text-accent-soft hover:underline">
              {mode === "login" ? t("auth.login.toRegister") : t("auth.register.toLogin")}
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
