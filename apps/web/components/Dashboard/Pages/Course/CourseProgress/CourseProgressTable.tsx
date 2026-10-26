'use client'

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Users } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  getAssignmentTaskSubmissionsUser,
  getAssignmentTasks,
  getInstructorAssignmentAttempts,
  type AssignmentAttempt,
} from '@services/courses/assignments'
import {
  type CourseProgressAssignment,
  type CourseProgressStudent,
  type CourseProgressSummary,
  getCourseProgressSummary,
} from '@services/courses/courses'
import CourseStruggleMap from './CourseStruggleMap'

function isProgressSummary(value: unknown): value is CourseProgressSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { students?: unknown; assignments?: unknown }
  return Array.isArray(candidate.students) && Array.isArray(candidate.assignments)
}

function statusClass(status: string): string {
  switch (status) {
    case 'GRADED':
      return 'bg-emerald-50 text-emerald-700'
    case 'SUBMITTED':
    case 'PENDING':
      return 'bg-sky-50 text-sky-700'
    case 'LATE':
      return 'bg-amber-50 text-amber-700'
    default:
      return 'bg-slate-100 text-slate-500'
  }
}

function assignmentLabel(card: CourseProgressAssignment): string {
  if (card.submission_status === 'GRADED') {
    return `${card.grade}/${card.max_grade || '—'}`
  }
  return card.submission_status.replaceAll('_', ' ')
}

type DrillTask = {
  assignment_task_uuid: string
  title: string
  assignment_type: string
  max_grade_value: number
}

type DrillSubmission = {
  grade?: number
  task_submission?: Record<string, unknown>
  task_submission_grade_feedback?: string
  manually_graded?: boolean
}

function isTaskList(value: unknown): value is DrillTask[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        'assignment_task_uuid' in item &&
        'title' in item &&
        'assignment_type' in item
    )
  )
}

function isSubmission(value: unknown): value is DrillSubmission {
  return !!value && typeof value === 'object' && 'grade' in value
}

function isAttemptList(value: unknown): value is AssignmentAttempt[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        'attempt_number' in item &&
        'verdict' in item
    )
  )
}

function DrilldownModal({
  state,
  token,
  onClose,
}: {
  state: { student: CourseProgressStudent; assignment: CourseProgressAssignment } | null
  token?: string
  onClose: () => void
}) {
  const student = state?.student
  const assignment = state?.assignment
  const { data = [], isLoading } = useQuery({
    queryKey: ['progress-drilldown', assignment?.assignment_uuid, student?.user_id],
    queryFn: async () => {
      if (!student || !assignment || !token) return []
      const tasksRes = await getAssignmentTasks(assignment.assignment_uuid, token)
      if (!tasksRes.success || !isTaskList(tasksRes.data)) return []
      return Promise.all(
        tasksRes.data.map(async (task) => {
          const [submissionRes, attemptsRes] = await Promise.all([
            getAssignmentTaskSubmissionsUser(
              task.assignment_task_uuid,
              String(student.user_id),
              assignment.assignment_uuid,
              token
            ),
            task.assignment_type === 'CODE'
              ? getInstructorAssignmentAttempts(
                  assignment.assignment_uuid,
                  task.assignment_task_uuid,
                  student.user_id,
                  token
                )
              : Promise.resolve(null),
          ])
          return {
            task,
            submission:
              submissionRes.success && isSubmission(submissionRes.data)
                ? submissionRes.data
                : null,
            attempts:
              attemptsRes && attemptsRes.success && isAttemptList(attemptsRes.data)
                ? attemptsRes.data
                : [],
          }
        })
      )
    },
    enabled: !!state && !!token,
    staleTime: 5_000,
  })

  return (
    <Modal
      isDialogOpen={!!state}
      onOpenChange={(open) => !open && onClose()}
      minWidth="lg"
      dialogTitle={
        student
          ? `${student.first_name || student.username} · ${assignment?.title || 'Assignment'}`
          : 'Student progress'
      }
      dialogDescription="Task submissions and CODE attempt history for this learner."
      dialogContent={
        <div className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin me-2" />
              Loading…
            </div>
          )}
          {!isLoading && data.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-400">
              No tasks in this assignment.
            </div>
          )}
          {data.map(({ task, submission, attempts }) => (
            <div key={task.assignment_task_uuid} className="rounded-lg border border-gray-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-sm text-gray-800">{task.title}</div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">
                    {task.assignment_type}
                  </span>
                  {submission ? (
                    <span className="font-semibold text-gray-700">
                      {submission.grade ?? 0}/{task.max_grade_value}
                    </span>
                  ) : (
                    <span className="text-gray-400">no submission</span>
                  )}
                </div>
              </div>
              {submission?.task_submission_grade_feedback && (
                <p className="mt-1 text-xs text-gray-500 whitespace-pre-wrap">
                  {submission.task_submission_grade_feedback}
                </p>
              )}
              {typeof submission?.task_submission?.response === 'string' &&
                submission.task_submission.response.length > 0 && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                    {submission.task_submission.response}
                  </pre>
                )}
              {attempts.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Attempts
                  </div>
                  {attempts.map((attempt) => (
                    <details
                      key={attempt.attempt_uuid}
                      className="rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-600"
                    >
                      <summary className="flex flex-wrap items-center gap-2 cursor-pointer">
                        <span className="font-semibold">#{attempt.attempt_number}</span>
                        <span className={`rounded-full px-1.5 py-0.5 font-semibold ${statusClass(attempt.verdict === 'ACCEPTED' ? 'GRADED' : attempt.verdict)}`}>
                          {attempt.verdict.replaceAll('_', ' ')}
                        </span>
                        <span>{attempt.passed_tests}/{attempt.total_tests}</span>
                        <span className="text-gray-400">
                          {new Date(attempt.created_date).toLocaleString()}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        {attempt.test_results?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {attempt.test_results.map((result) => (
                              <span
                                key={result.id}
                                className={`rounded-full px-1.5 py-0.5 font-semibold ${
                                  result.passed
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-rose-50 text-rose-700'
                                }`}
                                title={result.status}
                              >
                                {result.label || result.id}: {result.passed ? 'pass' : 'fail'}
                              </span>
                            ))}
                          </div>
                        )}
                        {attempt.source_code && (
                          <pre
                            dir="ltr"
                            className="max-h-56 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100"
                          >
                            {attempt.source_code}
                          </pre>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      }
    />
  )
}

export default function CourseProgressTable({ courseUUID }: { courseUUID: string }) {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const access_token = session?.data?.tokens?.access_token
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [drilldown, setDrilldown] = useState<{
    student: CourseProgressStudent
    assignment: CourseProgressAssignment
  } | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['course-progress', courseUUID, page],
    queryFn: async () => {
      const res = await getCourseProgressSummary(courseUUID, access_token, page, 50)
      return res.success && isProgressSummary(res.data) ? res.data : null
    },
    enabled: !!access_token,
    staleTime: 10_000,
  })

  const students: CourseProgressStudent[] = data?.students ?? []
  const assignments: CourseProgressAssignment[] = data?.assignments ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.total_students / (data.limit || 50))) : 1

  const stats = useMemo(() => {
    if (!students.length) return { avg: 0, complete: 0 }
    return {
      avg: Math.round(students.reduce((sum, row) => sum + row.percent, 0) / students.length),
      complete: students.filter((row) => row.completed_assignments === assignments.length).length,
    }
  }, [students, assignments.length])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-gray-400">
        <Loader2 size={18} className="animate-spin me-2" />
        Loading progress…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        Could not load course progress.
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Students and progress</h2>
          <p className="text-xs text-gray-500">
            {data.total_students} enrolled · {assignments.length} assignments · average {stats.avg}% ·
            {` ${stats.complete} fully complete`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Users size={14} />
          Includes learners with no submissions
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white nice-shadow">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/70 text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">Student</th>
              <th className="px-3 py-3 text-start font-semibold">Status</th>
              <th className="px-3 py-3 text-end font-semibold">Completed</th>
              <th className="px-3 py-3 text-end font-semibold">Submitted</th>
              <th className="px-3 py-3 text-end font-semibold">Required</th>
              <th className="px-3 py-3 text-end font-semibold">Progress</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  No enrolled learners yet.
                </td>
              </tr>
            )}
            {students.map((student) => {
              const isOpen = expanded === student.user_id
              return (
                <React.Fragment key={student.user_id}>
                  <tr className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">
                        {student.first_name || student.last_name
                          ? `${student.first_name} ${student.last_name}`.trim()
                          : student.username}
                      </div>
                      <div className="text-xs text-gray-400">{student.email}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {student.enrollment_status?.replaceAll('_', ' ').toLowerCase() || 'not enrolled'}
                    </td>
                    <td className="px-3 py-3 text-end tabular-nums text-gray-700">
                      {student.completed_assignments}/{assignments.length}
                    </td>
                    <td className="px-3 py-3 text-end tabular-nums text-gray-700">
                      {student.submitted_assignments}
                    </td>
                    <td className="px-3 py-3 text-end tabular-nums text-gray-700">
                      {student.required_assignments}
                    </td>
                    <td className="px-3 py-3 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(0, Math.min(100, student.percent))}%` }}
                          />
                        </div>
                        <span className="w-10 text-end text-xs font-semibold tabular-nums text-gray-600">
                          {student.percent}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : student.user_id)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                        aria-label="Toggle assignment details"
                      >
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-gray-50 bg-gray-50/40">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {student.assignments.map((card) => (
                            <button
                              type="button"
                              key={card.assignment_uuid}
                              onClick={() => setDrilldown({ student, assignment: card })}
                              className="rounded-lg border border-gray-100 bg-white p-3 text-start hover:border-gray-200 hover:bg-gray-50/50"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-gray-800">
                                    {card.title}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-400">
                                    {card.required ? 'required' : 'optional'}
                                    {!card.published && ' · draft'}
                                    {card.due_date && ` · due ${card.due_date}`}
                                  </div>
                                </div>
                                <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(card.submission_status)}`}>
                                  {assignmentLabel(card)}
                                </span>
                              </div>
                              {card.is_late && (
                                <div className="mt-1 text-[10px] font-semibold text-amber-600">
                                  late submission
                                </div>
                              )}
                              {card.attempt_number > 1 && (
                                <div className="text-[10px] text-gray-400">
                                  attempt {card.attempt_number}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <CourseStruggleMap courseUUID={courseUUID} />

      <DrilldownModal
        state={drilldown}
        token={access_token}
        onClose={() => setDrilldown(null)}
      />
    </div>
  )
}
