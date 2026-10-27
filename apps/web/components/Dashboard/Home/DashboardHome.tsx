'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'

type Category = { code: string; name: string; total: number; deadline?: string | null }
type Student = {
  user_id: number
  name: string
  username: string
  solved: number
  attendance: number
  by_category: Record<string, number>
}
type Statistics = { categories: Category[]; students: Student[]; overdue: { category: string }[] }

const th = 'px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap'
const td = 'px-3 py-2 text-sm text-gray-700 whitespace-nowrap'

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white rounded-xl nice-shadow px-4 py-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any

  const token = session?.data?.tokens?.access_token
  const username = session?.data?.user?.username || ''

  const { data } = useQuery<Statistics>({
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

  const categories = data?.categories ?? []
  const students = data?.students ?? []
  const totalTasks = categories.reduce((s, c) => s + c.total, 0)
  const deadlinesSet = categories.filter((c) => c.deadline).length
  const today = new Date().toISOString().slice(0, 10)
  const expiredCategories = categories.filter(
    (c) => c.deadline && (c.deadline as string).slice(0, 10) < today,
  ).length

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="px-4 sm:px-10 pt-8 pb-10">
        <div className="space-y-6 max-w-[1600px] mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t('dashboard.home.welcome_back')}{username ? `, ${username}` : ''}
            </h1>
            {org?.name && <p className="text-sm text-gray-400 mt-1">{org.name}</p>}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat value={categories.length} label="Категорий" />
            <Stat value={totalTasks} label="Задач" />
            <Stat value={students.length} label="Учеников" />
            <Stat value={expiredCategories} label="Просрочено" />
          </div>

          <section className="bg-white rounded-xl nice-shadow overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-800">Прогресс учеников</h2>
            </header>
            <div className="overflow-x-auto">
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
                  {students.length === 0 && (
                    <tr>
                      <td className={td} colSpan={4}>
                        {data ? 'Нет данных' : (
                          <span className="inline-flex items-center gap-2 text-gray-400">
                            <Loader2 size={14} className="animate-spin" /> Загрузка…
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentCourses />
            <RecentMembers />
          </div>
        </div>
      </div>
    </div>
  )
}
