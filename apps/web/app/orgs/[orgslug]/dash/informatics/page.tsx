'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import React, { useEffect, useState } from 'react'

const LANGUAGES = [
  { id: 71, name: 'Python 3' },
  { id: 54, name: 'C++' },
  { id: 50, name: 'C' },
  { id: 62, name: 'Java' },
]

const SAMPLE_CODE: Record<number, string> = {
  71: 'import math\na = float(input())\nb = float(input())\nprint(math.hypot(a, b))\n',
  54: '#include <iostream>\n#include <cmath>\nint main(){double a,b;std::cin>>a>>b;std::cout<<std::hypot(a,b);return 0;}\n',
  50: '#include <stdio.h>\n#include <math.h>\nint main(){double a,b;scanf("%lf %lf",&a,&b);printf("%f",hypot(a,b));return 0;}\n',
  62: 'import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);double x=s.nextDouble(),y=s.nextDouble();System.out.println(Math.hypot(x,y));}}\n',
}

export default function InformaticsTestPage() {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const token = session?.data?.tokens?.access_token

  const [link, setLink] = useState<any>(null)
  const [cookie, setCookie] = useState('')
  const [problemId, setProblemId] = useState('2936')
  const [langId, setLangId] = useState<number>(71)
  const [code, setCode] = useState(SAMPLE_CODE[71])
  const [result, setResult] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<any>(null)

  const auth = { Authorization: `Bearer ${token}` }

  async function refreshLink() {
    const r = await fetch(`${getAPIUrl()}informatics/link`, { headers: auth })
    setLink(await r.json())
  }
  async function refreshStats() {
    const r = await fetch(`${getAPIUrl()}informatics/statistics`, { headers: auth })
    if (r.ok) setStats(await r.json())
  }
  useEffect(() => {
    if (token) { refreshLink(); refreshStats() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function doLink() {
    setBusy(true); setError('')
    try {
      const r = await fetch(`${getAPIUrl()}informatics/link`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_cookie: cookie.trim() }),
      })
      const d = await r.json()
      if (r.ok) { setLink(d); setCookie('') } else setError(d.detail || 'link failed')
    } finally { setBusy(false) }
  }

  async function doUnlink() {
    setBusy(true); setError('')
    try {
      await fetch(`${getAPIUrl()}informatics/link`, { method: 'DELETE', headers: auth })
      setLink({ linked: false })
    } finally { setBusy(false) }
  }

  async function doSubmit() {
    setBusy(true); setError(''); setResult(null)
    try {
      const r = await fetch(`${getAPIUrl()}informatics/submit`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: Number(problemId), language_id: langId, source_code: code }),
      })
      const d = await r.json()
      if (r.ok) { setResult(d); refreshStats() } else setError(d.detail || 'submit failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Информатикс — тест</h1>

      {/* Binding */}
      <section className="p-4 rounded-xl bg-white nice-shadow space-y-3">
        <h2 className="font-semibold">Привязка аккаунта</h2>
        {link?.linked ? (
          <div className="space-y-2">
            <p className="text-sm">
              Привязан: <b>{link.informatics_username || '—'}</b> (id {link.informatics_user_id})
            </p>
            {link.last_error && <p className="text-xs text-amber-600">last_error: {link.last_error}</p>}
            <button onClick={doUnlink} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg" disabled={busy}>Отвязать</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={cookie} onChange={(e) => setCookie(e.target.value)}
              placeholder="MoodleSession кука" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
            />
            <button onClick={doLink} className="px-3 py-1.5 text-sm bg-black text-white rounded-lg" disabled={busy || !cookie.trim()}>Привязать</button>
          </div>
        )}
      </section>

      {/* Submit */}
      <section className="p-4 rounded-xl bg-white nice-shadow space-y-3">
        <h2 className="font-semibold">Отправка на проверку</h2>
        <div className="flex gap-3">
          <label className="text-xs font-semibold text-gray-500">
            Задача (informatics id)
            <input value={problemId} onChange={(e) => setProblemId(e.target.value)} className="mt-1 w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            Язык
            <select value={langId} onChange={(e) => { const id = Number(e.target.value); setLangId(id); setCode(SAMPLE_CODE[id] || '') }} className="mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg">
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
        <textarea
          value={code} onChange={(e) => setCode(e.target.value)}
          rows={10} spellCheck={false}
          className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg bg-gray-50"
        />
        <button onClick={doSubmit} className="px-4 py-2 text-sm bg-black text-white rounded-lg" disabled={busy || !link?.linked}>
          {busy ? 'Проверяем…' : 'Отправить на Информатикс'}
        </button>
        {!link?.linked && <p className="text-xs text-gray-500">Сначала привяжи аккаунт.</p>}
      </section>

      {/* Result */}
      {error && <p className="text-sm text-red-600">Ошибка: {error}</p>}
      {result && (
        <section className="p-4 rounded-xl bg-white nice-shadow space-y-2">
          <h2 className="font-semibold">Вердикт Информатикса</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Статус: <b>{result.status}</b></div>
            <div>Пройдено тестов: <b>{result.tests}</b></div>
            <div>Баллы: <b>{result.score}</b></div>
            <div>Решено: <b className={result.solved ? 'text-green-600' : 'text-red-600'}>{result.solved ? '✅ да' : '❌ нет'}</b></div>
          </div>
          <pre className="text-xs bg-gray-50 p-2 rounded-lg overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}

      {/* Statistics */}
      {stats && (
        <section className="p-4 rounded-xl bg-white nice-shadow space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Статистика</h2>
            <button onClick={refreshStats} className="text-xs text-gray-500 hover:text-black">Обновить</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="px-2 py-1.5 text-left font-semibold sticky left-0 bg-gray-50">Студент</th>
                  {stats.categories.map((c: any) => (
                    <th key={c.code} className="px-2 py-1.5 text-center font-semibold" title={`${c.name} (${c.total} задач${c.deadline ? ', дедлайн ' + c.deadline : ''})`}>
                      {c.code.replace('CAT_0','').replace('INF_','')}{c.deadline ? '⏰' : ''}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-center font-semibold">Σ</th>
                  <th className="px-2 py-1.5 text-center font-semibold">👣</th>
                </tr>
              </thead>
              <tbody>
                {stats.students.map((s: any) => (
                  <tr key={s.user_id} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-left whitespace-nowrap sticky left-0 bg-white">{s.name}</td>
                    {stats.categories.map((c: any) => {
                      const v = s.by_category[c.code]
                      const val = s.validation?.[c.code]
                      return (
                        <td key={c.code} className="px-2 py-1.5 text-center">
                          {v ? <span className={val?.dosdacha ? 'text-amber-600 font-medium' : 'text-green-700 font-medium'}>{v}{val?.validation_status === 'OK' ? '✓' : ''}</span> : <span className="text-gray-300">·</span>}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1.5 text-center font-bold">{s.solved}</td>
                    <td className="px-2 py-1.5 text-center text-gray-500">{s.attendance || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">⏰ = категория с дедлайном · «✓» = проверено преподавателем · 👣 = посещения · точка = ещё не решено.</p>

          {/* Overdue */}
          {stats.overdue?.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Просрочено</h3>
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <tbody>
                    {stats.overdue.slice(0, 60).map((o: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-2 py-1 text-left">{o.name}</td>
                        <td className="px-2 py-1 text-left text-gray-600">{o.category_name}</td>
                        <td className="px-2 py-1 text-center text-amber-600">{o.solved}/{o.total}</td>
                        <td className="px-2 py-1 text-right text-gray-400">до {o.deadline}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
