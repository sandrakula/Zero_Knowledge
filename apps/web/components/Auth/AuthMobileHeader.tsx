'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'

interface AuthMobileHeaderProps {
  org?: any
  welcomeText?: string
}

/**
 * Phone-sized auth header. Like the desktop panel it is always branded
 * "zerok", not with the organization's name or logo.
 */
export default function AuthMobileHeader(_props: AuthMobileHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="px-3 pt-[calc(0.75rem+var(--lh-safe-top))]">
      <div className="relative flex min-h-[176px] flex-col justify-end overflow-hidden rounded-3xl bg-[#08090a] px-5 pb-5 pt-16 text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(480px 260px at 15% 10%, rgba(198,255,74,0.18), transparent 65%), radial-gradient(420px 260px at 90% 95%, rgba(99,102,241,0.32), transparent 62%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        <div className="absolute top-2.5 end-2.5 z-10">
          <LanguageSwitcher primaryColor="#000000" />
        </div>

        <Link href="/" className="relative z-10 w-fit">
          <span className="text-[22px] font-black lowercase tracking-[-0.04em] text-white">
            zerok<span className="text-[#c6ff4a]">.</span>
          </span>
        </Link>

        <div className="relative z-10 mt-3 min-w-0">
          <p className="text-lg font-black tracking-tight text-white">
            {t('auth.branding_headline_short', { defaultValue: 'Learn. Teach. Grow.' })}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium text-white/55">
            {t('auth.branding_subtitle_short', {
              defaultValue: 'Courses, assignments and community in one place.',
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
