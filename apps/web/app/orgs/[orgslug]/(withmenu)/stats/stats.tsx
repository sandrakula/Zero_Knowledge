'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Code2,
  Plus,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader, asArray } from '@services/utils/ts/requests'
import { getCalendarEvents } from '@services/calendar/calendar'
import { getOrgCourses } from '@services/courses/courses'
import {
  addContest,
  addDefense,
  deleteContest,
  getGlobalStats,
  getLeaderboard,
  getMyStats,
  listMyContests,
  type ContestEntry,
  type GlobalStats,
  type Leaderboard,
  type MyStats,
  type StatsPeriod,
} from '@services/stats/stats'
import { formatDate } from '@/lib/format'
import {
  getInformaticsStatistics,
  type InformaticsStatistics,
} from '@services/informatics/informatics'
import CourseStatDetailPanel from './CourseStatDetail'

type TrailRun = {
  id: number
  status?: string
  course?: any
  steps?: any[]
  course_total_steps?: number
}

const PERIODS: StatsPeriod[] = ['week', 'month', 'all']

export default function StatsClient({ orgslug }: { orgslug: string }) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const { isAdmin, rights } = useAdminStatus() as any
  const token = session?.data?.tokens?.access_token
  const user = session?.data?.user

  const [period, setPeriod] = useState<StatsPeriod>('month')
  const [scope, setScope] = useState<'organization' | 'course'>('organization')
  const [courseUuid, setCourseUuid] = useState<string | null>(null)
  const [stats, setStats] = useState<MyStats | null>(null)
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [informaticsStats, setInformaticsStats] = useState<InformaticsStatistics | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  const [contests, setContests] = useState<ContestEntry[]>([])
  const [runs, setRuns] = useState<TrailRun[]>([])
  const [orgCourses, setOrgCourses] = useState<any[]>([])
  const [boardMetric, setBoardMetric] = useState<'score' | 'defenses' | 'contests'>('score')
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [contestTitle, setContestTitle] = useState('')
  const [contestDate, setContestDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState<{
    uuid: string
    name: string
  } | null>(null)

  // Courses the user actually studies (for the course-scope selector).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const now = new Date()
    const horizon = new Date(now.getTime() + 30 * 86_400_000)
    Promise.all([
      fetch(`${getAPIUrl()}trail/`, RequestBodyWithAuthHeader('GET', null, null, token))
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      org?.id
        ? getCalendarEvents(org.id, now, horizon, token).catch(() => [])
        : Promise.resolve([]),
    ]).then(([trail, calendar]) => {
      if (cancelled) return
      const nextRuns = asArray<TrailRun>(trail?.runs)
      setRuns(nextRuns)
      setEvents(
        (Array.isArray(calendar) ? calendar : []).map((event) => ({
          id: String(event.id),
          title: event.title,
          start: event.starts_at,
          url: event.url ?? null,
        })),
      )
      const firstUuid = nextRuns.find((run) => run.course?.course_uuid)?.course?.course_uuid
      if (firstUuid) setCourseUuid((current) => current || String(firstUuid))
    })
    return () => {
      cancelled = true
    }
  }, [token, org?.id])

  const activeCourseUuid = scope === 'course' ? courseUuid : null

  useEffect(() => {
    if (!token || !org?.id) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      getMyStats(org.id, token, period, activeCourseUuid).catch(() => null),
      getLeaderboard(org.id, token, period, activeCourseUuid).catch(() => null),
      listMyContests(org.id, token, period).catch(() => ({ items: [] })),
      getInformaticsStatistics(token, {
        period,
        course_uuid: activeCourseUuid,
      }).catch(() => null),
      getGlobalStats(org.id, token, null, period).catch(() => null),
    ])
      .then(([nextStats, nextLeaderboard, nextContests, nextInformatics, nextGlobal]) => {
        if (cancelled) return
        setStats(nextStats)
        setLeaderboard(nextLeaderboard)
        setContests(asArray<ContestEntry>(nextContests?.items))
        setInformaticsStats(nextInformatics)
        setGlobalStats(nextGlobal)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, org?.id, period, activeCourseUuid])

  const refresh = async () => {
    if (!token || !org?.id) return
    const [nextStats, nextLeaderboard, nextContests, nextInformatics, nextGlobal] = await Promise.all([
      getMyStats(org.id, token, period, activeCourseUuid).catch(() => null),
      getLeaderboard(org.id, token, period, activeCourseUuid).catch(() => null),
      listMyContests(org.id, token, period).catch(() => ({ items: [] })),
      getInformaticsStatistics(token, {
        period,
        course_uuid: activeCourseUuid,
      }).catch(() => null),
      getGlobalStats(org.id, token, null, period).catch(() => null),
    ])
    setStats(nextStats)
    setLeaderboard(nextLeaderboard)
    setContests(asArray<ContestEntry>(nextContests?.items))
    setInformaticsStats(nextInformatics)
    setGlobalStats(nextGlobal)
  }

  useEffect(() => {
    if (!token || !isAdmin) return
    let cancelled = false
    getOrgCourses(orgslug, null, token, true)
      .then((courses: any) => {
        if (cancelled) return
        const list = Array.isArray(courses) ? courses : []
        setOrgCourses(list)
        const first = list.find((course: any) => course.course_uuid)?.course_uuid
        if (first) setCourseUuid((current) => current || String(first))
      })
      .catch(() => {
        if (!cancelled) setOrgCourses([])
      })
    return () => {
      cancelled = true
    }
  }, [token, isAdmin, orgslug])

  const courseOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { uuid: string; name: string }[] = []
    for (const run of runs) {
      const uuid = run.course?.course_uuid
      if (!uuid || seen.has(uuid)) continue
      seen.add(uuid)
      options.push({ uuid: String(uuid), name: run.course?.name || t('stats.course', { defaultValue: 'Course' }) })
    }
    // Staff often teach courses they are not enrolled in.
    for (const course of orgCourses) {
      const uuid = course.course_uuid
      if (!uuid || seen.has(uuid)) continue
      seen.add(uuid)
      options.push({ uuid: String(uuid), name: course.name || t('stats.course', { defaultValue: 'Course' }) })
    }
    return options
  }, [runs, orgCourses, t])

  const upcoming = useMemo(() => {
    const now = Date.now()
    return events
      .map((event) => {
        const raw = event?.start
        const time = raw ? new Date(raw).getTime() : NaN
        return Number.isFinite(time) ? { event, time } : null
      })
      .filter(Boolean)
      .filter((entry: any) => entry.time >= now - 60_000)
      .sort((a: any, b: any) => a.time - b.time)
      .slice(0, 5) as { event: any; time: number }[]
  }, [events])

  const breakdown = stats?.breakdown
  const regularShare = breakdown && breakdown.total_weeks
    ? Math.round((breakdown.active_weeks / breakdown.total_weeks) * 100)
    : 0

  // Course-scope scores renormalize the weights (contests are organization
  // level), so the maxima for the bars change too.
  const weightSum = scope === 'course' ? 0.95 : 1
  const componentMax = {
    regularity: (100 * 0.35) / weightSum,
    defenses: (100 * 0.3) / weightSum,
    solved: (100 * 0.3) / weightSum,
    contests: (100 * 0.05) / weightSum,
  }

  const rankedItems = useMemo(() => {
    const items = leaderboard?.items ? [...leaderboard.items] : []
    if (boardMetric === 'score') return items
    const key = boardMetric === 'defenses' ? 'defenses' : 'contests'
    return items
      .sort((a, b) => b[key] - a[key] || b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }))
  }, [leaderboard, boardMetric])

  const meInList = Boolean(
    leaderboard?.me && rankedItems.some((entry) => entry.user_id === leaderboard.me?.user_id),
  )

  const addContestEntry = async () => {
    if (!token || !org?.id || busy) return
    setBusy(true)
    try {
      await addContest(org.id, token, {
        title: contestTitle.trim(),
        happened_on: contestDate,
      })
      setContestTitle('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const removeContest = async (id: number) => {
    if (!token || !org?.id || busy) return
    setBusy(true)
    try {
      await deleteContest(org.id, token, id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const markDefense = async (userId: number) => {
    if (!token || !org?.id || busy || !activeCourseUuid) return
    setBusy(true)
    try {
      await addDefense(org.id, token, {
        user_id: userId,
        course_uuid: activeCourseUuid,
        note: 'Cabinet defense',
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const periodLabel = (value: StatsPeriod) =>
    value === 'week'
      ? t('stats.period_week', { defaultValue: 'Week' })
      : value === 'month'
        ? t('stats.period_month', { defaultValue: 'Month' })
        : t('stats.period_all', { defaultValue: 'All time' })

  const courseStatusLabel = (status: string) =>
    status === 'locked'
      ? t('stats.status_locked', { defaultValue: 'Закрыт' })
      : status === 'available'
        ? t('stats.status_available', { defaultValue: 'Доступен' })
        : status === 'completed'
          ? t('stats.status_completed', { defaultValue: 'Завершён' })
          : t('stats.status_in_progress', { defaultValue: 'В процессе' })

  const courseStatusClass = (status: string) =>
    status === 'locked'
      ? 'border-neutral-200 bg-neutral-100 text-neutral-500'
      : status === 'available'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'completed'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-sky-200 bg-sky-50 text-sky-700'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/35">
            {t('stats.eyebrow', { defaultValue: 'Progress' })}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-black">
            {t('stats.title', { defaultValue: 'Statistics' })}
          </h1>
          <p className="mt-1 text-sm text-black/45">
            {t('stats.subtitle', {
              defaultValue: 'Regular practice, defenses and deadlines in one place.',
            })}
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={`px-3.5 py-2 text-xs font-bold transition-colors ${
                period === value ? 'bg-black text-white' : 'text-black/50 hover:text-black'
              }`}
            >
              {periodLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {/* Global weighted KPI across the programme. */}
      {globalStats && (
        <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="flex flex-col gap-5 border-b border-neutral-100 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-black/35">
                {t('stats.global_kpi', { defaultValue: 'Общий KPI' })}{' '}
                <span className="font-normal normal-case tracking-normal text-black/30">
                  {periodLabel(period)}
                </span>
              </p>
              <p className="mt-1 text-5xl font-black tracking-tight text-black tabular-nums">
                {Math.round(globalStats.global_kpi)}
              </p>
              <p className="mt-1 text-xs text-black/40">
                {t('stats.global_kpi_hint', {
                  defaultValue: 'Взвешенный KPI по курсам программы',
                })}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 sm:gap-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/35">
                  {t('stats.coverage', { defaultValue: 'Охват' })}
                </p>
                <p className="mt-1 text-xl font-black text-black tabular-nums">
                  {Math.round(globalStats.coverage)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/35">
                  {t('stats.active_days', { defaultValue: 'Активных дней' })}
                </p>
                <p className="mt-1 text-xl font-black text-black tabular-nums">
                  {globalStats.active_days}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/35">
                  {t('stats.courses_started', { defaultValue: 'Курсов начато' })}
                </p>
                <p className="mt-1 text-xl font-black text-black tabular-nums">
                  {globalStats.courses_started}/{globalStats.courses_included}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {globalStats.courses.map((course) => (
              <button
                key={course.course_uuid}
                type="button"
                onClick={() =>
                  setSelectedCourse({ uuid: course.course_uuid, name: course.name })
                }
                className={`rounded-xl border border-neutral-200 bg-white p-3 text-start transition-colors hover:border-black/25 hover:bg-neutral-50 ${
                  course.status === 'locked' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-black">
                      {course.sequence_order}. {course.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-black/40">
                      {t('stats.course_weight', { defaultValue: 'Вес' })}: {course.weight}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${courseStatusClass(
                      course.status,
                    )}`}
                  >
                    {courseStatusLabel(course.status)}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <p className="text-2xl font-black tabular-nums text-black">
                    {Math.round(course.course_kpi)}
                  </p>
                  <p className="text-[11px] font-semibold text-black/40 tabular-nums">
                    {Math.round(course.course_percent)}%
                  </p>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-[#c6ff4a]"
                    style={{ width: `${Math.min(100, Math.max(0, course.course_percent))}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-black/35">
                  {course.included
                    ? `${t('stats.course_contribution', {
                        defaultValue: 'Вклад в KPI',
                      })}: ${course.contribution}`
                    : t('stats.course_excluded', {
                        defaultValue: 'Не входит в общий KPI',
                      })}
                </p>
                <p className="mt-1.5 text-[10px] font-semibold text-black/30">
                  {t('stats.detail_open', { defaultValue: 'Подробнее' })} →
                </p>
              </button>
            ))}
          </div>
          <p className="px-5 pb-4 text-[11px] leading-relaxed text-black/35">
            {t('stats.global_note', {
              defaultValue:
                'Закрытые курсы не входят в общий KPI. Открытые, но ещё не начатые курсы входят с KPI 0.',
            })}
          </p>
        </section>
      )}

      {/* Legacy period metrics. These feed the old leaderboard and do not
          participate in the programme KPI above. */}
      <div className="mt-10 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-black">
            {t('stats.period_metrics', { defaultValue: 'Метрики за период' })}
          </h2>
          <p className="mt-0.5 text-xs text-black/40">
            {t('stats.period_metrics_hint', {
              defaultValue:
                'Учитывают выбранный период и не входят в общий KPI программы.',
            })}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <Trophy size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('stats.activity_score', { defaultValue: 'Баллы активности' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{loading ? '—' : Math.round(stats?.score || 0)}</p>
          <p className="mt-1 text-xs text-black/35">
            {t('stats.kpi_regularity', { defaultValue: 'Regularity' })}: {regularShare}%
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <TrendingUp size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('stats.kpi_rank', { defaultValue: 'Rank' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">
            {stats?.rank ? `#${stats.rank}` : '—'}
          </p>
          <p className="mt-1 text-xs text-black/35">
            {t('stats.of_participants', {
              defaultValue: 'of {{count}}',
              count: stats?.participants || 0,
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <ShieldCheck size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('stats.kpi_defenses', { defaultValue: 'Defenses' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{breakdown?.defense_count ?? 0}</p>
          <p className="mt-1 text-xs text-black/35">
            {t('stats.kpi_conversion', { defaultValue: 'Converted to defense' })}:{' '}
            {Math.round((breakdown?.conversion || 0) * 100)}%
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-black/45">
            <CheckCircle2 size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t('stats.kpi_solved', { defaultValue: 'Tasks solved' })}
            </span>
          </div>
          <p className="mt-3 text-3xl font-black text-black">{breakdown?.solved_count ?? 0}</p>
          <p className="mt-1 text-xs text-black/35">
            {t('stats.kpi_contests', { defaultValue: 'Contests' })}: {breakdown?.contest_count ?? 0}
          </p>
        </div>
      </div>

      {/* Informatics (informatics.msk.ru) */}
      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-black">
              <Code2 size={16} className="text-black/45" />
              {t('stats.informatics_title', { defaultValue: 'Informatics' })}
            </h2>
            <p className="mt-1 text-xs text-black/40">
              {t('stats.informatics_subtitle', {
                defaultValue: 'Задачи и попытки на informatics.msk.ru',
              })}
            </p>
          </div>
          <Link
            href={getUriWithOrg(orgslug, '/account/informatics')}
            className="text-xs font-semibold text-black/45 transition-colors hover:text-black"
          >
            {t('stats.informatics_setup', { defaultValue: 'Настроить' })} →
          </Link>
        </div>

        {informaticsStats && informaticsStats.total_attempts > 0 ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: t('stats.informatics_solved', { defaultValue: 'Решено' }),
                  value: informaticsStats.solved_problems,
                },
                {
                  label: t('stats.informatics_attempts', { defaultValue: 'Попыток' }),
                  value: informaticsStats.total_attempts,
                },
                {
                  label: t('stats.informatics_accepted', { defaultValue: 'Зачтено' }),
                  value: informaticsStats.accepted_attempts,
                },
                {
                  label: t('stats.informatics_avg_score', { defaultValue: 'Средний балл' }),
                  value:
                    informaticsStats.average_score === null
                      ? '—'
                      : Math.round(informaticsStats.average_score),
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">
                    {item.label}
                  </p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-black">{item.value}</p>
                </div>
              ))}
            </div>

            {Object.keys(informaticsStats.by_verdict).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {Object.entries(informaticsStats.by_verdict).map(([verdict, count]) => (
                  <span
                    key={verdict}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      verdict === 'ACCEPTED'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-neutral-200 bg-neutral-50 text-black/55'
                    }`}
                  >
                    {verdict}: {count}
                  </span>
                ))}
              </div>
            )}

            {informaticsStats.last_activity && (
              <p className="mt-3 text-[11px] text-black/35">
                {t('stats.informatics_last_activity', { defaultValue: 'Последняя активность' })}:{' '}
                {formatDate(informaticsStats.last_activity, i18n.language)}
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-xs text-black/45">
            {t('stats.informatics_empty', {
              defaultValue: 'Пока нет попыток в Informatics.',
            })}
          </p>
        )}
      </section>

      {/* Score breakdown */}
      {breakdown && (
        <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-black">
              {t('stats.breakdown_title', { defaultValue: 'How the score is built' })}
            </h2>
            <span className="text-xs text-black/35">
              {t('stats.breakdown_note', { defaultValue: 'Regularity matters most' })}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              {
                label: t('stats.kpi_regularity', { defaultValue: 'Regularity' }),
                points: breakdown.regularity,
                max: componentMax.regularity,
                hint: `${breakdown.active_weeks}/${Number(breakdown.total_weeks.toFixed(1))}`,
              },
              {
                label: t('stats.kpi_defenses', { defaultValue: 'Defenses' }),
                points: breakdown.defenses,
                max: componentMax.defenses,
                hint: `${Math.round((breakdown.conversion || 0) * 100)}% ${t('stats.kpi_conversion', { defaultValue: 'converted' })}`,
              },
              {
                label: t('stats.kpi_solved', { defaultValue: 'Tasks solved' }),
                points: breakdown.solved,
                max: componentMax.solved,
                hint: `${breakdown.solved_count}`,
              },
              {
                label: t('stats.kpi_contests', { defaultValue: 'Contests' }),
                points: breakdown.contests,
                max: componentMax.contests,
                hint: t('stats.contests_note_short', { defaultValue: 'small weight' }),
              },
            ].map((part) => (
              <div key={part.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-black/60">{part.label}</span>
                  <span className="text-black/35">
                    {Math.round(part.points)}/{Math.round(part.max)} · {part.hint}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-[#c6ff4a]"
                    style={{ width: `${Math.min(100, (part.points / Math.max(1, part.max)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Leaderboard */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-black">
            <Award size={16} className="text-black/45" />
            {t('stats.leaderboard', { defaultValue: 'Leaderboard' })}
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-bold text-black/55">
              {leaderboard?.participants ?? 0}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-neutral-200">
              {(['score', 'defenses', 'contests'] as const).map((metric) => {
                if (metric === 'contests' && scope === 'course') return null
                const label =
                  metric === 'score'
                    ? t('stats.kpi_score', { defaultValue: 'Score' })
                    : metric === 'defenses'
                      ? t('stats.kpi_defenses', { defaultValue: 'Defenses' })
                      : t('stats.kpi_contests', { defaultValue: 'Contests' })
                return (
                  <button
                    key={metric}
                    type="button"
                    onClick={() => setBoardMetric(metric)}
                    className={`px-3 py-1.5 text-xs font-bold ${
                      boardMetric === metric ? 'bg-black text-white' : 'text-black/50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="inline-flex overflow-hidden rounded-lg border border-neutral-200">
              <button
                type="button"
                onClick={() => setScope('organization')}
                className={`px-3 py-1.5 text-xs font-bold ${
                  scope === 'organization' ? 'bg-black text-white' : 'text-black/50'
                }`}
              >
                {t('stats.organization', { defaultValue: 'Organization' })}
              </button>
              <button
                type="button"
                onClick={() => setScope('course')}
                className={`px-3 py-1.5 text-xs font-bold ${
                  scope === 'course' ? 'bg-black text-white' : 'text-black/50'
                }`}
              >
                {t('stats.course', { defaultValue: 'Course' })}
              </button>
            </div>
            {scope === 'course' && courseOptions.length > 0 && (
              <select
                value={courseUuid || ''}
                onChange={(event) => setCourseUuid(event.target.value || null)}
                className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-black/70"
              >
                {courseOptions.map((option) => (
                  <option key={option.uuid} value={option.uuid}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {scope === 'course' && courseOptions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-black/40">
            {t('stats.no_course', { defaultValue: 'You are not enrolled in a course yet.' })}
          </p>
        ) : leaderboard && leaderboard.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-start text-[11px] uppercase tracking-wide text-black/35">
                  <th className="px-5 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">{t('stats.student', { defaultValue: 'Student' })}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('stats.kpi_score', { defaultValue: 'КПД' })}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('stats.kpi_defenses', { defaultValue: 'Defenses' })}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('stats.kpi_solved', { defaultValue: 'Solved' })}</th>
                  {scope === 'course' && isAdmin && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rankedItems.map((entry) => {
                  const isMe = entry.user_id === user?.id
                  return (
                    <tr key={entry.user_id} className={isMe ? 'bg-neutral-50' : ''}>
                      <td className="px-5 py-3 font-bold text-black/50">{entry.rank}</td>
                      <td className="px-3 py-3">
                        <span className={`font-semibold ${isMe ? 'text-black' : 'text-black/75'}`}>
                          {entry.name}
                          {isMe && (
                            <span className="ms-2 rounded-full bg-black px-2 py-0.5 text-[10px] font-bold text-white">
                              {t('stats.you', { defaultValue: 'you' })}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-black text-black">{Math.round(entry.score)}</td>
                      <td className="px-3 py-3 text-black/60">{entry.defenses}</td>
                      <td className="px-3 py-3 text-black/60">{entry.solved}</td>
                      {scope === 'course' && isAdmin && (
                        <td className="px-3 py-3 text-end">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => markDefense(entry.user_id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-bold text-black/60 hover:text-black disabled:opacity-40"
                          >
                            <ShieldCheck size={12} />
                            {t('stats.add_defense', { defaultValue: 'Defense' })}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              {leaderboard?.me && !meInList && (
                <tfoot>
                  <tr className="border-t border-neutral-200 bg-neutral-50">
                    <td className="px-5 py-3 font-bold text-black/50">{leaderboard.me.rank}</td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-black">
                        {leaderboard.me.name}
                        <span className="ms-2 rounded-full bg-black px-2 py-0.5 text-[10px] font-bold text-white">
                          {t('stats.you', { defaultValue: 'you' })}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 font-black text-black">{Math.round(leaderboard.me.score)}</td>
                    <td className="px-3 py-3 text-black/60">{leaderboard.me.defenses}</td>
                    <td className="px-3 py-3 text-black/60">{leaderboard.me.solved}</td>
                    {scope === 'course' && isAdmin && <td className="px-3 py-3" />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-black/40">
            {loading ? t('common.loading', { defaultValue: 'Loading' }) : t('stats.empty_board', { defaultValue: 'No activity in this period yet.' })}
          </p>
        )}
      </section>

      {/* Progress + deadlines */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-black">
              <BookOpen size={16} className="text-black/45" />
              {t('stats.my_courses', { defaultValue: 'My courses' })}
            </h2>
            <Link
              href={getUriWithOrg(orgslug, '/courses')}
              className="text-xs font-semibold text-black/45 hover:text-black"
            >
              {t('stats.all_courses', { defaultValue: 'All courses' })} →
            </Link>
          </div>
          {runs.length === 0 && (
            <p className="mt-4 text-sm text-black/40">
              {t('stats.no_progress', { defaultValue: 'No courses started yet.' })}
            </p>
          )}
          <ul className="mt-2 divide-y divide-neutral-100">
            {runs.map((run) => {
              const course = run.course || {}
              const total = run.course_total_steps || 0
              const done = (run.steps || []).length
              const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0
              const uuid = course.course_uuid ? String(course.course_uuid).replace('course_', '') : null
              return (
                <li key={run.id} className="py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-black">
                        {course.name || t('stats.course', { defaultValue: 'Course' })}
                      </p>
                      <p className="mt-0.5 text-xs text-black/35">
                        {t('cabinet.lesson_of', {
                          defaultValue: 'Lesson {{current}} of {{total}}',
                          current: done,
                          total,
                        })}{' '}
                        · {percent}%
                      </p>
                    </div>
                    {uuid && (
                      <Link
                        href={getUriWithOrg(orgslug, `/course/${uuid}`)}
                        className="shrink-0 text-xs font-semibold text-black/50 hover:text-black"
                      >
                        {t('cabinet.continue', { defaultValue: 'Continue' })}
                      </Link>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-[#c6ff4a]" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-black">
              <CalendarDays size={16} className="text-black/45" />
              {t('stats.deadlines', { defaultValue: 'Deadlines' })}
            </h2>
            {upcoming.length === 0 && (
              <p className="mt-4 text-sm text-black/40">
                {t('cabinet.no_events', { defaultValue: 'Nothing scheduled.' })}
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {upcoming.map(({ event, time }) => (
                <li key={event.id || time} className="text-sm">
                  <p className="font-medium text-black">
                    {event.title || t('cabinet.event', { defaultValue: 'Event' })}
                  </p>
                  <p className="text-xs text-black/35">
                    {new Date(time).toLocaleString(i18n.language)}
                  </p>
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
        </aside>
      </div>

      {/* Contests (self-reported, small weight) */}
      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-black/45" />
          <h2 className="text-sm font-bold text-black">
            {t('stats.contests', { defaultValue: 'Contests' })}
          </h2>
        </div>
        <p className="mt-1 text-xs text-black/40">
          {t('stats.contests_note', {
            defaultValue: 'Self-reported: small weight, does not affect regularity.',
          })}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-black/45">
            {t('stats.contest_date', { defaultValue: 'Date' })}
            <input
              type="date"
              value={contestDate}
              onChange={(event) => setContestDate(event.target.value)}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-black"
            />
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[11px] font-semibold text-black/45">
            {t('stats.contest_title', { defaultValue: 'Contest (optional)' })}
            <input
              value={contestTitle}
              onChange={(event) => setContestTitle(event.target.value)}
              placeholder={t('stats.contest_placeholder', { defaultValue: 'e.g. school olympiad' })}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-black"
            />
          </label>
          <button
            type="button"
            onClick={addContestEntry}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-black/85 disabled:opacity-40"
          >
            <Plus size={14} />
            {t('stats.contest_add', { defaultValue: 'Add' })}
          </button>
        </div>

        {contests.length > 0 && (
          <ul className="mt-4 divide-y divide-neutral-100">
            {contests.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-black">
                    {entry.title || t('stats.contests', { defaultValue: 'Contests' })}
                  </p>
                  <p className="text-xs text-black/35">
                    {formatDate(entry.happened_on, i18n.language, { dateStyle: 'medium' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeContest(entry.id)}
                  disabled={busy}
                  aria-label={t('common.delete', { defaultValue: 'Delete' })}
                  className="rounded-lg p-2 text-black/30 hover:bg-neutral-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedCourse && token && org?.id && (
        <CourseStatDetailPanel
          key={selectedCourse.uuid}
          orgId={org.id}
          token={token}
          courseUuid={selectedCourse.uuid}
          courseName={selectedCourse.name}
          period={period}
          isStaff={Boolean(
            isAdmin ||
              rights?.courses?.action_update ||
              rights?.courses?.action_update_own ||
              rights?.courses?.action_create,
          )}
          onClose={() => setSelectedCourse(null)}
        />
      )}
    </div>
  )
}
