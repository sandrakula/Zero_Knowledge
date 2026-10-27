'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any

  const username = session?.data?.user?.username || ''

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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentCourses />
            <RecentMembers />
          </div>
        </div>
      </div>
    </div>
  )
}
