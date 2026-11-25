'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { homePathForSession } from '@/lib/auth/home'
import { safeInternalPath } from '@services/security/url'

interface WelcomeClientProps {
  /** Where to continue after signing in (already validated by the proxy). */
  next?: string
}

/**
 * Public welcome screen.
 *
 * Everything behind the sign-in is gated: this page is the only thing a guest
 * sees, with two ways in — sign in or create an account (which is free and
 * instantly active with the student role).
 */
export default function WelcomeClient({ next }: WelcomeClientProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any

  const target = next ? safeInternalPath(next, '') : ''
  const loginHref = target ? `/login?next=${encodeURIComponent(target)}` : '/login'
  const registerHref = target ? `/register?next=${encodeURIComponent(target)}` : '/register'

  // A session that was still unresolved on the server (refresh-cookie only)
  // resolves here; the moment it is real, leave the welcome screen.
  useEffect(() => {
    if (session?.status === 'authenticated') {
      window.location.href = homePathForSession(session.data)
    }
  }, [session?.status, session?.data])

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#08090a] text-white">
      {/* Ambient light */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 520px at 18% 12%, rgba(198,255,74,0.16), transparent 62%), radial-gradient(700px 520px at 88% 88%, rgba(99,102,241,0.28), transparent 60%)',
        }}
      />
      {/* Fine grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="w-fit">
          <span className="text-[26px] font-black lowercase tracking-[-0.04em] text-white">
            zerok<span className="text-[#c6ff4a]">.</span>
          </span>
        </Link>
        <Link
          href={loginHref}
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5 hover:text-white"
        >
          {t('welcome.sign_in', { defaultValue: 'Sign in' })}
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c6ff4a]" />
          {t('auth.branding_eyebrow', { defaultValue: 'Learning platform' })}
        </p>
        <h1 className="max-w-2xl text-[42px] font-black leading-[1.05] tracking-[-0.03em] sm:text-[56px]">
          {t('auth.branding_headline_short', { defaultValue: 'Learn. Teach. Grow.' })}
        </h1>
        <p className="mt-6 max-w-md text-[15px] font-medium leading-relaxed text-white/50">
          {t('auth.branding_subtitle', {
            defaultValue:
              'Courses, assignments, community and collaboration — in one calm space.',
          })}
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href={loginHref}
            className="inline-flex h-[48px] w-full items-center justify-center rounded-xl bg-white px-7 text-sm font-bold text-black transition-opacity hover:opacity-90 sm:w-auto"
          >
            {t('welcome.sign_in', { defaultValue: 'Sign in' })}
          </Link>
          <Link
            href={registerHref}
            className="inline-flex h-[48px] w-full items-center justify-center rounded-xl border border-white/15 px-7 text-sm font-bold text-white/90 transition-colors hover:bg-white/5 sm:w-auto"
          >
            {t('welcome.create_account', { defaultValue: 'Create account' })}
          </Link>
        </div>

        <p className="mt-8 max-w-sm text-xs leading-relaxed text-white/35">
          {t('welcome.gate_note', {
            defaultValue:
              'The cabinet opens after you sign in or create an account. Registration is free and starts you off with the student role.',
          })}
        </p>
      </main>
    </div>
  )
}
