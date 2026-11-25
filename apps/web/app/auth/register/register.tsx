'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2, Info, Lock, Mail, User } from 'lucide-react'

import AuthLayout from '@components/Auth/AuthLayout'
import { useAuth } from '@components/Contexts/AuthContext'
import { safeRedirectUrl } from '@services/auth/redirects'

interface RegisterClientProps {
  org: any
  /** Where to go after the account is created (pre-validated by the page). */
  next?: string
}

export default function RegisterClient({ org, next }: RegisterClientProps) {
  const { t } = useTranslation()
  const { signIn } = useAuth()

  const target = safeRedirectUrl(next, '')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const inputClass =
    'box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm'

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError('')

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError(t('validation.invalid_email', { defaultValue: 'Enter a valid email address.' }))
      return
    }
    if (!password) {
      setError(t('validation.required', { defaultValue: 'This field is required' }))
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = data?.detail
        setError(
          (typeof detail === 'string' ? detail : detail?.message) ||
            t('auth.access_request_failed', { defaultValue: 'Could not create the account.' }),
        )
        return
      }

      // The account is active immediately: sign in and land on the requested
      // page (or the student cabinet). If automatic sign-in fails, the success
      // screen links to login.
      const result: any = await signIn('credentials', {
        redirect: false,
        email: cleanEmail,
        password,
        orgSlug: org?.slug,
        callbackUrl: target || '/cabinet',
      })
      if (result?.ok) {
        window.location.href = target || '/cabinet'
        return
      }
      setSent(true)
    } catch {
      setError(t('auth.access_request_failed', { defaultValue: 'Could not create the account.' }))
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout
        org={org}
        welcomeText={t('auth.request_access_title', { defaultValue: 'Request access' })}
        title={t('auth.image_title_login', { defaultValue: 'Welcome back to zerok.' })}
        subtitle={t('auth.image_subtitle_login', {
          defaultValue: 'Your courses, students, and tools are waiting.',
        })}
      >
        <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
          <div className="w-full max-w-[420px] py-10 text-center">
            <CheckCircle2 size={36} className="mx-auto text-green-600" />
            <h1 className="mt-4 text-2xl font-black text-black">
              {t('auth.register_success_title', { defaultValue: 'Account created' })}
            </h1>
            <p className="mt-3 text-sm text-black/45">
              {t('auth.register_success_body', {
                defaultValue:
                  'Your account is active with the student role. Sign in with your e-mail and password.',
              })}
            </p>
            <Link
              href={target ? `/login?next=${encodeURIComponent(target)}` : '/login'}
              className="mt-8 inline-flex h-[44px] items-center justify-center rounded-lg bg-black px-6 text-sm font-bold text-white hover:bg-black/85"
            >
              {t('auth.back_to_login', { defaultValue: 'Back to sign in' })}
            </Link>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      org={org}
      welcomeText={t('auth.request_access_title', { defaultValue: 'Request access' })}
      title={t('auth.image_title_login', { defaultValue: 'Welcome back to zerok.' })}
      subtitle={t('auth.image_subtitle_login', {
        defaultValue: 'Your courses, students, and tools are waiting.',
      })}
    >
      <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
        <div className="w-full max-w-[420px] py-10">
          <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">
            {t('auth.register_title', { defaultValue: 'Create an account' })}
          </h1>
          <p className="mt-2 text-black/45 text-[15px] font-medium">
            {t('auth.register_subtitle', {
              defaultValue: 'New accounts start with the student role and are active immediately.',
            })}
          </p>

          {error && (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                  {t('auth.first_name', { defaultValue: 'First name' })}
                </label>
                <div className="relative">
                  <User size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-black/30" />
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={`${inputClass} ps-9`}
                    autoComplete="given-name"
                    placeholder="Ivan"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                  {t('auth.last_name', { defaultValue: 'Last name' })}
                </label>
                <input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className={inputClass}
                  autoComplete="family-name"
                  placeholder="Ivanov"
                />
              </div>
            </div>

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
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
              <p className="mt-1.5 text-xs text-black/35">
                {t('auth.password_rules', {
                  defaultValue:
                    'At least 8 characters, with upper/lower case, a number and a special character.',
                })}
              </p>
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
                  {t('auth.register_submit', { defaultValue: 'Create account' })}
                  <ArrowRight size={15} />
                </span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-black/40">
            {t('auth.already_have_account', { defaultValue: 'Already have an account?' })}{' '}
            <Link
              href={target ? `/login?next=${encodeURIComponent(target)}` : '/login'}
              className="text-black font-semibold hover:underline"
            >
              {t('auth.login', { defaultValue: 'Sign in' })}
            </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}
