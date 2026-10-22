'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import {
  BookOpen,
  Users,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { apiFetch } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import { getOrgCourses } from '@services/courses/courses'

export default function ContentOverview() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug
  const orgId = org?.id

  // Courses
  const { data: coursesData, isLoading: coursesLoading } = useQuery({
    queryKey: [...queryKeys.courses.list(orgslug), 'overview'],
    queryFn: () => getOrgCourses(orgslug, null, token, true),
    enabled: !!token && !!orgslug,
    staleTime: 60_000,
  })

  // Members
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: [...queryKeys.org.users(orgId), 'overview'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=1`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const courses: any[] = coursesData ?? []
  const totalMembers = membersData?.total ?? 0

  const publishedCourses = courses.filter((c: any) => c.published).length
  const draftCourses = courses.length - publishedCourses

  const cards = [
    {
      label: t('dashboard.home.courses'),
      value: courses.length,
      sub: `${publishedCourses} ${t('dashboard.home.published')} · ${draftCourses} ${t('dashboard.home.draft')}`,
      icon: BookOpen,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
      href: '/dash/courses',
      show: true,
    },
    {
      label: t('dashboard.home.members'),
      value: totalMembers,
      sub: t('dashboard.home.total_users'),
      icon: Users,
      iconColor: 'text-indigo-500',
      iconBg: 'bg-indigo-50',
      href: '/dash/users/settings/users',
      show: true,
    },
  ]

  const visibleCards = cards.filter((c) => c.show)
  const isLoading = coursesLoading || membersLoading

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl nice-shadow px-5 py-4 animate-pulse"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 bg-gray-100 rounded-lg" />
              <div className="h-2.5 bg-gray-100 rounded w-16" />
            </div>
            <div className="h-7 bg-gray-100 rounded w-10 mb-1.5" />
            <div className="h-2 bg-gray-50 rounded w-24" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={`grid gap-4 ${
        visibleCards.length <= 4
          ? 'grid-cols-2 sm:grid-cols-4'
          : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      }`}
    >
      {visibleCards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          className="bg-white rounded-xl nice-shadow px-5 py-4 hover:bg-gray-50 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-lg ${card.iconBg}`}>
              <card.icon
                size={14}
                weight="duotone"
                className={card.iconColor}
              />
            </div>
            <span className="text-xs font-medium text-gray-400">
              {card.label}
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{card.value}</div>
          <p className="text-[11px] text-gray-300 mt-0.5">{card.sub}</p>
        </Link>
      ))}
    </div>
  )
}
