'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Search,
  X,
} from 'lucide-react'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getTaskBank, updateTaskBank } from '@services/practice/bank'

type BankItem = {
  task_uuid: string
  title: string
  assignment_type: string
  level: number
  topic_key: string
  topic_name: string
  estimated_minutes: number
  has_explicit_level: boolean
  course_uuid: string
  course_name: string
  chapter_uuid: string
  chapter_name: string
  activity_uuid: string
  published: boolean
}

type BankResponse = {
  items: BankItem[]
  total: number
  page: number
  limit: number
  facets: {
    courses: { course_uuid: string; name: string }[]
    topics: { topic_key: string; name: string; course_uuid: string }[]
    types: Record<string, number>
    levels: Record<string, number>
    unleveled: number
  }
}

type Draft = {
  level?: number
  topic_key?: string
  estimated_minutes?: number
}

const LEVEL_LABELS: Record<number, string> = {
  1: '1 · база',
  2: '2 · уверенно',
  3: '3 · сложно',
}

const TYPE_LABELS: Record<string, string> = {
  CODE: 'код',
  QUIZ: 'квиз',
  FORM: 'форма',
  SHORT_ANSWER: 'короткий ответ',
  NUMBER_ANSWER: 'число',
  FILE_SUBMISSION: 'файл',
  CUSTOM: 'кастом',
  OTHER: 'другое',
}

export default function TaskBankClient() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id as number | undefined
  const orgslug = org?.slug as string | undefined

  const [courseUuid, setCourseUuid] = useState('')
  const [level, setLevel] = useState('')
  const [assignmentType, setAssignmentType] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [onlyUnleveled, setOnlyUnleveled] = useState(false)
  const [page, setPage] = useState(1)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const bank = useQuery<BankResponse>({
    queryKey: [
      'task-bank',
      orgId,
      courseUuid,
      level,
      assignmentType,
      query,
      onlyUnleveled,
      page,
    ],
    queryFn: () =>
      getTaskBank(
        {
          orgId: orgId as number,
          courseUuid: courseUuid || undefined,
          level: level ? Number(level) : undefined,
          assignmentType: assignmentType || undefined,
          query: query || undefined,
          onlyUnleveled,
          page,
          limit: 50,
        },
        token
      ),
    enabled: !!(orgId && token),
    staleTime: 15_000,
    retry: false,
  })

  const data = bank.data
  const draftCount = Object.keys(drafts).length
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  const topicOptionsByCourse = useMemo(() => {
    const map = new Map<string, { topic_key: string; name: string }[]>()
    for (const topic of data?.facets.topics || []) {
      const rows = map.get(topic.course_uuid) || []
      rows.push({ topic_key: topic.topic_key, name: topic.name })
      map.set(topic.course_uuid, rows)
    }
    return map
  }, [data?.facets.topics])

  const setFilter = (setter: (_next: string) => void) => (next: string) => {
    setter(next)
    setPage(1)
  }

  const setDraft = (taskUuid: string, patch: Draft) => {
    setDrafts((previous) => ({
      ...previous,
      [taskUuid]: { ...previous[taskUuid], ...patch },
    }))
  }

  const valueFor = <K extends keyof Draft>(item: BankItem, key: K): Draft[K] => {
    const draft = drafts[item.task_uuid]
    if (draft && draft[key] !== undefined) return draft[key]
    if (key === 'level') return item.level as Draft[K]
    if (key === 'topic_key') return item.topic_key as Draft[K]
    return item.estimated_minutes as Draft[K]
  }

  const toggleSelected = (taskUuid: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(taskUuid)) next.delete(taskUuid)
      else next.add(taskUuid)
      return next
    })
  }

  const selectPage = () => {
    if (!data) return
    const allSelected = data.items.every((item) => selected.has(item.task_uuid))
    setSelected((previous) => {
      const next = new Set(previous)
      for (const item of data.items) {
        if (allSelected) next.delete(item.task_uuid)
        else next.add(item.task_uuid)
      }
      return next
    })
  }

  const setLevelForSelected = (levelValue: number) => {
    if (!levelValue || selected.size === 0) return
    setDrafts((previous) => {
      const next = { ...previous }
      for (const uuid of selected) {
        next[uuid] = { ...next[uuid], level: levelValue }
      }
      return next
    })
  }

  const save = async () => {
    if (!orgId || draftCount === 0) return
    setSaving(true)
    try {
      const tasks = Object.entries(drafts).map(([taskUuid, draft]) => ({
        task_uuid: taskUuid,
        ...draft,
      }))
      await updateTaskBank(orgId, tasks, token)
      setDrafts({})
      setSelected(new Set())
      await bank.refetch()
      toast.success('Банк сохранён')
    } catch (error: any) {
      toast.error(error?.message || 'Не удалось сохранить изменения')
    } finally {
      setSaving(false)
    }
  }

  if (!orgId) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-16 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href={getUriWithOrg(orgslug || '', '/cabinet/courses')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/50 hover:text-black"
          >
            <ArrowLeft size={15} />
            К курсам
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-black sm:text-3xl">
            Банк задач
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-black/50">
            Все задачи организации: тема, уровень, время и статус. Правки
            применяются к персональной практике и конструктору курса.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={draftCount === 0 || saving}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          Сохранить{draftCount > 0 ? ` (${draftCount})` : ''}
        </button>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip label="Всего" value={data.total} />
          <Chip label="Уровень 1" value={data.facets.levels['1'] || 0} />
          <Chip label="Уровень 2" value={data.facets.levels['2'] || 0} />
          <Chip label="Уровень 3" value={data.facets.levels['3'] || 0} />
          <Chip
            label="Без уровня"
            value={data.facets.unleveled}
            tone={data.facets.unleveled > 0 ? 'warn' : 'ok'}
          />
          {selected.size > 0 && (
            <Chip label="Выбрано" value={selected.size} tone="warn" />
          )}
        </div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 nice-shadow">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setQuery(queryInput.trim())
              setPage(1)
            }}
          >
            <div className="relative flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-black/35"
              />
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Поиск по условию задачи"
                className="h-10 w-full rounded-xl border border-neutral-200 bg-white ps-9 pe-3 text-sm text-black outline-hidden focus:border-neutral-400"
              />
            </div>
            <button
              type="submit"
              className="h-10 rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm font-semibold text-black/70 hover:text-black"
            >
              Найти
            </button>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setQueryInput('')
                  setPage(1)
                }}
                className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-black/50 hover:text-black"
                title="Сбросить поиск"
              >
                <X size={15} />
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={courseUuid}
              onChange={(event) => setFilter(setCourseUuid)(event.target.value)}
              className="h-10 max-w-[240px] rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
            >
              <option value="">Все курсы</option>
              {(data?.facets.courses || []).map((course) => (
                <option key={course.course_uuid} value={course.course_uuid}>
                  {course.name}
                </option>
              ))}
            </select>

            <select
              value={level}
              onChange={(event) => setFilter(setLevel)(event.target.value)}
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
            >
              <option value="">Все уровни</option>
              <option value="1">1 · база</option>
              <option value="2">2 · уверенно</option>
              <option value="3">3 · сложно</option>
            </select>

            <select
              value={assignmentType}
              onChange={(event) =>
                setFilter(setAssignmentType)(event.target.value)
              }
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
            >
              <option value="">Все типы</option>
              {Object.keys(data?.facets.types || {}).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type] || type}
                </option>
              ))}
            </select>

            <label className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black/60">
              <input
                type="checkbox"
                checked={onlyUnleveled}
                onChange={(event) => {
                  setOnlyUnleveled(event.target.checked)
                  setPage(1)
                }}
                className="h-3.5 w-3.5 accent-black"
              />
              Без уровня
            </label>

            <select
              value=""
              onChange={(event) => setLevelForSelected(Number(event.target.value))}
              disabled={selected.size === 0}
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black outline-hidden focus:border-neutral-400 disabled:opacity-40"
            >
              <option value="">Уровень выбранным…</option>
              <option value="1">1 · база</option>
              <option value="2">2 · уверенно</option>
              <option value="3">3 · сложно</option>
            </select>
          </div>
        </div>
      </div>

      {bank.isLoading && (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-neutral-200 bg-white">
          <Loader2 className="animate-spin text-neutral-400" size={24} />
        </div>
      )}

      {bank.isError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {(bank.error as Error).message || 'Не удалось загрузить банк задач.'}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-black/50">
          По этим фильтрам задач нет. Сбросьте фильтры или добавьте задания в
          курсы.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white nice-shadow">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-start">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[11px] font-bold uppercase tracking-wide text-black/40">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={
                        data.items.length > 0 &&
                        data.items.every((item) => selected.has(item.task_uuid))
                      }
                      onChange={selectPage}
                      className="h-3.5 w-3.5 accent-black"
                      aria-label="Выбрать все на странице"
                    />
                  </th>
                  <th className="px-3 py-2.5">Задача</th>
                  <th className="px-3 py-2.5">Курс / тема</th>
                  <th className="px-3 py-2.5">Тип</th>
                  <th className="px-3 py-2.5">Уровень</th>
                  <th className="px-3 py-2.5">Мин</th>
                  <th className="px-3 py-2.5">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.items.map((item) => {
                  const dirty = Boolean(drafts[item.task_uuid])
                  const topicOptions = [
                    ...(topicOptionsByCourse.get(item.course_uuid) || []),
                  ]
                  const currentTopic = String(valueFor(item, 'topic_key') || '')
                  if (
                    currentTopic &&
                    !topicOptions.some((topic) => topic.topic_key === currentTopic)
                  ) {
                    topicOptions.unshift({ topic_key: currentTopic, name: item.topic_name })
                  }
                  return (
                    <tr
                      key={item.task_uuid}
                      className={dirty ? 'bg-amber-50/40' : 'bg-white'}
                    >
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(item.task_uuid)}
                          onChange={() => toggleSelected(item.task_uuid)}
                          className="h-3.5 w-3.5 accent-black"
                          aria-label={`Выбрать ${item.title}`}
                        />
                      </td>
                      <td className="max-w-[360px] px-3 py-2.5 align-top">
                        <p className="truncate text-sm font-semibold text-black">
                          {item.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-black/35">
                          {item.task_uuid}
                          {dirty && (
                            <span className="ms-2 font-bold text-amber-600">
                              изменено
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="truncate text-xs font-semibold text-black/70">
                          {item.course_name}
                        </p>
                        <select
                          value={currentTopic}
                          onChange={(event) =>
                            setDraft(item.task_uuid, {
                              topic_key: event.target.value,
                            })
                          }
                          className="mt-1 h-8 w-full max-w-[220px] rounded-lg border border-neutral-200 bg-white px-2 text-[11px] text-black outline-hidden focus:border-neutral-400"
                        >
                          {topicOptions.map((topic) => (
                            <option key={topic.topic_key} value={topic.topic_key}>
                              {topic.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-bold uppercase text-black/45">
                          {TYPE_LABELS[item.assignment_type] ||
                            item.assignment_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <select
                          value={String(valueFor(item, 'level') || 1)}
                          onChange={(event) =>
                            setDraft(item.task_uuid, {
                              level: Number(event.target.value),
                            })
                          }
                          className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
                        >
                          {[1, 2, 3].map((value) => (
                            <option key={value} value={value}>
                              {LEVEL_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="number"
                          min={1}
                          max={600}
                          value={String(valueFor(item, 'estimated_minutes') || 10)}
                          onChange={(event) =>
                            setDraft(item.task_uuid, {
                              estimated_minutes: Math.max(
                                1,
                                Math.min(600, Number(event.target.value) || 1)
                              ),
                            })
                          }
                          className="h-8 w-16 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-black outline-hidden focus:border-neutral-400"
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              item.published
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {item.published ? (
                              <>
                                <Check size={10} /> опубликована
                              </>
                            ) : (
                              'черновик'
                            )}
                          </span>
                          {!item.has_explicit_level && !drafts[item.task_uuid]?.level && (
                            <span className="text-[10px] font-semibold text-rose-600">
                              уровень не задан
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-black/45">
              Показано {data.items.length} из {data.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black/60 hover:text-black disabled:opacity-40"
              >
                <ChevronLeft size={14} />
                Назад
              </button>
              <span className="text-xs font-semibold text-black/60">
                {page} / {pages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(pages, current + 1))
                }
                disabled={page >= pages}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black/60 hover:text-black disabled:opacity-40"
              >
                Далее
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-xs text-black/45">
        <div className="flex items-center gap-2 font-semibold text-black/60">
          <BookOpen size={14} />
          Как это связано с курсами
        </div>
        <p className="mt-1">
          Уровень и тема отсюда сразу попадают в персональную практику. Структуру
          разделов и пререквизиты удобнее править во вкладке «Программа» внутри
          курса.
        </p>
      </div>
    </div>
  )
}

function Chip({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'warn' | 'ok'
}) {
  const toneClass =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-neutral-200 bg-neutral-50 text-black/60'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}
    >
      {label}
      <span className="font-black text-black">{value}</span>
    </span>
  )
}
