'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { Link2, Unlink, Loader2, AlertTriangle } from 'lucide-react'

type LinkStatus = {
  linked: boolean
  informatics_user_id?: number | null
  informatics_username?: string | null
  last_error?: string | null
}

export default function AccountInformatics() {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const token = session?.data?.tokens?.access_token

  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [cookie, setCookie] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${getAPIUrl()}informatics/link`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setStatus(await res.json())
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function doLink() {
    if (!cookie.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}informatics/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_cookie: cookie.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        setStatus(data)
        setCookie('')
      } else {
        setError(data?.detail || 'Не удалось привязать аккаунт Informatics')
      }
    } catch {
      setError('Не удалось привязать аккаунт Informatics')
    } finally {
      setBusy(false)
    }
  }

  async function doUnlink() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fetch(`${getAPIUrl()}informatics/link`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setStatus({ linked: false })
    } catch {
      setError('Не удалось отвязать аккаунт Informatics')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white nice-shadow rounded-lg p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Link2 size={18} className="text-gray-600" />
        <h2 className="text-base font-bold text-gray-900">Informatics</h2>
      </div>
      <p className="text-sm text-gray-500">
        Привяжите аккаунт informatics.msk.ru — он нужен, чтобы отправлять решения задач на проверку.
      </p>

      {status?.linked ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-sm text-emerald-700">
            Привязан: <span className="font-semibold">{status.informatics_username || status.informatics_user_id}</span>
          </div>
          <button
            type="button"
            onClick={doUnlink}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white border border-rose-200 rounded-md hover:bg-rose-50 disabled:opacity-50"
          >
            <Unlink size={13} />
            Отвязать
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-600">Session cookie из Informatics</label>
          <input
            type="text"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="Вставьте session cookie (из cookies informatics.msk.ru)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          <button
            type="button"
            onClick={doLink}
            disabled={busy || !cookie.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Привязать
          </button>
        </div>
      )}

      {status?.last_error && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle size={13} />
          {status.last_error}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}
    </div>
  )
}
