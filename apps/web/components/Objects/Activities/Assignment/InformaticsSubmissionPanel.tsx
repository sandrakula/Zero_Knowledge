'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Code2,
  ExternalLink,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getLanguageById } from '@components/Objects/Editor/Extensions/CodePlayground/languages'
import { getUriWithOrg } from '@services/config/config'
import {
  cancelInformaticsSubmission,
  createInformaticsSubmission,
  getInformaticsLink,
  getInformaticsProblem,
  getInformaticsSubmission,
  listInformaticsSubmissions,
  retryInformaticsSubmission,
  type InformaticsAttempt,
  type InformaticsLinkState,
  type InformaticsProblemInfo,
} from '@services/informatics/informatics'

const ACTIVE_STATUSES = new Set(['QUEUED', 'SUBMITTING', 'RUNNING', 'RETRY_WAIT'])

interface InformaticsSubmissionPanelProps {
  problemId?: number | null
  assignmentTaskUuid?: string
  assignmentUuid?: string
  activityUuid?: string
  sourceCode: string
  disabled?: boolean
}

function statusLabel(attempt: InformaticsAttempt): string {
  switch (attempt.status) {
    case 'QUEUED':
    case 'RETRY_WAIT':
      return 'В очереди'
    case 'SUBMITTING':
      return 'Отправляется'
    case 'RUNNING':
      return 'Проверяется…'
    case 'FINAL':
      return attempt.verdict_label || attempt.verdict || 'Проверено'
    case 'FAILED':
      return 'Ошибка'
    case 'CANCELED':
      return 'Отменено'
    default:
      return attempt.status
  }
}

function statusTone(attempt: InformaticsAttempt): string {
  if (attempt.status === 'FINAL') {
    return attempt.verdict === 'ACCEPTED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (attempt.status === 'FAILED') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (attempt.status === 'CANCELED') {
    return 'border-neutral-200 bg-neutral-50 text-neutral-600'
  }
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

export default function InformaticsSubmissionPanel({
  problemId,
  assignmentTaskUuid,
  assignmentUuid,
  activityUuid,
  sourceCode,
  disabled,
}: InformaticsSubmissionPanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token

  const [link, setLink] = useState<InformaticsLinkState | null>(null)
  const [problem, setProblem] = useState<InformaticsProblemInfo | null>(null)
  const [attempt, setAttempt] = useState<InformaticsAttempt | null>(null)
  const [history, setHistory] = useState<InformaticsAttempt[]>([])
  const [languageId, setLanguageId] = useState<number>(71)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef<string>('')

  const loadHistory = useCallback(async () => {
    if (!accessToken || !problemId) return
    try {
      const rows = await listInformaticsSubmissions(
        { problem_id: problemId, limit: 5 },
        accessToken
      )
      setHistory(rows)
    } catch {
      /* history is optional */
    }
  }, [accessToken, problemId])

  const load = useCallback(async () => {
    if (!accessToken || !problemId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [linkState, problemInfo] = await Promise.all([
        getInformaticsLink(accessToken).catch(
          () => ({ linked: false, status: 'UNVERIFIED' }) as InformaticsLinkState
        ),
        getInformaticsProblem(problemId, accessToken).catch(() => null),
      ])
      setLink(linkState)
      setProblem(problemInfo)
      if (problemInfo?.supported_language_ids?.length) {
        setLanguageId((current) =>
          problemInfo.supported_language_ids.includes(current)
            ? current
            : problemInfo.supported_language_ids[0]
        )
      }
      await loadHistory()
    } finally {
      setLoading(false)
    }
  }, [accessToken, problemId, loadHistory])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!attempt || !accessToken || !ACTIVE_STATUSES.has(attempt.status)) return
    const timer = window.setInterval(async () => {
      try {
        const next = await getInformaticsSubmission(attempt.submission_uuid, accessToken)
        setAttempt(next)
        if (!ACTIVE_STATUSES.has(next.status)) {
          void loadHistory()
        }
      } catch {
        /* keep polling */
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [attempt, accessToken, loadHistory])

  const supportedLanguages = useMemo(() => {
    const ids = problem?.supported_language_ids?.length
      ? problem.supported_language_ids
      : [71, 54, 50, 62]
    return ids.map((id) => {
      const lang = getLanguageById(id)
      return { id, name: lang?.name || `Language ${id}` }
    })
  }, [problem])

  const submit = async () => {
    if (!accessToken || !problemId || busy || disabled) return
    setBusy(true)
    try {
      if (!requestIdRef.current) {
        requestIdRef.current =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
      }
      const created = await createInformaticsSubmission(
        {
          problem_id: problemId,
          language_id: languageId,
          source_code: sourceCode,
          assignment_task_uuid: assignmentTaskUuid || '',
          assignment_uuid: assignmentUuid || '',
          activity_uuid: activityUuid || '',
          client_request_id: requestIdRef.current,
        },
        accessToken
      )
      requestIdRef.current = ''
      setAttempt(created)
      await loadHistory()
      toast.success('Задача отправлена в Informatics')
    } catch (error: any) {
      toast.error(error?.message || 'Не удалось отправить задачу')
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!accessToken || !attempt || busy) return
    setBusy(true)
    try {
      const created = await retryInformaticsSubmission(attempt.submission_uuid, accessToken)
      setAttempt(created)
      await loadHistory()
    } catch (error: any) {
      toast.error(error?.message || 'Не удалось повторить отправку')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!accessToken || !attempt || busy) return
    setBusy(true)
    try {
      const canceled = await cancelInformaticsSubmission(attempt.submission_uuid, accessToken)
      setAttempt(canceled)
      await loadHistory()
    } catch (error: any) {
      toast.error(error?.message || 'Не удалось отменить отправку')
    } finally {
      setBusy(false)
    }
  }

  if (!problemId) return null

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-semibold text-black/50">
        <Loader2 size={14} className="animate-spin" />
        {t('informatics.panel_loading', { defaultValue: 'Проверяем подключение к Informatics…' })}
      </div>
    )
  }

  const active = attempt && ACTIVE_STATUSES.has(attempt.status)
  const canRetry =
    attempt &&
    ['FINAL', 'FAILED', 'CANCELED'].includes(attempt.status) &&
    attempt.verdict !== 'ACCEPTED'

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-900 text-white">
            <Code2 size={16} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">
              {t('informatics.panel_kicker', { defaultValue: 'Informatics' })}
            </p>
            <p className="text-sm font-semibold text-black">
              {problem?.title
                ? problem.title
                : t('informatics.panel_problem', { defaultValue: 'Задача №{{id}}', id: problemId })}
            </p>
          </div>
        </div>
        {link?.status && (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
              link.linked && link.status === 'ACTIVE'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {link.linked && link.status === 'ACTIVE'
              ? t('informatics.panel_connected', { defaultValue: 'Аккаунт подключён' })
              : t('informatics.panel_not_connected', { defaultValue: 'Аккаунт не подключён' })}
          </span>
        )}
      </div>

      {!link?.linked || link.status !== 'ACTIVE' ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-amber-800">
            {t('informatics.panel_link_hint', {
              defaultValue:
                'Чтобы сдавать код прямо из LMS, подключите аккаунт informatics.msk.ru по логину и паролю. Пароль шифруется и не возвращается.',
            })}
          </p>
          <Link
            href={getUriWithOrg(org?.slug || '', '/account/informatics')}
            className="inline-flex h-9 flex-none items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white"
          >
            {t('informatics.panel_connect', { defaultValue: 'Подключить' })}
            <ExternalLink size={12} />
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-black/45">
              {t('informatics.panel_language', { defaultValue: 'Язык' })}
              <select
                value={languageId}
                onChange={(event) => setLanguageId(Number(event.target.value))}
                disabled={disabled || busy || !!active}
                className="h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm font-normal normal-case tracking-normal text-black"
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={disabled || busy || !!active}
              className="lh-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {t('informatics.panel_submit', { defaultValue: 'Сдать в Informatics' })}
            </button>
            {active && (
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-black/60 disabled:opacity-50"
              >
                <XCircle size={13} />
                {t('informatics.panel_cancel', { defaultValue: 'Отменить' })}
              </button>
            )}
          </div>

          {attempt && (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusTone(attempt)}`}>
                  {active ? <Loader2 size={11} className="animate-spin" /> : attempt.verdict === 'ACCEPTED' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {statusLabel(attempt)}
                </span>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-black/50">
                  {attempt.status === 'FINAL' && (
                    <>
                      <span>
                        {t('informatics.panel_tests', { defaultValue: 'Тесты' })}: {attempt.tests_passed}/{attempt.tests_total || '—'}
                      </span>
                      <span>
                        {t('informatics.panel_score', { defaultValue: 'Баллы' })}: {attempt.score}/{attempt.max_score || '—'}
                      </span>
                    </>
                  )}
                  {attempt.run_id && <span>run {attempt.run_id}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={11} /> {attempt.created_at?.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
              </div>

              {attempt.compile_output && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-neutral-900 p-2 text-[11px] leading-relaxed text-rose-200" dir="ltr">
                  {attempt.compile_output}
                </pre>
              )}
              {attempt.stderr && !attempt.compile_output && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-neutral-900 p-2 text-[11px] leading-relaxed text-rose-200" dir="ltr">
                  {attempt.stderr}
                </pre>
              )}
              {attempt.last_error && (
                <p className="mt-2 text-[11px] text-rose-700">{attempt.last_error}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {canRetry && (
                  <button
                    type="button"
                    onClick={retry}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-black/70 disabled:opacity-50"
                  >
                    <RotateCcw size={12} />
                    {t('informatics.panel_retry', { defaultValue: 'Повторить' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-black/60 disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                  {t('informatics.panel_refresh', { defaultValue: 'Обновить' })}
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-black/40">
                <History size={12} />
                {t('informatics.panel_history', { defaultValue: 'История попыток' })}
              </p>
              <ul className="mt-1.5 divide-y divide-neutral-100">
                {history.map((row) => (
                  <li key={row.submission_uuid} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                    <span className="truncate text-black/60">
                      {row.created_at?.replace('T', ' ').slice(0, 16)} · {getLanguageById(row.language_our_id)?.name || row.language_our_id}
                    </span>
                    <span
                      className={`shrink-0 font-bold ${
                        row.verdict === 'ACCEPTED' ? 'text-emerald-700' : 'text-black/45'
                      }`}
                    >
                      {row.verdict_label || row.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
