'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader, asArray } from '@services/utils/ts/requests'
import { getCalendarEvents } from '@services/calendar/calendar'
import { usePersonalization } from '@/lib/theme'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { CabinetFocusWidget, CabinetPersonalBanner } from './CabinetPersonalBanner'
import TeacherCabinetHome from './teacher-home'

type TrailRun = {
  id: number
  course_id?: number
  status?: string
  course?: any
  steps?: any[]
  course_total_steps?: number
  update_date?: string
}

type CalendarEvent = {
  id: string
  title: string
  start: string
  url?: string | null
}

/**
 * The cabinet is home for both learners and instructors: learners get their
 * learning view, instructors a teaching view with the same shell.
 */
export default function CabinetPage({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = React.use(params)
  const session = useLHSession() as any
  const { isAdmin, loading: rightsLoading } = useAdminStatus() as any

  // While the role is being resolved, show the full-screen loader so neither
  // view flashes before we know who is asking.
  if (rightsLoading) {
    return <PageLoading />
  }

  if (isAdmin) {
    return <TeacherCabinetHome orgslug={orgslug} />
  }
  return <StudentCabinetView orgslug={orgslug} />
}

function StudentCabinetView({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const user = session?.data?.user

  const [runs, setRuns] = useState<TrailRun[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  // Greeting is computed after mount: the server cannot know the visitor's
  // local time, and computing it during render would break hydration.
  const [greetingKey, setGreetingKey] = useState<string | null>(null)
  const { mounted, personalization } = usePersonalization()

  useEffect(() => {
    if (!token) return
    let cancelled = false

    const load = async () => {
      const now = new Date()
      const horizon = new Date(now.getTime() + 30 * 86_400_000)
      try {
        const trailPromise = fetch(
          `${getAPIUrl()}trail/`,
          RequestBodyWithAuthHeader('GET', null, null, token),
        )
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
        // The calendar is a separate endpoint (per org and date range); the
        // bare `calendar` path used to 404.
        const calendarPromise = org?.id
          ? getCalendarEvents(org.id, now, horizon, token).catch(() => [])
          : Promise.resolve([])

        const [trail, calendar] = await Promise.all([trailPromise, calendarPromise])

        if (!cancelled) {
          setRuns(asArray<TrailRun>(trail?.runs))
          setEvents(
            (Array.isArray(calendar) ? calendar : []).map((event) => ({
              id: String(event.id),
              title: event.title,
              start: event.starts_at,
              url: event.url ?? null,
            })),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [token, org?.id])

  const stats = useMemo(() => {
    const inProgress = runs.filter((run) => run.status === 'STATUS_IN_PROGRESS').length
    const completed = runs.filter((run) => run.status === 'STATUS_COMPLETED').length
    return { total: runs.length, inProgress, completed }
  }, [runs])

  useEffect(() => {
    const hour = new Date().getHours()
    setGreetingKey(
      hour < 5
        ? 'cabinet.greeting_night'
        : hour < 12
          ? 'cabinet.greeting_morning'
          : hour < 18
            ? 'cabinet.greeting_day'
            : 'cabinet.greeting_evening',
    )
  }, [])

  const progressOf = (run: TrailRun) => {
    const total = run.course_total_steps || 0
    const done = (run.steps || []).length
    if (!total) return 0
    return Math.min(100, Math.round((done / total) * 100))
  }

  const currentRun =
    runs.find((run) => run.status === 'STATUS_IN_PROGRESS' && run.course) || runs[0] || null
  const currentProgress = currentRun ? progressOf(currentRun) : 0
  const currentCourse = currentRun?.course || null
  const currentUuidRaw = currentCourse?.course_uuid || currentCourse?.uuid
  const currentUuid = currentUuidRaw ? String(currentUuidRaw).replace('course_', '') : null

  const nextEvent = useMemo(() => {
    const now = Date.now()
    const dated = events
      .map((event) => {
        const time = event.start ? new Date(event.start).getTime() : NaN
        return Number.isFinite(time) ? { event, time } : null
      })
      .filter(Boolean) as { event: CalendarEvent; time: number }[]
    dated.sort((a, b) => a.time - b.time)
    const upcoming = dated.find((entry) => entry.time >= now - 60_000)
    return upcoming || null
  }, [events])

  const daysUntilNextEvent = nextEvent
    ? Math.max(0, Math.ceil((nextEvent.time - Date.now()) / 86_400_000))
    : null

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username

  const greeting = greetingKey
    ? `${t(greetingKey)}, ${displayName || ''}`.trim()
    : displayName
      ? t('cabinet.welcome_name', { defaultValue: 'Welcome, {{name}}', name: displayName })
      : t('cabinet.welcome', { defaultValue: 'Welcome' })

  const widgets = personalization.cabinetWidgets
  const showContinueHero = !mounted || widgets.showContinueHero
  const showStatsRow = !mounted || widgets.showStatsRow
  const showDeadlines = !mounted || widgets.showDeadlines

  if (loading) {
    return <PageLoading />
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-10">
      <CabinetPersonalBanner
        orgslug={orgslug}
        eyebrow={t('cabinet.eyebrow', { defaultValue: 'My learning' })}
        greeting={greeting}
        subtitle={t('cabinet.subtitle', {
          defaultValue: 'Your courses, deadlines and progress in one place.',
        })}
        chips={
          <>
            {currentRun && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-black/60">
                <TrendingUp size={14} className="text-black/40" />
                {t('cabinet.progress_chip', {
                  defaultValue: '{{percent}}% in your current course',
                  percent: currentProgress,
                })}
              </span>
            )}
            {daysUntilNextEvent !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700">
                <Target size={14} />
                {t('cabinet.deadline_chip', {
                  defaultValue: 'Next deadline in {{days}} d.',
                  days: daysUntilNextEvent,
                })}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-black/50">
              <BookOpen size={14} className="text-black/40" />
              {stats.total} {t('cabinet.courses', { defaultValue: 'Courses' })}
            </span>
          </>
        }
      />

      <CabinetFocusWidget />

      {showContinueHero && currentRun && currentUuid && (
        <div className="mt-8 flex flex-col items-start justify-between gap-6 overflow-hidden rounded-2xl border border-neutral-800 bg-[#0b0c0d] p-6 text-white sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
              {t('cabinet.continue_learning', { defaultValue: 'Continue learning' })}
            </p>
            <p className="mt-2 truncate text-2xl font-black tracking-tight">
              {currentCourse?.name || t('cabinet.my_courses', { defaultValue: 'My courses' })}
            </p>
            <p className="mt-1 text-sm text-white/50">
              {t('cabinet.lesson_of', {
                defaultValue: 'Lesson {{current}} of {{total}}',
                current: (currentRun.steps || []).length,
                total: currentRun.course_total_steps || 0,
              })}
              {' · '}
              {currentProgress}%
            </p>
            <div className="mt-4 h-1.5 w-full max-w-[340px] overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-[#c6ff4a]" style={{ width: `${currentProgress}%` }} />
            </div>
          </div>
          <Link
            href={getUriWithOrg(orgslug, `/course/${currentUuid}`)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#c6ff4a] px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90"
          >
            {t('cabinet.continue', { defaultValue: 'Continue' })}
            <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {showStatsRow && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2 text-black/45">
              <BookOpen size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {t('cabinet.courses', { defaultValue: 'Courses' })}
              </span>
            </div>
            <p className="mt-3 text-3xl font-black text-black">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2 text-black/45">
              <Clock3 size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {t('cabinet.in_progress', { defaultValue: 'In progress' })}
              </span>
            </div>
            <p className="mt-3 text-3xl font-black text-black">{stats.inProgress}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2 text-black/45">
              <CheckCircle2 size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {t('cabinet.completed', { defaultValue: 'Completed' })}
              </span>
            </div>
            <p className="mt-3 text-3xl font-black text-black">{stats.completed}</p>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-black">
              {t('cabinet.my_courses', { defaultValue: 'My courses' })}
            </h2>
            <Link
              href={getUriWithOrg(orgslug, '/stats')}
              className="text-xs font-semibold text-black/45 hover:text-black"
            >
              {t('stats.title', { defaultValue: 'Statistics' })}
            </Link>
          </div>

          {loading && (
            <p className="mt-6 text-sm text-black/35">
              {t('common.loading', { defaultValue: 'Loading' })}
            </p>
          )}

          {!loading && runs.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-neutral-200 p-6 text-center">
              <GraduationCap size={22} className="mx-auto text-black/25" />
              <p className="mt-2 text-sm text-black/45">
                {t('cabinet.no_courses', {
                  defaultValue: 'You have not started a course yet.',
                })}
              </p>
              <Link
                href={getUriWithOrg(orgslug, '/courses')}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-black hover:underline"
              >
                {t('cabinet.find_course', { defaultValue: 'Find a course' })}
                <ArrowRight size={14} />
              </Link>
            </div>
          )}

          <ul className="mt-4 divide-y divide-neutral-100">
            {runs.map((run) => {
              const course = run.course || {}
              const uuid = course.course_uuid || course.uuid
              const title = course.name || `Course #${run.course_id}`
              const percent = progressOf(run)
              return (
                <li key={run.id} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-black">{title}</p>
                      <p className="mt-0.5 text-xs text-black/35">
                        {run.status === 'STATUS_COMPLETED'
                          ? t('cabinet.status_completed', { defaultValue: 'Completed' })
                          : t('cabinet.status_in_progress', { defaultValue: 'In progress' })}
                      </p>
                    </div>
                    {uuid && (
                      <Link
                        href={getUriWithOrg(orgslug, `/course/${uuid}`)}
                        className="shrink-0 text-xs font-semibold text-black/50 hover:text-black"
                      >
                        {t('cabinet.continue', { defaultValue: 'Open' })}
                      </Link>
                    )}
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-black" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mt-1 text-end text-[11px] text-black/30">{percent}%</p>
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="space-y-4">
          {showDeadlines && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-black/45" />
                <h2 className="text-sm font-bold text-black">
                  {t('cabinet.deadlines', { defaultValue: 'Deadlines & events' })}
                </h2>
              </div>
              {loading && <p className="mt-4 text-sm text-black/35">…</p>}
              {!loading && events.length === 0 && (
                <p className="mt-4 text-sm text-black/40">
                  {t('cabinet.no_events', { defaultValue: 'Nothing scheduled.' })}
                </p>
              )}
              <ul className="mt-4 space-y-3">
                {events.slice(0, 5).map((event, index) => (
                  <li key={event.id ?? index} className="text-sm">
                    <p className="font-medium text-black">
                      {event.title || t('cabinet.event', { defaultValue: 'Event' })}
                    </p>
                    {event.start && (
                      <p className="text-xs text-black/35">
                        {new Date(event.start).toLocaleString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Link
                href={getUriWithOrg(orgslug, '/calendar')}
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-black/45 hover:text-black"
              >
                {t('cabinet.open_calendar', { defaultValue: 'Open calendar' })}
                <ArrowRight size={12} />
              </Link>
            </section>
          )}

          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <UserRound size={16} className="text-black/45" />
              <h2 className="text-sm font-bold text-black">
                {t('cabinet.account', { defaultValue: 'Account' })}
              </h2>
            </div>
            <p className="mt-3 text-sm text-black/45">{user?.email}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={getUriWithOrg(orgslug, '/account/general')}
                className="text-xs font-semibold text-black/50 hover:text-black"
              >
                {t('cabinet.account_settings', { defaultValue: 'Account settings' })}
              </Link>
              <Link
                href={getUriWithOrg(orgslug, '/account/appearance')}
                className="text-xs font-semibold text-black/50 hover:text-black"
              >
                {t('account.appearance', { defaultValue: 'Appearance & themes' })}
              </Link>
              <Link
                href={getUriWithOrg(orgslug, '/account/security')}
                className="text-xs font-semibold text-black/50 hover:text-black"
              >
                {t('cabinet.security', { defaultValue: 'Security' })}
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

