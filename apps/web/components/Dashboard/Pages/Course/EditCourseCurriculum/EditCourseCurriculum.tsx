'use client'

import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Layers3,
  Loader2,
  Save,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react'

import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getCourseCurriculum,
  updateCourseCurriculum,
} from '@services/practice/curriculum'

type Topic = {
  chapter_uuid: string
  name: string
  topic_key: string
  section: string
  module: string
  level: number
  prerequisites: string[]
  credit: Record<string, number>
  estimated_minutes: number
  order: number | null
  tasks_total: number
}

type Task = {
  task_uuid: string
  title: string
  assignment_type: string
  chapter_uuid: string
  topic_key: string
  level: number
  estimated_minutes: number
  published: boolean
  hasExplicitLevel: boolean
}

const LEVELS = [
  { value: 1, label: '1 · база' },
  { value: 2, label: '2 · уверенно' },
  { value: 3, label: '3 · сложно' },
]

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

function normalizeTopic(raw: any): Topic {
  return {
    chapter_uuid: String(raw?.chapter_uuid || ''),
    name: raw?.name || raw?.chapter_uuid || '',
    topic_key: raw?.topic_key || raw?.chapter_uuid || '',
    section: raw?.section || '',
    module: raw?.module || '',
    level: Number(raw?.level) || 1,
    prerequisites: Array.isArray(raw?.prerequisites) ? raw.prerequisites : [],
    credit: raw?.credit && typeof raw.credit === 'object' ? raw.credit : {},
    estimated_minutes: Number(raw?.estimated_minutes) || 10,
    order: raw?.order ?? null,
    tasks_total: Number(raw?.tasks_total) || 0,
  }
}

function normalizeTask(raw: any): Task {
  return {
    task_uuid: String(raw?.task_uuid || ''),
    title: raw?.title || raw?.task_uuid || '',
    assignment_type: String(raw?.assignment_type || '').split('.').pop() || '',
    chapter_uuid: raw?.chapter_uuid || '',
    topic_key: raw?.topic_key || '',
    level: Number(raw?.level) || 1,
    estimated_minutes: Number(raw?.estimated_minutes) || 10,
    published: Boolean(raw?.published),
    hasExplicitLevel: Boolean(
      raw?.meta && Object.prototype.hasOwnProperty.call(raw.meta, 'level')
    ),
  }
}

function EditCourseCurriculum() {
  const course = useCourse() as any
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const query = useQuery({
    queryKey: ['course-curriculum', courseUuid],
    queryFn: () => getCourseCurriculum(courseUuid as string, accessToken),
    enabled: !!(courseUuid && accessToken),
    staleTime: 60_000,
    retry: false,
  })

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    )
  }

  if (query.error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {(query.error as Error).message ||
            'Не удалось загрузить программу курса.'}
        </div>
      </div>
    )
  }

  if (!query.data || !courseUuid) return null

  return (
    <CurriculumEditor
      key={courseUuid}
      courseUuid={courseUuid}
      accessToken={accessToken}
      initialData={query.data}
    />
  )
}

function CurriculumEditor({
  courseUuid,
  accessToken,
  initialData,
}: {
  courseUuid: string
  accessToken?: string | null
  initialData: any
}) {
  const [topics, setTopics] = useState<Topic[]>(() =>
    (initialData?.topics || []).map(normalizeTopic)
  )
  const [tasks, setTasks] = useState<Task[]>(() =>
    (initialData?.tasks || []).map(normalizeTask)
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirtyTopics, setDirtyTopics] = useState(false)
  const [dirtyTasks, setDirtyTasks] = useState<Set<string>>(new Set())
  const [selectedChapter, setSelectedChapter] = useState(
    () => (initialData?.topics?.[0]?.chapter_uuid as string) || ''
  )
  const [openPrereq, setOpenPrereq] = useState<string | null>(null)
  const [onlyUnleveled, setOnlyUnleveled] = useState(false)

  const applyPayload = (payload: any) => {
    const nextTopics = (payload?.topics || []).map(normalizeTopic)
    const nextTasks = (payload?.tasks || []).map(normalizeTask)
    setTopics(nextTopics)
    setTasks(nextTasks)
    setSelectedChapter((current) => current || nextTopics[0]?.chapter_uuid || '')
  }

  const dirty = dirtyTopics || dirtyTasks.size > 0

  const topicByKey = useMemo(() => {
    const map = new Map<string, Topic>()
    for (const topic of topics) map.set(topic.topic_key, topic)
    return map
  }, [topics])

  const sectionOptions = useMemo(
    () => Array.from(new Set(topics.map((topic) => topic.section).filter(Boolean))),
    [topics]
  )
  const moduleOptions = useMemo(
    () => Array.from(new Set(topics.map((topic) => topic.module).filter(Boolean))),
    [topics]
  )

  const levelCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
    for (const task of tasks) {
      counts[task.level] = (counts[task.level] || 0) + 1
    }
    return counts
  }, [tasks])

  const tasksWithoutLevel = useMemo(
    () => tasks.filter((task) => !task.hasExplicitLevel).length,
    [tasks]
  )

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter(
      (task) => task.chapter_uuid === selectedChapter
    )
    return onlyUnleveled
      ? filtered.filter((task) => !task.hasExplicitLevel)
      : filtered
  }, [tasks, selectedChapter, onlyUnleveled])

  const selectedTopic = topics.find(
    (topic) => topic.chapter_uuid === selectedChapter
  )

  const patchTopic = (chapterUuid: string, patch: Partial<Topic>) => {
    setTopics((previous) =>
      previous.map((topic) =>
        topic.chapter_uuid === chapterUuid ? { ...topic, ...patch } : topic
      )
    )
    setDirtyTopics(true)
  }

  const patchTask = (taskUuid: string, patch: Partial<Task>) => {
    setTasks((previous) =>
      previous.map((task) =>
        task.task_uuid === taskUuid ? { ...task, ...patch } : task
      )
    )
    setDirtyTasks((previous) => new Set(previous).add(taskUuid))
  }

  const togglePrerequisite = (chapterUuid: string, prerequisiteKey: string) => {
    const topic = topics.find((item) => item.chapter_uuid === chapterUuid)
    if (!topic) return
    const next = topic.prerequisites.includes(prerequisiteKey)
      ? topic.prerequisites.filter((key) => key !== prerequisiteKey)
      : [...topic.prerequisites, prerequisiteKey]
    patchTopic(chapterUuid, { prerequisites: next })
  }

  const setVisibleLevel = (level: number) => {
    const uuids = visibleTasks.map((task) => task.task_uuid)
    if (uuids.length === 0) return
    setTasks((previous) =>
      previous.map((task) =>
        uuids.includes(task.task_uuid) ? { ...task, level } : task
      )
    )
    setDirtyTasks((previous) => new Set([...previous, ...uuids]))
  }

  const autoLevelVisible = () => {
    const count = visibleTasks.length
    if (count === 0) return
    const levelOne = Math.min(count, Math.max(1, Math.round(count * 0.4)))
    const levelTwo = Math.min(
      count - levelOne,
      Math.max(0, Math.round(count * 0.47))
    )
    const mapping = new Map<string, number>()
    visibleTasks.forEach((task, index) => {
      const level =
        index < levelOne ? 1 : index < levelOne + levelTwo ? 2 : 3
      mapping.set(task.task_uuid, level)
    })
    setTasks((previous) =>
      previous.map((task) =>
        mapping.has(task.task_uuid)
          ? { ...task, level: mapping.get(task.task_uuid) as number }
          : task
      )
    )
    setDirtyTasks((previous) => new Set([...previous, ...mapping.keys()]))
  }

  const save = async () => {
    if (!courseUuid || !dirty) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        topics: dirtyTopics
          ? topics.map((topic) => ({
              chapter_uuid: topic.chapter_uuid,
              topic_key: topic.topic_key,
              section: topic.section,
              module: topic.module,
              level: topic.level,
              prerequisites: topic.prerequisites,
              credit: topic.credit,
              estimated_minutes: topic.estimated_minutes,
              order: topic.order,
            }))
          : [],
        tasks: Array.from(dirtyTasks)
          .map((taskUuid) => {
            const task = tasks.find((item) => item.task_uuid === taskUuid)
            return task
              ? {
                  task_uuid: task.task_uuid,
                  level: task.level,
                  estimated_minutes: task.estimated_minutes,
                }
              : null
          })
          .filter(Boolean) as {
          task_uuid: string
          level: number
          estimated_minutes: number
        }[],
      }
      const data = await updateCourseCurriculum(courseUuid, payload, accessToken)
      applyPayload(data)
      setDirtyTopics(false)
      setDirtyTasks(new Set())
      toast.success('Программа сохранена')
    } catch (error: any) {
      const message =
        error?.message || 'Не удалось сохранить программу. Проверьте пререквизиты.'
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-16 sm:p-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 nice-shadow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
              Программа курса
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-black">
              Разделы, уровни и пререквизиты
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-black/50">
              Эти данные использует персональная практика: по ним задачи
              подбираются по уровню, а темы открываются после пререквизитов.
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            Сохранить
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Stat label="Тем" value={`${topics.length}`} />
          <Stat label="Задач" value={`${tasks.length}`} />
          <Stat label="Уровень 1" value={`${levelCounts[1] || 0}`} />
          <Stat label="Уровень 2" value={`${levelCounts[2] || 0}`} />
          <Stat label="Уровень 3" value={`${levelCounts[3] || 0}`} />
          <Stat
            label="Без уровня"
            value={`${tasksWithoutLevel}`}
            tone={tasksWithoutLevel > 0 ? 'warn' : 'ok'}
          />
          {dirty && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              Есть несохранённые изменения
            </span>
          )}
        </div>

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            {saveError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white nice-shadow">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <Layers3 size={16} className="text-black/45" />
          <h2 className="text-sm font-black text-black">Темы курса</h2>
        </div>

        {topics.length === 0 ? (
          <p className="p-5 text-sm text-black/50">
            В курсе пока нет глав. Добавьте их на вкладке «Контент» — они станут
            темами программы.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {topics.map((topic) => {
              const prereqOpen = openPrereq === topic.chapter_uuid
              return (
                <div key={topic.chapter_uuid} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="min-w-0 lg:w-[28%]">
                      <p className="truncate text-sm font-bold text-black">
                        {topic.name || topic.chapter_uuid}
                      </p>
                      <p className="mt-0.5 text-[11px] text-black/40">
                        {topic.tasks_total} задач · тема{' '}
                        <code className="rounded bg-neutral-100 px-1">
                          {topic.topic_key}
                        </code>
                      </p>
                    </div>

                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <Field label="Раздел">
                        <input
                          list="curriculum-sections"
                          value={topic.section}
                          onChange={(event) =>
                            patchTopic(topic.chapter_uuid, {
                              section: event.target.value,
                            })
                          }
                          placeholder="Например, Основы"
                          className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-black outline-hidden focus:border-neutral-400"
                        />
                      </Field>
                      <Field label="Модуль">
                        <input
                          list="curriculum-modules"
                          value={topic.module}
                          onChange={(event) =>
                            patchTopic(topic.chapter_uuid, {
                              module: event.target.value,
                            })
                          }
                          placeholder="Например, Ввод-вывод"
                          className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-black outline-hidden focus:border-neutral-400"
                        />
                      </Field>
                      <Field label="Уровень">
                        <select
                          value={topic.level}
                          onChange={(event) =>
                            patchTopic(topic.chapter_uuid, {
                              level: Number(event.target.value),
                            })
                          }
                          className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
                        >
                          {LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Время, мин">
                        <input
                          type="number"
                          min={1}
                          max={600}
                          value={topic.estimated_minutes}
                          onChange={(event) =>
                            patchTopic(topic.chapter_uuid, {
                              estimated_minutes: Math.max(
                                1,
                                Math.min(600, Number(event.target.value) || 1)
                              ),
                            })
                          }
                          className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-black outline-hidden focus:border-neutral-400"
                        />
                      </Field>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setOpenPrereq(prereqOpen ? null : topic.chapter_uuid)
                      }
                      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                        topic.prerequisites.length > 0
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-200 bg-white text-black/60 hover:text-black'
                      }`}
                    >
                      {prereqOpen ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      Пререквизиты: {topic.prerequisites.length}
                    </button>
                  </div>

                  {topic.prerequisites.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {topic.prerequisites.map((key) => (
                        <span
                          key={key}
                          className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-black/60"
                        >
                          {topicByKey.get(key)?.name || key}
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          patchTopic(topic.chapter_uuid, { prerequisites: [] })
                        }
                        className="text-[11px] font-semibold text-black/40 hover:text-black"
                      >
                        Очистить
                      </button>
                    </div>
                  )}

                  {prereqOpen && (
                    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                      <p className="text-[11px] font-semibold text-black/50">
                        Тема откроется в практике, когда эти темы будут освоены
                        минимум на 60%.
                      </p>
                      <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                        {topics
                          .filter(
                            (candidate) =>
                              candidate.chapter_uuid !== topic.chapter_uuid
                          )
                          .map((candidate) => {
                            const checked = topic.prerequisites.includes(
                              candidate.topic_key
                            )
                            return (
                              <label
                                key={candidate.chapter_uuid}
                                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                  checked
                                    ? 'border-neutral-900 bg-white text-black'
                                    : 'border-neutral-200 bg-white/70 text-black/60 hover:text-black'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    togglePrerequisite(
                                      topic.chapter_uuid,
                                      candidate.topic_key
                                    )
                                  }
                                  className="mt-0.5 h-3.5 w-3.5 accent-black"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold">
                                    {candidate.name || candidate.topic_key}
                                  </span>
                                  {(candidate.section ||
                                    candidate.module) && (
                                    <span className="block truncate text-[10px] text-black/35">
                                      {[candidate.section, candidate.module]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </span>
                                  )}
                                </span>
                              </label>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <datalist id="curriculum-sections">
        {sectionOptions.map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>
      <datalist id="curriculum-modules">
        {moduleOptions.map((module) => (
          <option key={module} value={module} />
        ))}
      </datalist>

      <div className="rounded-2xl border border-neutral-200 bg-white nice-shadow">
        <div className="flex flex-col gap-3 border-b border-neutral-100 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-black/45" />
            <h2 className="text-sm font-black text-black">Задачи</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedChapter}
              onChange={(event) => setSelectedChapter(event.target.value)}
              className="h-9 max-w-[260px] rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
            >
              {topics.map((topic) => (
                <option key={topic.chapter_uuid} value={topic.chapter_uuid}>
                  {topic.name || topic.chapter_uuid}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-black/60">
              <input
                type="checkbox"
                checked={onlyUnleveled}
                onChange={(event) => setOnlyUnleveled(event.target.checked)}
                className="h-3.5 w-3.5 accent-black"
              />
              Только без уровня
            </label>
            <button
              type="button"
              onClick={autoLevelVisible}
              disabled={visibleTasks.length === 0}
              title="Распределить уровни 40% / 47% / 13% по порядку задач"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black/60 transition-colors hover:text-black disabled:opacity-40"
            >
              <Wand2 size={13} />
              Авто-уровни
            </button>
            <select
              value=""
              onChange={(event) => {
                const value = Number(event.target.value)
                if (value) setVisibleLevel(value)
              }}
              className="h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
            >
              <option value="">Уровень всем видимым…</option>
              {LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!selectedTopic ? (
          <p className="p-5 text-sm text-black/50">Выберите тему.</p>
        ) : visibleTasks.length === 0 ? (
          <p className="p-5 text-sm text-black/50">
            В этой теме нет задач{onlyUnleveled ? ' без уровня' : ''}. Добавьте
            задания в контенте курса.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {visibleTasks.map((task) => (
              <div
                key={task.task_uuid}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-black">
                      {task.title}
                    </p>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black/40">
                      {TYPE_LABELS[task.assignment_type] || task.assignment_type}
                    </span>
                    {!task.published && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        черновик
                      </span>
                    )}
                    {!task.hasExplicitLevel && (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                        нет уровня
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-black/35">
                    {task.task_uuid}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={task.level}
                    onChange={(event) =>
                      patchTask(task.task_uuid, {
                        level: Number(event.target.value),
                      })
                    }
                    className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-black outline-hidden focus:border-neutral-400"
                  >
                    {LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={task.estimated_minutes}
                    onChange={(event) =>
                      patchTask(task.task_uuid, {
                        estimated_minutes: Math.max(
                          1,
                          Math.min(600, Number(event.target.value) || 1)
                        ),
                      })
                    }
                    className="h-8 w-16 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-black outline-hidden focus:border-neutral-400"
                    title="Оценка времени, минут"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
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

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-black/35">
        {label}
      </span>
      {children}
    </label>
  )
}

export default EditCourseCurriculum
