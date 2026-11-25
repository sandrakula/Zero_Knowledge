'use client'

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  Flame,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

type FeedItem = {
  task_uuid: string
  title: string
  assignment_type: string
  activity_uuid: string
  topic_key: string
  topic_name: string
  level: number
  estimated_minutes: number
  reason: string
  mastery: number
  expected_success: number
  xp: number
}

type Feed = {
  course_uuid: string
  goal_xp: number
  planned_xp: number
  items_count: number
  items: FeedItem[]
}

type PracticeState = {
  course_uuid: string
  summary: {
    topics_started: number
    topics_mastered: number
    average_mastery: number
    attempts: number
    active_days: number
    streak_days: number
    goal_xp: number
  }
  topics: {
    topic_key: string
    topic_name: string
    mastery: number
    confidence: number
    attempts: number
    passed: number
    next_review_at: string
  }[]
}

const REASON_STYLES: Record<
  string,
  { label: string; className: string; Icon: React.ElementType }
> = {
  new: {
    label: 'Новая тема',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    Icon: Sparkles,
  },
  weak: {
    label: 'Слабая тема',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    Icon: Target,
  },
  review: {
    label: 'Пора повторить',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
    Icon: RefreshCw,
  },
  stretch: {
    label: 'На вырост',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Icon: TrendingUp,
  },
  practice: {
    label: 'Практика',
    className: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    Icon: Clock3,
  },
}

const LEVEL_LABELS: Record<number, string> = {
  1: 'Уровень 1 · база',
  2: 'Уровень 2 · уверенно',
  3: 'Уровень 3 · сложно',
}

function cleanUUID(value: string): string {
  return value.startsWith('course_') ? value.slice('course_'.length) : value
}

function asCourseUUID(value: string): string {
  return value.startsWith('course_') ? value : `course_${value}`
}

export default function PracticeClient({
  orgslug,
  courseuuid,
}: {
  orgslug: string
  courseuuid: string
}) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const authenticated = session?.status === 'authenticated'
  const courseUUID = asCourseUUID(courseuuid)
  const clean = cleanUUID(courseuuid)

  const feed = useQuery<Feed>({
    queryKey: ['practice', 'today', courseUUID],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}practice/today?course_uuid=${encodeURIComponent(courseUUID)}&limit=10`,
        token
      ),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  })

  const state = useQuery<PracticeState>({
    queryKey: ['practice', 'state', courseUUID],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}practice/state?course_uuid=${encodeURIComponent(courseUUID)}`,
        token
      ),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  })

  const summary = state.data?.summary
  const masteryPercent = Math.round((summary?.average_mastery ?? 0) * 100)
  const plannedXp = feed.data?.planned_xp ?? 0

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href={getUriWithOrg(orgslug, `/course/${clean}`)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/50 transition-colors hover:text-black"
      >
        <ArrowLeft size={15} />
        Назад к курсу
      </Link>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
            Персональная практика
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-black">
            Сегодня
          </h1>
          <p className="mt-1 text-sm text-black/45">
            Задачи подобраны по вашему уровню: слабые темы, повторения и немного
            задач на вырост.
          </p>
        </div>
        {summary && (
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5">
            <Target size={16} className="text-black/45" />
            <span className="text-sm font-bold text-black">
              {plannedXp} / {summary.goal_xp || 40} XP
            </span>
          </div>
        )}
      </div>

      {!authenticated && (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <p className="text-sm text-black/60">
            Войдите, чтобы получать персональную ленту задач и видеть прогресс по
            темам.
          </p>
          <Link
            href={getUriWithOrg(orgslug, '/login')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white"
          >
            Войти
            <ChevronRight size={15} />
          </Link>
        </div>
      )}

      {authenticated && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              label="Средняя освоенность"
              value={`${masteryPercent}%`}
              Icon={TrendingUp}
            />
            <SummaryCard
              label="Темы освоены"
              value={`${summary?.topics_mastered ?? 0} / ${summary?.topics_started ?? 0}`}
              Icon={Target}
            />
            <SummaryCard
              label="Серия"
              value={`${summary?.streak_days ?? 0} дн.`}
              Icon={Flame}
            />
            <SummaryCard
              label="Попыток"
              value={`${summary?.attempts ?? 0}`}
              Icon={Clock3}
            />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-black">
              Задания на сегодня
            </h2>
            <button
              type="button"
              onClick={() => {
                feed.refetch()
                state.refetch()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-black/60 hover:text-black"
            >
              <RefreshCw size={13} />
              Обновить
            </button>
          </div>

          {feed.isLoading && (
            <div className="mt-3 space-y-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-2xl border border-neutral-200 bg-white"
                />
              ))}
            </div>
          )}

          {feed.isError && (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              Не удалось загрузить ленту: {(feed.error as Error).message}
            </div>
          )}

          {feed.data && feed.data.items.length === 0 && (
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-black/55">
              Пока нечего предложить. Добавьте задачи с темами и уровнями в
              конструкторе курса — и лента соберётся сама.
            </div>
          )}

          <div className="mt-3 space-y-3">
            {feed.data?.items.map((item) => {
              const reason = REASON_STYLES[item.reason] || REASON_STYLES.practice
              const activity = item.activity_uuid.replace('activity_', '')
              return (
                <Link
                  key={item.task_uuid}
                  href={getUriWithOrg(
                    orgslug,
                    `/course/${clean}/activity/${activity}`
                  )}
                  className="group block rounded-2xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400 sm:p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${reason.className}`}
                        >
                          <reason.Icon size={11} />
                          {reason.label}
                        </span>
                        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-semibold text-black/55">
                          {LEVEL_LABELS[item.level] || `Уровень ${item.level}`}
                        </span>
                        {item.topic_name && (
                          <span className="text-[11px] font-semibold text-black/40">
                            {item.topic_name}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-base font-bold text-black">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-black/45">
                        Освоенность темы: {Math.round(item.mastery * 100)}% ·
                        шанс решения: {Math.round(item.expected_success * 100)}%
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-4">
                      <div className="text-end">
                        <p className="text-sm font-black text-black">
                          +{item.xp} XP
                        </p>
                        <p className="text-[11px] text-black/40">
                          ~{item.estimated_minutes} мин
                        </p>
                      </div>
                      <span className="grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-white text-black/50 transition-colors group-hover:border-black group-hover:text-black">
                        <ChevronRight size={17} />
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {state.data && state.data.topics.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-black tracking-tight text-black">
                Освоенность тем
              </h2>
              <div className="mt-3 space-y-2.5 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
                {state.data.topics.map((topic) => (
                  <div key={topic.topic_key}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-semibold text-black/75">
                        {topic.topic_name || topic.topic_key}
                      </span>
                      <span className="shrink-0 font-bold text-black">
                        {Math.round(topic.mastery * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-black transition-all"
                        style={{ width: `${Math.round(topic.mastery * 100)}%` }}
                      />
                    </div>
                    {topic.confidence < 0.5 && topic.attempts > 0 && (
                      <p className="mt-1 text-[10px] font-medium text-black/35">
                        Мало данных — решите ещё несколько задач, чтобы оценка
                        стала точнее.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  Icon,
}: {
  label: string
  value: string
  Icon: React.ElementType
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-black/40">
        <Icon size={13} />
        {label}
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-black">{value}</p>
    </div>
  )
}
