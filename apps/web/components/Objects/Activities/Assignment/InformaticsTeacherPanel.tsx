'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  listInformaticsTaskSubmissions,
  type InformaticsAttempt,
} from '@services/informatics/informatics'

interface InformaticsTeacherPanelProps {
  assignmentTaskUuid?: string
}

export default function InformaticsTeacherPanel({
  assignmentTaskUuid,
}: InformaticsTeacherPanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [rows, setRows] = useState<InformaticsAttempt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!accessToken || !assignmentTaskUuid) return
    setLoading(true)
    setError('')
    try {
      const data = await listInformaticsTaskSubmissions(assignmentTaskUuid, accessToken)
      setRows(data)
    } catch (err: any) {
      // 403 is normal for a teacher who cannot edit this course; keep it quiet.
      if (!String(err?.message || '').includes('403')) {
        setError(err?.message || 'Не удалось загрузить попытки')
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [accessToken, assignmentTaskUuid])

  useEffect(() => {
    void load()
  }, [load])

  if (!assignmentTaskUuid) return null

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-black">
          <Users size={15} className="text-black/45" />
          {t('informatics.teacher_panel_title', {
            defaultValue: 'Informatics: попытки студентов',
          })}
        </h4>
        <button
          type="button"
          onClick={() => {
            void load()
            toast.success(t('informatics.panel_refresh', { defaultValue: 'Обновить' }))
          }}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-black/60 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {t('informatics.panel_refresh', { defaultValue: 'Обновить' })}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      {!loading && rows.length === 0 && !error && (
        <p className="mt-2 text-xs text-black/45">
          {t('informatics.teacher_panel_empty', {
            defaultValue: 'Пока никто не отправлял решение через сервер.',
          })}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wide text-black/40">
                <th className="py-1.5 pe-2 font-semibold">#</th>
                <th className="py-1.5 pe-2 font-semibold">
                  {t('informatics.teacher_panel_status', { defaultValue: 'Статус' })}
                </th>
                <th className="py-1.5 pe-2 font-semibold">
                  {t('informatics.panel_tests', { defaultValue: 'Тесты' })}
                </th>
                <th className="py-1.5 pe-2 font-semibold">
                  {t('informatics.panel_score', { defaultValue: 'Баллы' })}
                </th>
                <th className="py-1.5 font-semibold">run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.submission_uuid} className="border-b border-neutral-100 text-black/65">
                  <td className="py-1.5 pe-2 font-mono">{row.user_id}</td>
                  <td className="py-1.5 pe-2">
                    <span
                      className={`font-semibold ${
                        row.verdict === 'ACCEPTED' ? 'text-emerald-700' : 'text-black/50'
                      }`}
                    >
                      {row.verdict_label || row.status}
                    </span>
                  </td>
                  <td className="py-1.5 pe-2 tabular-nums">
                    {row.tests_passed}/{row.tests_total || '—'}
                  </td>
                  <td className="py-1.5 pe-2 tabular-nums">
                    {row.score}/{row.max_score || '—'}
                  </td>
                  <td className="py-1.5 font-mono text-black/40">{row.run_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
