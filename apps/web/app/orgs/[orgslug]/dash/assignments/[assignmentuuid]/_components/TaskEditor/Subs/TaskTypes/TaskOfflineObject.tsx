'use client'

import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import {
  getAssignmentTask,
  getAssignmentTaskSubmissionsMe,
  getAssignmentTaskSubmissionsUser,
  handleAssignmentTaskSubmission,
  updateAssignmentTask,
} from '@services/courses/assignments'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { applyManualGrade } from './applyManualGrade'

type OfflineContents = { instructions?: string }

type TaskOfflineObjectProps = {
  view: 'teacher' | 'student' | 'grading'
  assignmentTaskUUID?: string
  user_id?: string
  onGraded?: () => void
}

const DEFAULT_CONTENTS: OfflineContents = { instructions: '' }

function normalizeContents(raw: unknown): OfflineContents {
  if (!raw || typeof raw !== 'object' || !('instructions' in raw)) {
    return DEFAULT_CONTENTS
  }
  return {
    instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
  }
}

function taskSubmissionResponse(value: unknown): string {
  if (!value || typeof value !== 'object' || !('response' in value)) return ''
  return typeof value.response === 'string' ? value.response : ''
}

export default function TaskOfflineObject({
  view,
  assignmentTaskUUID,
  user_id,
  onGraded,
}: TaskOfflineObjectProps) {
  const { t } = useTranslation()
  const session = useLHSession() as { data?: { tokens?: { access_token?: string }; user?: { username?: string } } }
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as {
    assignmentTask?: { assignment_task_uuid?: string; contents?: unknown; description?: string; max_grade_value?: number }
  }
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as (action: { type: string }) => void
  const assignment = useAssignments() as { assignment_object?: { assignment_uuid?: string } }
  const assignmentUUID = assignment?.assignment_object?.assignment_uuid

  const [contents, setContents] = useState<OfflineContents>(DEFAULT_CONTENTS)
  const [taskDescription, setTaskDescription] = useState('')
  const [maxPoints, setMaxPoints] = useState(100)
  const [response, setResponse] = useState('')
  const [initialResponse, setInitialResponse] = useState('')
  const [userSubmissions, setUserSubmissions] = useState<{
    assignment_task_submission_uuid?: string
    grade?: number
    task_submission_grade_feedback?: string
    task_submission?: Record<string, unknown>
  } | null>(null)
  const interactedRef = React.useRef(false)

  useEffect(() => {
    if (view === 'teacher' && assignmentTaskState?.assignmentTask) {
      setContents(normalizeContents(assignmentTaskState.assignmentTask.contents))
      setTaskDescription(assignmentTaskState.assignmentTask.description || '')
      setMaxPoints(assignmentTaskState.assignmentTask.max_grade_value || 100)
    }
  }, [view, assignmentTaskState])

  async function loadTask() {
    if (!assignmentTaskUUID) return
    const res = await getAssignmentTask(assignmentTaskUUID, access_token || '')
    if (res.success && res.data) {
      setContents(normalizeContents(res.data.contents))
      setTaskDescription(res.data.description || '')
      setMaxPoints(res.data.max_grade_value || 100)
    }
  }

  async function loadOwnSubmission() {
    if (!assignmentTaskUUID || !assignmentUUID) return
    const res = await getAssignmentTaskSubmissionsMe(assignmentTaskUUID, assignmentUUID, access_token || '')
    if (res.success && res.data) {
      setUserSubmissions(res.data)
      const saved = taskSubmissionResponse(res.data.task_submission)
      setInitialResponse(saved)
      if (!interactedRef.current) setResponse(saved)
    }
  }

  async function loadUserSubmission() {
    if (!assignmentTaskUUID || !assignmentUUID || !user_id) return
    const res = await getAssignmentTaskSubmissionsUser(
      assignmentTaskUUID,
      user_id,
      assignmentUUID,
      access_token || ''
    )
    if (res.success && res.data) {
      setUserSubmissions(res.data)
      const saved = taskSubmissionResponse(res.data.task_submission)
      setResponse(saved)
      setInitialResponse(saved)
    }
  }

  useEffect(() => {
    if (view === 'student') {
      loadTask()
      loadOwnSubmission()
    } else if (view === 'grading') {
      loadTask()
      loadUserSubmission()
    }
  }, [view, assignmentTaskUUID, assignmentUUID, access_token])

  async function saveFC() {
    if (!assignmentTaskState?.assignmentTask?.assignment_task_uuid) return
    const res = await updateAssignmentTask(
      { contents },
      assignmentTaskState.assignmentTask.assignment_task_uuid,
      assignmentUUID || '',
      access_token || ''
    )
    if (res.success) {
      assignmentTaskStateHook({ type: 'reload' })
      toast.success(t('dashboard.assignments.editor.toasts.task_updated'))
    } else {
      toast.error(t('dashboard.assignments.editor.toasts.task_update_error'))
    }
  }

  async function submitFC(opts?: { silent?: boolean }) {
    if (!assignmentTaskUUID || !assignmentUUID) return false
    const values = {
      assignment_task_submission_uuid: userSubmissions?.assignment_task_submission_uuid || null,
      task_submission: { response },
      grade: 0,
      task_submission_grade_feedback: '',
    }
    const res = await handleAssignmentTaskSubmission(
      values,
      assignmentTaskUUID,
      assignmentUUID,
      access_token || ''
    )
    if (res.success) {
      setUserSubmissions(res.data)
      setInitialResponse(response)
      if (!opts?.silent) toast.success(t('dashboard.assignments.editor.toasts.task_saved'))
      return true
    }
    if (!opts?.silent) toast.error(t('dashboard.assignments.editor.toasts.task_save_error'))
    return false
  }

  async function gradeCustomFC(grade: number, feedback?: string) {
    if (!userSubmissions || !assignmentTaskUUID || !assignmentUUID) return
    await applyManualGrade({
      grade,
      feedback,
      maxPoints,
      assignmentTaskUUID,
      assignmentUUID,
      accessToken: access_token || '',
      username: session?.data?.user?.username,
      assignmentTaskSubmissionUUID: userSubmissions.assignment_task_submission_uuid,
      taskSubmissionPayload: userSubmissions.task_submission,
      onSuccess: () => {
        loadUserSubmission()
        onGraded?.()
      },
    })
  }

  return (
    <AssignmentBoxUI
      type="offline"
      view={view}
      saveFC={saveFC}
      submitFC={submitFC}
      taskUUID={assignmentTaskUUID}
      gradeCustomFC={gradeCustomFC}
      currentPoints={userSubmissions?.grade}
      currentFeedback={userSubmissions?.task_submission_grade_feedback}
      maxPoints={maxPoints}
      dirtyValue={response}
      savedValue={initialResponse}
    >
      <div className="flex flex-col space-y-4">
        {view === 'teacher' && (
          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold text-slate-500">
              {t('dashboard.assignments.editor.task_editor.offline.instructions', {
                defaultValue: 'Instructions for the learner (optional)',
              })}
            </label>
            <textarea
              value={contents.instructions || ''}
              onChange={(event) =>
                setContents((current) => ({ ...current, instructions: event.target.value }))
              }
              rows={5}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder={t('dashboard.assignments.editor.task_editor.offline.instructions_placeholder', {
                defaultValue: 'What should the learner do or bring to the in-person session?',
              })}
            />
            {taskDescription && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap">{taskDescription}</p>
            )}
          </div>
        )}

        {view !== 'teacher' && (contents.instructions || taskDescription) && (
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">
            {contents.instructions || taskDescription}
          </div>
        )}

        {view === 'student' && (
          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold text-slate-500">
              {t('dashboard.assignments.editor.task_editor.offline.response', {
                defaultValue: 'Your response / notes',
              })}
            </label>
            <textarea
              value={response}
              onChange={(event) => {
                interactedRef.current = true
                setResponse(event.target.value)
              }}
              rows={6}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
        )}

        {view === 'grading' && (
          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold text-slate-500">
              {t('dashboard.assignments.editor.task_editor.offline.student_response', {
                defaultValue: "Learner's response",
              })}
            </label>
            <pre className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">
              {response || '—'}
            </pre>
          </div>
        )}
      </div>
    </AssignmentBoxUI>
  )
}
