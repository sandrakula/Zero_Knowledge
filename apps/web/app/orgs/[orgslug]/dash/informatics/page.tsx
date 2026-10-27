'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

type Category = { code: string; name: string; total: number; deadline?: string | null }
type Student = {
  user_id: number
  name: string
  username: string
  solved: number
  attendance: number
  by_category: Record<string, number>
}
type Overdue = {
  user_id: number
  name: string
  category: string
  category_name: string
  deadline: string
  solved: number
  total: number
}
type Statistics = { categories: Category[]; students: Student[]; overdue: Overdue[] }

const th = 'px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap'
const td = 'px-3 py-2 text-sm text-gray-700 whitespace-nowrap'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl nice-shadow overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      </header>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white rounded-xl nice-shadow px-4 py-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

export default function InformaticsStatsPage() {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const token = session?.data?.tokens?.access_token

  const { data, isLoading, error } = useQuery<Statistics>({
    queryKey: ['informatics', 'statistics'],
    queryFn: async () => {
      const res = await fetch(`${getAPIUrl()}informatics/statistics`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch statistics')
      return res.json()
    },
    enabled: !!token,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    )
  }

  if (error || !data) {
    return <div className="p-6 text-sm text-red-600">Не удалось загрузить статистику</div>
  }

  const { categories, students, overdue } = data
  const totalTasks = categories.reduce((s, c) => s + c.total, 0)
  const deadlinesSet = categories.filter((c) => c.deadline).length
  const today = new Date().toISOString().slice(0, 10)
  const expiredCategories = categories.filter(
    (c) => c.deadline && (c.deadline as string).slice(0, 10) < today,
  ).length
  const byAttendance = [...students].sort((a, b) => b.attendance - a.attendance)

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-1">Прогресс по задачам Informatics</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat value={categories.length} label="Всего категорий" />
        <Stat value={totalTasks} label="Всего задач" />
        <Stat value={deadlinesSet} label="Дедлайнов задано" />
        <Stat value={expiredCategories} label="Просрочено" />
      </div>

      <Card title="Лидерборд — всего решено">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={th}>#</th>
              <th className={th}>Ученик</th>
              <th className={th}>Решено</th>
              <th className={th}>Посещений</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => (
              <tr key={s.user_id} className="border-b border-gray-50 last:border-0">
                <td className={td}>{i + 1}</td>
                <td className={td}>{s.name || s.username}</td>
                <td className={td}>{s.solved}</td>
                <td className={td}>{s.attendance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="По категориям">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={th}>Ученик</th>
              {categories.map((c) => (
                <th key={c.code} className={th}>{c.name}</th>
              ))}
              <th className={th}>Всего</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.user_id} className="border-b border-gray-50 last:border-0">
                <td className={td}>{s.name || s.username}</td>
                {categories.map((c) => (
                  <td key={c.code} className={td}>{s.by_category[c.code] ?? 0}/{c.total}</td>
                ))}
                <td className={td}>{s.solved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Дедлайны">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={th}>Категория</th>
              <th className={th}>Задач</th>
              <th className={th}>Дедлайн</th>
            </tr>
          </thead>
          <tbody>
            {categories.filter((c) => c.deadline).map((c) => (
              <tr key={c.code} className="border-b border-gray-50 last:border-0">
                <td className={td}>{c.name}</td>
                <td className={td}>{c.total}</td>
                <td className={td}>{c.deadline}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Просроченные">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={th}>Ученик</th>
              <th className={th}>Категория</th>
              <th className={th}>Дедлайн</th>
              <th className={th}>Решено</th>
            </tr>
          </thead>
          <tbody>
            {overdue.map((o) => (
              <tr key={`${o.user_id}-${o.category}`} className="border-b border-gray-50 last:border-0">
                <td className={td}>{o.name}</td>
                <td className={td}>{o.category_name}</td>
                <td className={td}>{o.deadline}</td>
                <td className={td}>{o.solved}/{o.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Посещаемость">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={th}>#</th>
              <th className={th}>Ученик</th>
              <th className={th}>Посещений</th>
            </tr>
          </thead>
          <tbody>
            {byAttendance.map((s, i) => (
              <tr key={s.user_id} className="border-b border-gray-50 last:border-0">
                <td className={td}>{i + 1}</td>
                <td className={td}>{s.name || s.username}</td>
                <td className={td}>{s.attendance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
