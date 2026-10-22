'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  applyRoadmapOperations,
  askRoadmapAssistant,
  getRoadmapJob,
  importRoadmap,
  retryRoadmapJob,
  RoadmapImportPayload,
} from '@services/roadmap/roadmap'
import { AlertCircle, CheckCircle2, FileUp, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { load as loadYaml } from 'js-yaml'

type RoadmapItem = {
  key: string
  kind: 'LECTURE' | 'TASKS'
  title: string
  state: 'PENDING' | 'GENERATING' | 'READY' | 'SKIPPED' | 'FAILED'
  error?: string
}

type RoadmapJob = {
  job_uuid: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'
  total: number
  completed: number
  failed: number
  error?: string | null
  items: RoadmapItem[]
}

type AssistantMessage = {
  role: 'user' | 'assistant'
  text: string
  operations?: unknown[]
  applied?: { action: string; status: 'applied' | 'failed'; detail?: string }[]
}

type CourseStructure = {
  course_uuid: string
  name: string
}

const SAMPLE = `title: Python: from zero to API
description: A practical backend course.
language: en
chapters:
  - title: Basics
    description: Syntax, types, control flow.
    lessons:
      - title: Variables and types
        summary: Learn how Python stores values.
        material: |
          # Variables

          A variable is a name bound to a value.

          \`\`\`python
          age = 42
          \`\`\`
        tasks:
          - type: quiz
            title: Types check
            description: Pick the correct type.
            questions:
              - text: What is the type of 42?
                options:
                  - text: int
                    correct: true
                  - text: str
          - type: code
            title: Add two numbers
            description: Read two integers and print their sum.
            language: python
            starter_code: |
              a, b = map(int, input().split())
              # print the sum
            tests:
              - stdin: "1 2\\n"
                expected_stdout: "3\\n"
              - stdin: "10 -4\\n"
                expected_stdout: "6\\n"
      - title: Control flow
        summary: if/else and loops.
`

function parseRoadmap(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Paste a roadmap first')
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  return loadYaml(trimmed)
}

export default function EditCourseRoadmap() {
  const courseState = useCourse()
  const structure = courseState?.courseStructure as CourseStructure | undefined
  const org = useOrg()
  const session = useLHSession()
  const accessToken = session?.data?.tokens?.access_token

  const [source, setSource] = useState(SAMPLE)
  const [mode, setMode] = useState<'merge' | 'create'>('merge')
  const [generateMissing, setGenerateMissing] = useState(true)
  const [publish, setPublish] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [jobUuid, setJobUuid] = useState<string | null>(null)
  const [importedCourseUuid, setImportedCourseUuid] = useState<string | null>(null)
  const [job, setJob] = useState<RoadmapJob | null>(null)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([])
  const [asking, setAsking] = useState(false)
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const courseUuid = structure?.course_uuid

  useEffect(() => {
    if (!jobUuid || !accessToken) return
    const token = accessToken
    const id = jobUuid
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      try {
        const next = (await getRoadmapJob(id, token)) as RoadmapJob
        if (cancelled) return
        setJob(next)
        if (next.status === 'PENDING' || next.status === 'RUNNING') {
          timer = setTimeout(poll, 2500)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'Could not read job status')
        }
      }
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [jobUuid, accessToken])

  const itemSummary = useMemo(() => {
    if (!job) return null
    return `${job.completed}/${job.total} ready${job.failed ? `, ${job.failed} failed` : ''}`
  }, [job])

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setSource(await file.text())
    } catch {
      toast.error('Could not read the file')
    } finally {
      event.target.value = ''
    }
  }

  async function submit() {
    if (!accessToken || !org?.id) return
    let plan: unknown
    try {
      plan = parseRoadmap(source)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid roadmap')
      return
    }
    setSubmitting(true)
    setJob(null)
    setJobUuid(null)
    try {
      const payload: RoadmapImportPayload = {
        org_id: org.id,
        plan,
        generate_missing: generateMissing,
        publish,
        ...(mode === 'merge' && courseUuid ? { course_uuid: courseUuid } : {}),
      }
      const response = await importRoadmap(payload, accessToken)
      setJobUuid(response.job_uuid || null)
      setImportedCourseUuid(response.course_uuid || null)
      if (response.job_uuid) {
        toast.success('Structure created. Generating missing content…')
      } else {
        toast.success('Roadmap imported')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function retry() {
    if (!accessToken || !job) return
    try {
      await retryRoadmapJob(job.job_uuid, accessToken)
      toast.success('Retry queued')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed')
    }
  }

  async function ask() {
    if (!accessToken || !courseUuid || !assistantInput.trim()) return
    const message = assistantInput.trim()
    setAssistantInput('')
    setAsking(true)
    setAssistantMessages((current) => [...current, { role: 'user', text: message }])
    try {
      const response = await askRoadmapAssistant(courseUuid, { message }, accessToken)
      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: response.reply,
          operations: response.operations || [],
        },
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Assistant failed')
      setAssistantMessages((current) => [
        ...current,
        { role: 'assistant', text: 'The assistant could not answer. Try again.' },
      ])
    } finally {
      setAsking(false)
    }
  }

  async function apply(index: number) {
    if (!accessToken || !courseUuid) return
    const message = assistantMessages[index]
    if (!message.operations?.length) return
    setApplyingIndex(index)
    try {
      const response = await applyRoadmapOperations(courseUuid, message.operations, accessToken)
      setAssistantMessages((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, applied: response.applied } : item
        )
      )
      const failed = (response.applied || []).filter((item: { status: string }) => item.status === 'failed')
      if (failed.length) {
        toast.error(`${failed.length} change(s) failed`)
      } else {
        toast.success('Roadmap updated')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not apply changes')
    } finally {
      setApplyingIndex(null)
    }
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Roadmap import</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a JSON or YAML skeleton. Missing lectures and practice tasks are
          generated by AI; anything you provide is kept as-is.
        </p>
      </div>

      <div className="rounded-xl bg-white nice-shadow p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200"
          >
            <FileUp size={15} /> Upload .json / .yaml / .yml
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml"
            className="hidden"
            onChange={onFile}
          />
          <div className="flex rounded-full bg-gray-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMode('merge')}
              className={`rounded-full px-3 py-1.5 ${mode === 'merge' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              Merge into this course
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`rounded-full px-3 py-1.5 ${mode === 'create' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              Create a new course
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={generateMissing}
              onChange={(event) => setGenerateMissing(event.target.checked)}
            />
            Generate missing content
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
            />
            Publish immediately
          </label>
        </div>

        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full rounded-lg border border-gray-200 bg-gray-950 p-4 font-mono text-xs text-gray-100 outline-none focus:ring-2 focus:ring-gray-400"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !accessToken}
            className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-bold text-white disabled:opacity-50 hover:bg-gray-800"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Import roadmap
          </button>
          {mode === 'merge' && !courseUuid && (
            <span className="text-xs text-amber-600">Course is still loading…</span>
          )}
          {importedCourseUuid && org?.slug && (
            <a
              href={`/orgs/${org.slug}/dash/courses/course/${importedCourseUuid.replace(/^course_/, '')}/content`}
              className="text-xs font-semibold text-gray-700 underline underline-offset-2 hover:text-gray-900"
            >
              Open the course →
            </a>
          )}
        </div>
      </div>

      {job && (
        <div className="rounded-xl bg-white nice-shadow p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {job.status === 'COMPLETED' ? (
                <CheckCircle2 size={18} className="text-emerald-600" />
              ) : job.status === 'FAILED' ? (
                <AlertCircle size={18} className="text-red-600" />
              ) : (
                <Loader2 size={18} className="animate-spin text-gray-500" />
              )}
              <h2 className="font-bold text-sm text-gray-900">Generation: {job.status}</h2>
              <span className="text-xs text-gray-500">{itemSummary}</span>
            </div>
            {job.failed > 0 && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
              >
                <RotateCcw size={13} /> Retry failed
              </button>
            )}
          </div>
          {job.error && <p className="text-xs text-red-600">{job.error}</p>}
          <div className="max-h-72 overflow-auto divide-y divide-gray-100">
            {job.items.map((item, index) => (
              <div key={`${item.key}-${item.kind}-${index}`} className="py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-800">
                    {item.kind === 'LECTURE' ? 'Lecture' : 'Practice'} · {item.title}
                  </span>
                  <span
                    className={
                      item.state === 'READY'
                        ? 'text-emerald-600 font-semibold'
                        : item.state === 'FAILED'
                          ? 'text-red-600 font-semibold'
                          : 'text-gray-500'
                    }
                  >
                    {item.state}
                  </span>
                </div>
                {item.error && <p className="text-red-500 mt-1">{item.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-white nice-shadow p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={17} className="text-violet-500" />
          <h2 className="font-bold text-sm text-gray-900">Roadmap assistant</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Ask the assistant to add a module, rewrite a lesson, or generate tasks.
          It proposes changes; nothing is written until you press Apply.
        </p>
        <div className="space-y-3 max-h-96 overflow-auto">
          {assistantMessages.map((message, index) => (
            <div key={index} className="rounded-lg bg-gray-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                {message.role}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{message.text}</p>
              {message.operations && message.operations.length > 0 && (
                <div className="mt-2 space-y-2">
                  <pre className="max-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] text-gray-100">
                    {JSON.stringify(message.operations, null, 2)}
                  </pre>
                  <button
                    type="button"
                    onClick={() => apply(index)}
                    disabled={applyingIndex === index}
                    className="rounded-full bg-violet-600 px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 hover:bg-violet-700"
                  >
                    {applyingIndex === index ? 'Applying…' : `Apply ${message.operations.length} change(s)`}
                  </button>
                </div>
              )}
              {message.applied && (
                <ul className="mt-2 text-[11px]">
                  {message.applied.map((item, itemIndex) => (
                    <li key={itemIndex} className={item.status === 'applied' ? 'text-emerald-600' : 'text-red-600'}>
                      {item.action}: {item.status} {item.detail ? `— ${item.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                ask()
              }
            }}
            placeholder="e.g. add a lesson on decorators after Control flow"
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            type="button"
            onClick={ask}
            disabled={asking || !courseUuid || !assistantInput.trim()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-gray-800"
          >
            {asking ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  )
}
