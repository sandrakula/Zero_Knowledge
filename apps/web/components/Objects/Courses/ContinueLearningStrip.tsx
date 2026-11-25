'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader, asArray } from '@services/utils/ts/requests'

type TrailRun = {
  id: number
  status?: string
  course?: any
  steps?: any[]
  course_total_steps?: number
}

/**
 * "Continue learning" strip for the courses catalog: the learner's current
 * course with its progress, above the catalog itself. Renders nothing when
 * there is nothing in progress.
 */
export default function ContinueLearningStrip({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [run, setRun] = useState<TrailRun | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${getAPIUrl()}trail/`, RequestBodyWithAuthHeader('GET', null, null, token))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const runs = asArray<TrailRun>(data?.runs)
        setRun(
          runs.find((entry) => entry.status === 'STATUS_IN_PROGRESS' && entry.course) || null,
        )
      })
      .catch(() => setRun(null))
    return () => {
      cancelled = true
    }
  }, [token])

  if (!run?.course) return null

  const total = run.course_total_steps || 0
  const done = (run.steps || []).length
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0
  const rawUuid = run.course.course_uuid || run.course.uuid
  const uuid = rawUuid ? String(rawUuid).replace('course_', '') : null

  return (
    <div className="mb-6 flex flex-col items-start justify-between gap-5 overflow-hidden rounded-2xl border border-neutral-800 bg-[#0b0c0d] p-6 text-white sm:flex-row sm:items-center">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
          <BookOpen size={13} />
          {t('cabinet.continue_learning', { defaultValue: 'Continue learning' })}
        </p>
        <p className="mt-2 truncate text-xl font-black tracking-tight">{run.course.name}</p>
        <p className="mt-1 text-sm text-white/50">
          {t('cabinet.lesson_of', {
            defaultValue: 'Lesson {{current}} of {{total}}',
            current: done,
            total,
          })}
          {' · '}
          {percent}%
        </p>
        <div className="mt-4 h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-[#c6ff4a]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {uuid && (
        <Link
          href={getUriWithOrg(orgslug, `/course/${uuid}`)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#c6ff4a] px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90"
        >
          {t('cabinet.continue', { defaultValue: 'Continue' })}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  )
}
