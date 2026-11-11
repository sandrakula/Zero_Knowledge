'use client'

import { useSyncExternalStore } from 'react'

export type TutorTaskContext = {
  course_uuid?: string
  course_title?: string
  activity_uuid?: string
  activity_title?: string
  assignment_uuid?: string
  assignment_title?: string
  task_uuid?: string
  task_title?: string
  code?: string
  language_id?: number
  last_run?: string
  explanation?: string
}

let contexts: Record<string, TutorTaskContext> = {}
let activeTaskUuid: string | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function clean(patch: TutorTaskContext): TutorTaskContext {
  const next: TutorTaskContext = {}
  for (const [key, value] of Object.entries(patch) as [keyof TutorTaskContext, unknown][]) {
    if (value === undefined) continue
    ;(next as Record<string, unknown>)[key] =
      typeof value === 'string' ? value.slice(0, 20000) : value
  }
  return next
}

export function publishTaskContext(patch: TutorTaskContext) {
  const key = patch.task_uuid || 'unknown'
  contexts = { ...contexts, [key]: { ...contexts[key], ...clean(patch) } }
  activeTaskUuid = key
  emit()
}

export function clearTaskContext(taskUuid?: string) {
  if (taskUuid) {
    const next = { ...contexts }
    delete next[taskUuid]
    contexts = next
    if (activeTaskUuid === taskUuid) activeTaskUuid = null
  } else {
    contexts = {}
    activeTaskUuid = null
  }
  emit()
}

export function getTaskContext(taskUuid?: string): TutorTaskContext {
  if (taskUuid) return contexts[taskUuid] || {}
  return activeTaskUuid ? contexts[activeTaskUuid] || {} : {}
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTutorTaskContext(): TutorTaskContext {
  return useSyncExternalStore(subscribe, getTaskContext, getTaskContext)
}

export function buildTutorPageContext(pathname: string): string {
  const context = getTaskContext()
  const lines: string[] = [`current_page: ${pathname}`]
  if (context.course_title) lines.push(`course: ${context.course_title}`)
  if (context.activity_title) lines.push(`activity: ${context.activity_title}`)
  if (context.assignment_title) lines.push(`assignment: ${context.assignment_title}`)
  if (context.task_title) lines.push(`current_task: ${context.task_title}`)
  if (context.language_id) lines.push(`programming_language_id: ${context.language_id}`)
  if (context.last_run) lines.push(`last_test_run: ${context.last_run}`)
  if (context.code) {
    lines.push(`current_code:\n\`\`\`\n${context.code.slice(0, 6000)}\n\`\`\``)
  }
  if (context.explanation) {
    lines.push(`student_explanation:\n${context.explanation.slice(0, 2000)}`)
  }
  return lines.join('\n').slice(0, 4000)
}
