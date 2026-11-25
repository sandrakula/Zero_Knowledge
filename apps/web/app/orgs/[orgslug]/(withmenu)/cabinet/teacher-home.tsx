'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ChartNoAxesColumn,
  FolderOpen,
  PlusCircle,
  Settings,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader, asArray } from '@services/utils/ts/requests'
import { getOrgCourses } from '@services/courses/courses'
import {
  getAssignmentReviewQueue,
  type ReviewQueueItem,
} from '@services/courses/assignments'
import { formatDate } from '@/lib/format'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { isOrgFeatureEnabled } from '@/lib/org/features'
import RecentCourses from '@components/Dashboard/Home/RecentCourses'
import OnboardingHomeCard from '@components/Dashboard/Onboarding/OnboardingHomeCard'
import ContentOverview from '@components/Dashboard/Home/ContentOverview'
import RecentMembers from '@components/Dashboard/Home/RecentMembers'
import UsageOverview from '@components/Dashboard/Home/UsageOverview'
import QuickStats from '@ee/components/Analytics/Home/QuickStats'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { CabinetFocusWidget, CabinetPersonalBanner } from './CabinetPersonalBanner'

type CalendarEvent = any

/**
 * The instructor's home inside the cabinet.
 *
 * Same shell and visual language as the student cabinet, but the content is
 * the teaching surface: the instructor's courses to manage and quick links
 * into the parts of the dashboard their role allows. Admin-only entries
 * (members, org settings) appear only for admins.
 */
export default function TeacherCabinetHome({ orgslug }: { orgslug: string }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const { canManageOrg } = useAdminStatus() as any
  const token = session?.data?.tokens?.access_token
  const user = session?.data?.user

  const [courses, setCourses] = useState<any[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [queue, setQueue] = useState<ReviewQueueItem[]>([])
  const [queueLoading, setQueueLoading] = useState(true)

  useEffect(() => {
    if (!token || !org?.id) return
    let cancelled = false

    getAssignmentReviewQueue(org.id, token, 8)
      .then((res) => {
        if (!cancelled) setQueue(asArray<ReviewQueueItem>(res?.items))
      })
      .catch(() => {
        if (!cancelled) setQueue([])
      })
      .finally(() => {
        if (!cancelled) setQueueLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, org?.id])

  useEffect(() => {
    if (!token) return
    let cancelled = false

    const load = async () => {
      try {
        const [coursesRes, calendarRes] = await Promise.all([
          getOrgCourses(orgslug, null, token, true).catch(() => null),
          fetch(`${getAPIUrl()}calendar`, RequestBodyWithAuthHeader('GET', null, null, token))
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
        ])
        if (!cancelled) {
          setCourses(Array.isArray(coursesRes) ? coursesRes : asArray(coursesRes?.courses))
          setEvents(
            Array.isArray(calendarRes) ? calendarRes : asArray(calendarRes?.events),
          )
        }
      } finally {
        if (!cancelled) {
          setCoursesLoading(false)
          setEventsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [token, orgslug])

  const stats = useMemo(() => {
    const published = courses.filter((course: any) => course.published).length
    return {
      total: courses.length,
      published,
      drafts: courses.length - published,
    }
  }, [courses])

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username

  const quickLinks = [
    {
      href: '/cabinet/courses',
      label: t('cabinet.teacher_link_courses', { defaultValue: 'Courses' }),
      Icon: BookOpen,
    },
    {
      href: '/cabinet/assignments',
      label: t('cabinet.teacher_link_assignments', { defaultValue: 'Assignments' }),
      Icon: ClipboardList,
    },
    // Feature-gated: boards and the library can be switched off per org.
    ...(isOrgFeatureEnabled(org, 'boards')
      ? [
          {
            href: '/cabinet/boards',
            label: t('cabinet.teacher_link_boards', { defaultValue: 'Boards' }),
            Icon: ChartNoAxesColumn,
          },
        ]
      : []),
    ...(isOrgFeatureEnabled(org, 'folders')
      ? [
          {
            href: '/cabinet/library',
            label: t('cabinet.teacher_link_library', { defaultValue: 'Library' }),
            Icon: FolderOpen,
          },
        ]
      : []),
  ]

  if (coursesLoading && queueLoading) {
    return <PageLoading />
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-10">
      <CabinetPersonalBanner
        orgslug={orgslug}
        eyebrow={t('cabinet.teacher_eyebrow', { defaultValue: 'My teaching' })}
        greeting={
          displayName
            ? t('cabinet.welcome_name', { defaultValue: 'Welcome, {{name}}', name: displayName })
            : t('cabinet.welcome', { defaultValue: 'Welcome' })
        }
        subtitle={t('cabinet.teacher_subtitle', {
          defaultValue: 'Your courses, assignments and teaching tools in one place.',
        })}
        chips={
          quickLinks.length > 0 ? (
            <>
              {quickLinks.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={getUriWithOrg(orgslug, href)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-black/60 transition-colors hover:text-black"
                >
                  <Icon size={14} className="text-black/40" />
                  {label}
                </Link>
              ))}
            </>
          ) : undefined
        }
        actions={
          <>
            <Link
              href={getUriWithOrg(orgslug, '/cabinet/courses?new=true')}
              className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-black/85"
            >
              <PlusCircle size={16} />
              {t('dashboard.home.create_course', { defaultValue: 'Create course' })}
            </Link>
            {isOrgAnalyticsAvailable() && (
              <Link
                href={getUriWithOrg(orgslug, '/cabinet/analytics')}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-black/70 hover:text-black"
              >
                <ChartNoAxesColumn size={16} />
                {t('dashboard.home.analytics', { defaultValue: 'Analytics' })}
              </Link>
            )}
            {canManageOrg && (
              <Link
                href={getUriWithOrg(orgslug, '/cabinet/users/settings/users')}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-black/70 hover:text-black"
              >
                <Users size={16} />
                {t('dashboard.home.members', { defaultValue: 'Members' })}
              </Link>
            )}
            {canManageOrg && (
              <Link
                href={getUriWithOrg(orgslug, '/cabinet/org/settings/general')}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-black/70 hover:text-black"
              >
                <Settings size={16} />
                {t('dashboard.home.settings', { defaultValue: 'Settings' })}
              </Link>
            )}
          </>
        }
      />

      <CabinetFocusWidget />

      {/* Review queue: the teacher's most actionable block, built from the
          existing submissions API. Icons and card styling follow the cabinet. */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-black">
            <ClipboardList size={16} className="text-black/45" />
            {t('cabinet.review_queue', { defaultValue: 'Review queue' })}
            {queue.length > 0 && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-bold text-black/55">
                {queue.length}
              </span>
            )}
          </h2>
          <Link
            href={getUriWithOrg(orgslug, '/cabinet/assignments')}
            className="text-xs font-semibold text-black/45 hover:text-black"
          >
            {t('cabinet.review_all', { defaultValue: 'All assignments' })} →
          </Link>
        </div>

        {queueLoading && (
          <div className="space-y-3 px-5 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />
            ))}
          </div>
        )}

        {!queueLoading && queue.length === 0 && (
          <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <CheckCircle2 size={20} />
            </div>
            <p className="text-sm font-semibold text-black/60">
              {t('cabinet.review_empty', { defaultValue: 'Nothing to review right now.' })}
            </p>
            <p className="mt-1 text-xs text-black/35">
              {t('cabinet.review_empty_hint', {
                defaultValue: 'Submitted work shows up here automatically.',
              })}
            </p>
          </div>
        )}

        {!queueLoading && queue.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {queue.map((item) => {
              const assignmentUuid = item.assignment.assignment_uuid.replace('assignment_', '')
              const late = item.status === 'LATE'
              const initials = item.user.name
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              return (
                <li
                  key={item.submission_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:flex-nowrap"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-black/60">
                    {initials || '·'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-black">{item.user.name}</p>
                    <p className="truncate text-xs text-black/45">
                      {item.assignment.title} · {item.course.name}
                    </p>
                    {item.submitted_at && (
                      <p className="mt-0.5 text-[11px] text-black/30">
                        {formatDate(item.submitted_at, i18n.language, {
                          dateStyle: undefined,
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      late
                        ? 'bg-orange-50 text-orange-700'
                        : 'bg-[rgba(198,255,74,0.22)] text-[#4d7a00]'
                    }`}
                  >
                    {late
                      ? t('cabinet.review_overdue', { defaultValue: 'Overdue' })
                      : t('cabinet.review_pending', { defaultValue: 'Awaiting review' })}
                  </span>
                  <Link
                    href={getUriWithOrg(
                      orgslug,
                      `/cabinet/assignments/${assignmentUuid}?subpage=submissions`,
                    )}
                    className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-black/85"
                  >
                    {t('cabinet.review_check', { defaultValue: 'Review' })}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <BookOpen size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('cabinet.teacher_courses', { defaultValue: 'Courses' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <CheckCircle2 size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('cabinet.teacher_published', { defaultValue: 'Published' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{stats.published}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <ClipboardList size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('cabinet.teacher_drafts', { defaultValue: 'Drafts' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{stats.drafts}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <RecentCourses />
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-black/45" />
              <h2 className="text-sm font-bold text-black">
                {t('cabinet.deadlines', { defaultValue: 'Deadlines & events' })}
              </h2>
            </div>
            {eventsLoading && <p className="mt-4 text-sm text-black/35">…</p>}
            {!eventsLoading && events.length === 0 && (
              <p className="mt-4 text-sm text-black/40">
                {t('cabinet.no_events', { defaultValue: 'Nothing scheduled.' })}
              </p>
            )}
            <ul className="mt-4 space-y-3">
              {events.slice(0, 5).map((event, index) => (
                <li key={event.id ?? index} className="text-sm">
                  <p className="font-medium text-black">
                    {event.title || event.name || t('cabinet.event', { defaultValue: 'Event' })}
                  </p>
                  {(event.start || event.date || event.due_date) && (
                    <p className="text-xs text-black/35">
                      {new Date(event.start || event.date || event.due_date).toLocaleString()}
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

          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/35">
              {t('cabinet.account', { defaultValue: 'Account' })}
            </p>
            <p className="mt-3 truncate text-sm text-black/45">{user?.email}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={getUriWithOrg(orgslug, '/account/general')}
                className="text-xs font-semibold text-black/50 hover:text-black"
              >
                {t('cabinet.account_settings', { defaultValue: 'Account settings' })}
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

      {/* Org-management widgets: admins only. Instructors do not hold the
          users/organizations rights these panels need. */}
      {canManageOrg && (
        <div className="mt-10 space-y-6">
          <OnboardingHomeCard />
          <ContentOverview />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentMembers />
            </div>
            <div className="space-y-6">
              <UsageOverview />
              {isOrgAnalyticsAvailable() && <QuickStats />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
