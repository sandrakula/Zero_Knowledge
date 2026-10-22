'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  deleteLessonFeedback,
  getCourseFeedback,
  updateLessonFeedback,
} from '@services/roadmap/roadmap'
import { Check, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

type FeedbackRow = {
  feedback_uuid: string
  activity_uuid?: string | null
  activity_name?: string | null
  chapter_name?: string | null
  username?: string | null
  user_id: number
  rating?: number | null
  content: string
  status: 'OPEN' | 'RESOLVED'
  creation_date: string
  update_date: string
}

type CourseStructure = {
  course_uuid: string
  name: string
}

export default function EditCourseFeedback() {
  const courseState = useCourse()
  const structure = courseState?.courseStructure as CourseStructure | undefined
  const org = useOrg()
  const session = useLHSession()
  const accessToken = session?.data?.tokens?.access_token

  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const courseUuid = structure?.course_uuid

  const load = useCallback(async () => {
    if (!accessToken || !courseUuid) return
    setLoading(true)
    try {
      const data = await getCourseFeedback(
        courseUuid,
        accessToken,
        filter === 'ALL' ? undefined : filter
      )
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load feedback')
    } finally {
      setLoading(false)
    }
  }, [accessToken, courseUuid, filter])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(
    () => ({
      open: rows.filter((row) => row.status === 'OPEN').length,
      resolved: rows.filter((row) => row.status === 'RESOLVED').length,
    }),
    [rows]
  )

  async function resolve(row: FeedbackRow) {
    if (!accessToken) return
    setBusy(row.feedback_uuid)
    try {
      await updateLessonFeedback(
        row.feedback_uuid,
        { status: row.status === 'OPEN' ? 'RESOLVED' : 'OPEN' },
        accessToken
      )
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update')
    } finally {
      setBusy(null)
    }
  }

  async function remove(row: FeedbackRow) {
    if (!accessToken) return
    setBusy(row.feedback_uuid)
    try {
      await deleteLessonFeedback(row.feedback_uuid, accessToken)
      setRows((current) => current.filter((item) => item.feedback_uuid !== row.feedback_uuid))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete')
    } finally {
      setBusy(null)
    }
  }

  const courseSlug = (courseUuid || '').replace(/^course_/, '')
  const orgSlug = org?.slug

  return (
    <div className="p-4 sm:p-8 space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lesson feedback</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comments learners left on individual lessons. Resolve them after you
            update the course.
          </p>
        </div>
        <div className="flex rounded-full bg-gray-100 p-1 text-xs font-semibold">
          {(['ALL', 'OPEN', 'RESOLVED'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1.5 ${
                filter === value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
              }`}
            >
              {value === 'ALL' ? `All (${rows.length})` : value === 'OPEN' ? `Open (${counts.open})` : `Resolved (${counts.resolved})`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white nice-shadow overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> Loading feedback…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            <MessageSquare className="mx-auto mb-3 text-gray-300" size={28} />
            No feedback yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((row) => (
              <article key={row.feedback_uuid} className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-gray-800">{row.activity_name || 'Lesson'}</span>
                    {row.chapter_name && (
                      <span className="text-gray-400">in {row.chapter_name}</span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        row.status === 'OPEN'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {row.status}
                    </span>
                    {row.rating ? (
                      <span className="text-amber-500">{'★'.repeat(row.rating)}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                    {row.content || <span className="text-gray-400">(rating only)</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
                    <span>{row.username || `user #${row.user_id}`}</span>
                    <span>{new Date(row.update_date || row.creation_date).toLocaleString()}</span>
                    {orgSlug && row.activity_uuid && (
                      <a
                        className="text-gray-600 underline underline-offset-2 hover:text-gray-900"
                        href={`/orgs/${orgSlug}/course/${courseSlug}/activity/${row.activity_uuid.replace(/^activity_/, '')}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open lesson
                      </a>
                    )}
                    {orgSlug && (
                      <a
                        className="text-gray-600 underline underline-offset-2 hover:text-gray-900"
                        href={`/orgs/${orgSlug}/dash/courses/course/${courseSlug}/content`}
                      >
                        edit course
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => resolve(row)}
                    disabled={busy === row.feedback_uuid}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    <Check size={13} />
                    {row.status === 'OPEN' ? 'Resolve' : 'Reopen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    disabled={busy === row.feedback_uuid}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
