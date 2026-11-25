'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Info, Lock, Mail } from 'lucide-react'

import AuthLayout from '@components/Auth/AuthLayout'
import { useAuth } from '@components/Contexts/AuthContext'
import { postAuthPathForSession, safeRedirectUrl } from '@services/auth/redirects'

interface LoginClientProps {
  org: any
  /** Where to go after a successful sign-in (pre-validated by the page). */
  next?: string
}

export default function LoginClient({ org, next }: LoginClientProps) {
  const { t } = useTranslation()
  const { signIn } = useAuth()

  const target = safeRedirectUrl(next, '')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError('')

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !password) {
      setError(t('validation.required', { defaultValue: 'This field is required' }))
      return
    }

    setSubmitting(true)
    try {
      const result: any = await signIn('credentials', {
        redirect: false,
        email: cleanEmail,
        password,
        orgSlug: org?.slug,
        callbackUrl: target || '/',
      })

      if (result?.ok) {
        const session = await fetch('/api/v1/users/session', {
          credentials: 'include',
          cache: 'no-store',
        })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
        window.location.href = target || postAuthPathForSession(session)
        return
      }

      let parsed: any = {}
      try {
        parsed = JSON.parse(result?.error || '{}')
      } catch {
        parsed = {}
      }

      setError(parsed?.message || t('auth.wrong_email_password', {
        defaultValue: 'Incorrect email or password.',
      }))
    } catch {
      setError(t('auth.errors.login_failed', { defaultValue: 'Sign-in failed. Please try again.' }))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm'

  return (
    <AuthLayout
      org={org}
      welcomeText={t('auth.login_to', { defaultValue: 'Sign in to your organization' })}
      title={t('auth.image_title_login', { defaultValue: 'Welcome back to zerok.' })}
      subtitle={t('auth.image_subtitle_login', {
        defaultValue: 'Your courses, students, and tools are waiting.',
      })}
    >
      <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
        <div className="w-full max-w-[420px] py-10">
          <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">
            {t('auth.welcome_back', { defaultValue: 'Welcome back' })}
          </h1>
          <p className="mt-2 text-black/45 text-[15px] font-medium">
            {t('auth.enter_credentials', { defaultValue: 'Enter your credentials to continue.' })}
          </p>

          {error && (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                {t('auth.email', { defaultValue: 'Email' })}
              </label>
              <div className="relative">
                <Mail size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-black/30" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={`${inputClass} ps-9`}
                  autoComplete="email"
                  placeholder="you@gmail.com"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                {t('auth.password', { defaultValue: 'Password' })}
              </label>
              <div className="relative">
                <Lock size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-black/30" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputClass} ps-9`}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center space-x-2">
                  <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                  <span>{t('common.loading', { defaultValue: 'Loading' })}</span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {t('auth.login', { defaultValue: 'Sign in' })}
                  <ArrowRight size={15} />
                </span>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-black/40">
            {t('auth.no_account', { defaultValue: "Don't have an account?" })}{' '}
            <Link
              href={target ? `/register?next=${encodeURIComponent(target)}` : '/register'}
              className="text-black font-semibold hover:underline"
            >
              {t('auth.sign_up', { defaultValue: 'Register' })}
            </Link>
          </div>

          <p className="mt-3 text-center text-xs text-black/30">
            {t('auth.registration_open_note', {
              defaultValue: 'Registration is open; new accounts start with the student role.',
            })}
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
