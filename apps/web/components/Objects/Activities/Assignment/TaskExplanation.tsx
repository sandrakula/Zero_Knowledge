'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
} from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import {
  getMyTaskExplanation,
  getTaskExplanationForUser,
  submitTaskExplanation,
  type TaskExplanation as TaskExplanationData,
} from '@services/courses/explanations'
import { getTaskContext } from '@/lib/tutor/task-context'
import { transcribeAudio } from '@services/ai/asr'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

type TaskExplanationProps = {
  assignmentTaskUUID: string
  assignmentUUID?: string
  view: 'student' | 'grading'
  userId?: string | number
}

const MIN_CHARS = 20
const MAX_CHARS = 5000

const LEVEL_STYLES: Record<string, { label: string; className: string; bar: string }> = {
  excellent: { label: 'Отлично', className: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  good: { label: 'Хорошо', className: 'bg-sky-50 text-sky-700', bar: 'bg-sky-500' },
  partial: { label: 'Частично', className: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' },
  weak: { label: 'Слабо', className: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' },
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export default function TaskExplanation({
  assignmentTaskUUID,
  assignmentUUID,
  view,
  userId,
}: TaskExplanationProps) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const assignment = useAssignments() as any
  const submissionState = useAssignmentSubmission() as any

  const resolvedAssignmentUUID =
    assignmentUUID || assignment?.assignment_object?.assignment_uuid
  const weight = useMemo(() => {
    const task = (assignment?.assignment_tasks || []).find(
      (item: any) => item.assignment_task_uuid === assignmentTaskUUID
    )
    const raw = Number(task?.contents?.explanation_weight || 0)
    return Number.isFinite(raw) ? Math.max(0, Math.min(raw, 100)) : 0
  }, [assignment?.assignment_tasks, assignmentTaskUUID])

  const latestStatus = Array.isArray(submissionState)
    ? submissionState[0]?.submission_status
    : null
  const lockedBySubmission =
    view === 'student' && (latestStatus === 'SUBMITTED' || latestStatus === 'GRADED')
  const readOnly = view === 'grading' || lockedBySubmission

  const [data, setData] = useState<TaskExplanationData | null>(null)
  const [text, setText] = useState('')
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text')
  const [loading, setLoading] = useState(false)
  const [assessing, setAssessing] = useState(false)
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const [recordingSupported, setRecordingSupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setSupported(!!getRecognitionCtor())
    setRecordingSupported(
      typeof window !== 'undefined' &&
        typeof MediaRecorder !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia
    )
  }, [])

  useEffect(() => {
    if (!resolvedAssignmentUUID || !assignmentTaskUUID || !accessToken) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const request =
      view === 'grading' && userId
        ? getTaskExplanationForUser(
            resolvedAssignmentUUID,
            assignmentTaskUUID,
            userId,
            accessToken
          )
        : getMyTaskExplanation(resolvedAssignmentUUID, assignmentTaskUUID, accessToken)
    request
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setData(res.data)
          setText(res.data.explanation_text || '')
          setInputMode(res.data.input_mode === 'voice' ? 'voice' : 'text')
        } else if (res.success) {
          setData(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить объяснение')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resolvedAssignmentUUID, assignmentTaskUUID, accessToken, view, userId])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      if (recordTimerRef.current) {
        window.clearTimeout(recordTimerRef.current)
        recordTimerRef.current = null
      }
      try {
        recorderRef.current?.stop()
      } catch {
        /* already stopped */
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening()
      return
    }
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      toast.error('Голосовой ввод не поддерживается этим браузером. Используй текст.')
      return
    }
    const recognition = new Ctor()
    recognition.lang = document.documentElement.lang || 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event: any) => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript
      }
      const clean = finalText.trim()
      if (!clean) return
      setInputMode('voice')
      setText((previous) => {
        const separator = previous && !previous.endsWith(' ') ? ' ' : ''
        return `${previous}${separator}${clean}`.slice(0, MAX_CHARS)
      })
    }
    recognition.onerror = (event: any) => {
      if (event?.error !== 'aborted' && event?.error !== 'no-speech') {
        toast.error('Не удалось распознать речь. Попробуй ещё раз.')
      }
      setListening(false)
      recognitionRef.current = null
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }, [listening, stopListening])

  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current)
      recordTimerRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (recording || transcribing) return
    if (!accessToken) {
      toast.error('Нужна авторизация')
      return
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      toast.error('Запись с микрофона не поддерживается этим браузером.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        if (recordTimerRef.current) {
          window.clearTimeout(recordTimerRef.current)
          recordTimerRef.current = null
        }
        stream.getTracks().forEach((track) => track.stop())
        if (streamRef.current === stream) streamRef.current = null
        recorderRef.current = null
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mime || 'audio/webm',
        })
        chunksRef.current = []
        setRecording(false)
        if (blob.size < 1000) {
          setError('Запись слишком короткая. Попробуйте ещё раз.')
          return
        }
        setTranscribing(true)
        setError(null)
        try {
          const result = await transcribeAudio(blob, accessToken)
          const clean = (result.text || '').trim()
          if (!clean) {
            setError('Не удалось распознать речь. Попробуйте записать ещё раз.')
            return
          }
          setInputMode('voice')
          setText((previous) => {
            const separator = previous && !previous.endsWith(' ') ? ' ' : ''
            return `${previous}${separator}${clean}`.slice(0, MAX_CHARS)
          })
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : 'Не удалось распознать запись. Попробуйте ещё раз.'
          )
        } finally {
          setTranscribing(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setError(null)
      recordTimerRef.current = window.setTimeout(() => {
        try {
          recorder.stop()
        } catch {
          /* already stopped */
        }
      }, 120000)
    } catch {
      setError('Нет доступа к микрофону. Разрешите запись в браузере.')
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [accessToken, recording, transcribing])

  const assess = useCallback(async () => {
    const trimmed = text.trim()
    if (trimmed.length < MIN_CHARS) {
      toast.error(`Напиши хотя бы ${MIN_CHARS} символов`)
      return
    }
    if (!resolvedAssignmentUUID || !accessToken || assessing) return
    const context = getTaskContext(assignmentTaskUUID)
    const code =
      context.code || data?.source_code || ''
    if (!code.trim()) {
      toast.error('Сначала напиши код и запусти его, чтобы было что объяснять')
      return
    }
    setAssessing(true)
    setError(null)
    try {
      const res = await submitTaskExplanation(
        resolvedAssignmentUUID,
        assignmentTaskUUID,
        {
          explanation: trimmed,
          input_mode: inputMode,
          source_code: code,
          language_id: context.language_id ?? data?.language_id ?? null,
        },
        accessToken
      )
      if (res.success && res.data) {
        setData(res.data)
        setText(res.data.explanation_text || trimmed)
        toast.success('Оценка готова')
      } else {
        setError(
          typeof res.data?.detail === 'string'
            ? res.data.detail
            : 'Не удалось оценить объяснение'
        )
      }
    } catch {
      setError('Не удалось оценить объяснение')
    } finally {
      setAssessing(false)
    }
  }, [
    accessToken,
    assessing,
    assignmentTaskUUID,
    data?.language_id,
    data?.source_code,
    inputMode,
    resolvedAssignmentUUID,
    text,
  ])

  const level = data?.ai_level ? LEVEL_STYLES[data.ai_level] : null
  const score = typeof data?.ai_score === 'number' ? data.ai_score : null
  const unchanged = !!data && text.trim() === (data.explanation_text || '').trim()

  return (
    <div className='mt-4 rounded-xl border border-slate-200 bg-white p-4 nice-shadow'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-2.5'>
          <div className='mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600'>
            <Brain size={17} />
          </div>
          <div>
            <p className='text-sm font-bold text-slate-900'>Объясни решение</p>
            <p className='text-xs text-slate-500 leading-relaxed'>
              Расскажи идею, шаги и сложность своего кода. ИИ проверит, насколько ты сам понимаешь решение.
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          {weight > 0 ? (
            <span className='rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700'>
              влияет на оценку: {weight}%
            </span>
          ) : (
            <span className='rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500'>
              на оценку не влияет
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className='mt-4 flex items-center gap-2 text-xs text-slate-400'>
          <Loader2 size={14} className='animate-spin' />
          Загружаю объяснение...
        </div>
      ) : (
        <>
          {score !== null && level && (
            <div className='mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5'>
              <div className='flex items-center justify-between gap-3'>
                <div className='flex items-center gap-2'>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${level.className}`}>
                    {level.label}
                  </span>
                  <span className='text-[11px] font-medium text-slate-500'>
                    понимание решения
                  </span>
                </div>
                <div className='flex items-baseline gap-1'>
                  <span className='text-2xl font-black text-slate-900 tabular-nums'>{score}</span>
                  <span className='text-xs font-semibold text-slate-400'>/100</span>
                </div>
              </div>
              <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white'>
                <div
                  className={`h-full rounded-full ${level.bar}`}
                  style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
              </div>
              {data?.ai_feedback && (
                <p className='mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-700'>
                  {data.ai_feedback}
                </p>
              )}
              <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                {!!data?.ai_strengths?.length && (
                  <div className='rounded-lg bg-emerald-50/70 p-2.5'>
                    <p className='flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700'>
                      <CheckCircle2 size={11} /> Получилось
                    </p>
                    <ul className='mt-1 space-y-0.5 text-[11px] text-emerald-900'>
                      {data.ai_strengths.map((item, index) => (
                        <li key={`strength-${index}`}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!data?.ai_gaps?.length && (
                  <div className='rounded-lg bg-amber-50/70 p-2.5'>
                    <p className='flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700'>
                      <AlertTriangle size={11} /> Что уточнить
                    </p>
                    <ul className='mt-1 space-y-0.5 text-[11px] text-amber-900'>
                      {data.ai_gaps.map((item, index) => (
                        <li key={`gap-${index}`}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className='mt-2.5 text-[10px] text-slate-400'>
                Попытка {data?.attempt_count || 1}
                {data?.updated_at
                  ? ` · ${String(data.updated_at).replace('T', ' ').slice(0, 16)}`
                  : ''}
              </p>
            </div>
          )}

          {!data && view === 'grading' && (
            <p className='mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500'>
              Студент не оставил объяснения к этому решению.
            </p>
          )}

          {(view === 'student' || data) && (
            <div className='mt-4'>
              <label className='text-[11px] font-semibold text-slate-500'>
                Твоё объяснение
              </label>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, MAX_CHARS))}
                disabled={readOnly || assessing || transcribing}
                rows={5}
                placeholder={
                  view === 'student'
                    ? 'Например: я считываю n, затем иду циклом по массиву... Сложность O(n), потому что... Крайний случай — пустой ввод — обрабатываю так...'
                    : ''
                }
                className='mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-500'
              />
              <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  {view === 'student' && supported && (
                    <button
                      type='button'
                      onClick={toggleListening}
                      disabled={readOnly || assessing}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        listening
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {listening ? <MicOff size={13} /> : <Mic size={13} />}
                      {listening ? 'Остановить' : 'Голосом'}
                    </button>
                  )}
                  {view === 'student' && !supported && recordingSupported && (
                    <button
                      type='button'
                      onClick={recording ? stopRecording : startRecording}
                      disabled={readOnly || assessing || transcribing}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        recording
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {transcribing ? (
                        <Loader2 size={13} className='animate-spin' />
                      ) : recording ? (
                        <MicOff size={13} />
                      ) : (
                        <Mic size={13} />
                      )}
                      {transcribing
                        ? 'Распознаю…'
                        : recording
                          ? 'Остановить запись'
                          : 'Голосом'}
                    </button>
                  )}
                  <span className='text-[10px] text-slate-400'>
                    {text.trim().length}/{MAX_CHARS}
                  </span>
                  {inputMode === 'voice' && (
                    <span className='rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700'>
                      голос
                    </span>
                  )}
                </div>
                {view === 'student' && (
                  <button
                    type='button'
                    onClick={assess}
                    disabled={readOnly || assessing || transcribing || text.trim().length < MIN_CHARS}
                    className='flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {assessing ? (
                      <Loader2 size={13} className='animate-spin' />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    {assessing ? 'Проверяю...' : data ? 'Переоценить' : 'Оценить объяснение'}
                  </button>
                )}
              </div>
              {!readOnly && text.trim().length > 0 && text.trim().length < MIN_CHARS && (
                <p className='mt-1 text-[10px] text-amber-600'>
                  Ещё {MIN_CHARS - text.trim().length} символ(ов) до минимальной длины.
                </p>
              )}
              {lockedBySubmission && (
                <p className='mt-1 text-[10px] text-slate-400'>
                  Задание сдано — объяснение доступно только для просмотра.
                </p>
              )}
              {supported && !readOnly && (
                <p className='mt-1 flex items-center gap-1 text-[10px] text-slate-400'>
                  <Lightbulb size={10} />
                  Распознавание речи выполняет браузер; аудио не загружается на сервер.
                </p>
              )}
              {!supported && recordingSupported && !readOnly && (
                <p className='mt-1 flex items-center gap-1 text-[10px] text-slate-400'>
                  <Lightbulb size={10} />
                  Запись отправится на сервер и распознается локально через faster-whisper.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className='mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700'>{error}</p>
          )}
          {data && !unchanged && view === 'student' && !readOnly && (
            <p className='mt-2 text-[10px] text-slate-400'>
              Текст изменён — нажми «Переоценить», чтобы обновить оценку.
            </p>
          )}
        </>
      )}
    </div>
  )
}
