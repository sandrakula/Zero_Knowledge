'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

type CatProgress = {
  code: string
  name: string
  total: number
  solved: number
  percent: number
}

type MyDashboard = {
  me: {
    total_solved: number
    solved_week: number
    solved_month: number
    avg_per_day: number
    rank: number
    total_students: number
    attendance_total: number
    attendance_week: number
  }
  top5: { name: string; weekly: number; avg_day: number }[]
  per_category: CatProgress[]
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

export default function StudentDashboard() {
  const { t } = useTranslation()
  const session = useLHSession() as { data?: { tokens?: { access_token?: string }; user?: any } }
  const token = session?.data?.tokens?.access_token
  const name = session?.data?.user?.first_name || session?.data?.user?.username || ''

  const { data } = useQuery<MyDashboard>({
    queryKey: ['informatics', 'my-dashboard'],
    queryFn: async () => {
      const r = await fetch(`${getAPIUrl()}informatics/my-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return r.json()
    },
    enabled: !!token,
    staleTime: 15_000,
  })

  const me = data?.me

  const stats = [
    { label: t('dashboard.home.total_solved', 'Всего решено'), value: me?.total_solved ?? 0 },
    { label: t('dashboard.home.solved_week', 'За неделю'), value: me?.solved_week ?? 0 },
    { label: t('dashboard.home.solved_month', 'За месяц'), value: me?.solved_month ?? 0 },
    { label: t('dashboard.home.avg_per_day', 'Сред. в день'), value: me?.avg_per_day ?? 0 },
    { label: t('dashboard.home.rank', 'Место'), value: me?.rank ? `#${me.rank}` : '—' },
    { label: t('dashboard.home.visits', 'Визитов'), value: me?.attendance_total ?? 0 },
  ]

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="px-4 sm:px-10 pt-8 pb-10">
        <div className="space-y-6 max-w-[1600px] mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t('dashboard.home.welcome_back')}{name ? `, ${name}` : ''} 👋
            </h1>
            <p className="text-sm text-gray-400 mt-1">Твой прогресс на задачах Informatics</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="bg-white rounded-xl nice-shadow p-4 flex flex-col">
                <span className="text-2xl font-bold text-gray-900">{s.value}</span>
                <span className="text-xs text-gray-400 mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top-5 */}
            <div className="bg-white rounded-xl nice-shadow p-5">
              <h2 className="font-semibold text-gray-900 mb-4">
                🏆 {t('dashboard.home.top5', 'Топ-5 Ордена')}
              </h2>
              <div className="space-y-3">
                {data?.top5?.map((row, i) => (
                  <div key={row.name} className="flex items-center gap-3">
                    <span className="text-lg">{MEDALS[i] || `${i + 1}.`}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-800 truncate">{row.name}</span>
                        <span className="text-gray-400 text-xs ml-2">{row.avg_day}/день</span>
                      </div>
                      <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${Math.min(100, (row.weekly / (data?.top5?.[0]?.weekly || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-category progress */}
            <div className="bg-white rounded-xl nice-shadow p-5 lg:col-span-2">
              <h2 className="font-semibold text-gray-900 mb-4">
                📊 {t('dashboard.home.by_category', 'Прогресс по категориям')}
              </h2>
              <div className="space-y-2.5">
                {data?.per_category?.map((cat) => (
                  <div key={cat.code} className="flex items-center gap-3">
                    <span className="w-40 text-sm text-gray-700 truncate">{cat.name}</span>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${cat.percent >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, cat.percent)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right">
                      {cat.solved}/{cat.total} · {cat.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
