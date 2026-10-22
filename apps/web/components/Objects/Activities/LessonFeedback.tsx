'use client'

import React, { useEffect, useState } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getMyLessonFeedback,
  saveLessonFeedback,
} from '@services/roadmap/roadmap'
import { Check, MessageSquare, Star } from 'lucide-react'

type LessonFeedbackProps = {
  activity: {
    activity_uuid: string
  }
}

type FeedbackRow = {
  feedback_uuid: string
  rating?: number | null
  content: string
  status: 'OPEN' | 'RESOLVED'
}

export default function LessonFeedback({ activity }: LessonFeedbackProps) {
  const session = useLHSession()
  const accessToken = session?.data?.tokens?.access_token
  const [feedback, setFeedback] = useState<FeedbackRow | null>(null)
  const [content, setContent] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!accessToken) {
        setLoaded(true)
        return
      }
      try {
        const row = await getMyLessonFeedback(activity.activity_uuid, accessToken)
        if (!cancelled && row) {
          setFeedback(row as FeedbackRow)
          setContent(row.content || '')
          setRating(row.rating ?? null)
        }
      } catch {
        // A lesson can be read anonymously; feedback just stays empty then.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [accessToken, activity.activity_uuid])

  if (!accessToken || !loaded) return null

  async function submit() {
    if (!accessToken) return
    if (!content.trim() && rating === null) {
      setError('Add a comment or a rating first.')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const row = await saveLessonFeedback(
        activity.activity_uuid,
        { content: content.trim(), rating },
        accessToken
      )
      setFeedback(row as FeedbackRow)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feedback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-xl bg-white nice-shadow p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare size={18} className="text-gray-500" />
        <h2 className="font-bold text-gray-800 text-sm sm:text-base">
          Feedback for this lesson
        </h2>
        {feedback?.status === 'RESOLVED' && (
          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
            Resolved
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Your instructor sees this in the course dashboard. It stays editable until
        the lesson is marked resolved.
      </p>

      <div className="flex items-center gap-1 mb-3" aria-label="Lesson rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(rating === value ? null : value)}
            className="p-1 rounded-md hover:bg-amber-50 transition-colors"
            aria-label={`${value} out of 5`}
            aria-pressed={rating === value}
          >
            <Star
              size={20}
              className={
                rating !== null && value <= rating
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-gray-300'
              }
            />
          </button>
        ))}
        {rating !== null && (
          <button
            type="button"
            onClick={() => setRating(null)}
            className="ms-2 text-xs text-gray-400 hover:text-gray-600"
          >
            clear
          </button>
        )}
      </div>

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="What was unclear? What should change in this lesson?"
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-gray-300"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-full bg-gray-900 px-5 py-2 text-xs font-bold text-white disabled:opacity-50 hover:bg-gray-800 transition-colors"
        >
          {saving ? 'Saving…' : feedback ? 'Update feedback' : 'Send feedback'}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <Check size={14} /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </section>
  )
}
