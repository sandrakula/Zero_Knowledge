'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

interface AuthBrandingPanelProps {
  // Accepted for compatibility with the auth pages; the panel is intentionally
  // platform-branded ("zerok") and ignores organization theming.
  org?: any
  welcomeText?: string
  title?: string
  subtitle?: string
}

/**
 * Right-hand auth panel.
 *
 * Deliberately platform-branded: the product name is always "zerok" on the
 * sign-in screen, regardless of which organization the visitor belongs to.
 */
export default function AuthBrandingPanel(_props: AuthBrandingPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="relative h-full w-full p-6">
      <div className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-[#08090a] text-white">
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
            maskImage: 'linear-gradient(to bottom, black 0%, transparent 78%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 78%)',
          }}
        />

        <div className="relative z-10 flex h-full flex-col p-10 xl:p-14">
          <Link href="/" className="w-fit">
            <span className="text-[26px] font-black lowercase tracking-[-0.04em] text-white">
              zerok<span className="text-[#c6ff4a]">.</span>
            </span>
          </Link>

          <div className="flex flex-1 flex-col justify-center">
            <p className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c6ff4a]" />
              {t('auth.branding_eyebrow', { defaultValue: 'Learning platform' })}
            </p>
            <h2 className="max-w-md text-[40px] font-black leading-[1.05] tracking-[-0.03em] xl:text-[46px]">
              {t('auth.branding_headline_1', { defaultValue: 'Learn.' })}
              <br />
              {t('auth.branding_headline_2', { defaultValue: 'Teach.' })}
              <br />
              <span className="text-[#c6ff4a]">
                {t('auth.branding_headline_3', { defaultValue: 'Grow.' })}
              </span>
            </h2>
            <p className="mt-6 max-w-sm text-[15px] font-medium leading-relaxed text-white/50">
              {t('auth.branding_subtitle', {
                defaultValue:
                  'Courses, assignments, community and collaboration — in one calm space.',
              })}
            </p>
          </div>

          <div className="flex items-end justify-between gap-6 border-t border-white/10 pt-6">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                zerok
              </p>
              <p className="text-sm font-medium text-white/50">
                {t('auth.branding_footer', { defaultValue: 'Learning without the noise.' })}
              </p>
            </div>
            <div className="hidden gap-2 sm:flex">
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-white/40">
                {t('auth.branding_tag_courses', { defaultValue: 'Courses' })}
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-white/40">
                {t('auth.branding_tag_assignments', { defaultValue: 'Assignments' })}
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-white/40">
                {t('auth.branding_tag_community', { defaultValue: 'Community' })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
