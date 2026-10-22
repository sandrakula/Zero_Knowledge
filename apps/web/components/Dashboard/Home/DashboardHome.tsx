'use client'
import React from 'react'
import Link from 'next/link'
import {
  PlusCircle,
  Users,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'
import ContentOverview from './ContentOverview'

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any

  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  const username = session?.data?.user?.username || ''

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="px-4 sm:px-10 pt-8 pb-10">
        <div className="space-y-6 max-w-[1600px] mx-auto w-full">
          {/* Welcome Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('dashboard.home.welcome_back')}{username ? `, ${username}` : ''}
              </h1>
              <div className="flex items-center gap-2 mt-1.5">
                {org?.name && (
                  <span className="text-xs text-gray-400">{org.name}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/dash/courses?new=true"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <PlusCircle size={14} weight="bold" />
                {t('dashboard.home.create_course')}
              </Link>
              <Link
                href="/dash/users/settings/users"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-600 bg-white rounded-lg nice-shadow hover:bg-gray-50 transition-colors"
              >
                <Users size={14} weight="bold" />
                {t('dashboard.home.members')}
              </Link>
            </div>
          </div>

          <AdminAuthorization authorizationMode="component">
            <div className="space-y-6">
              {/* Content counts row */}
              <ContentOverview />

              {/* Main grid: courses + members */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <RecentCourses />
                  <RecentMembers />
                </div>
              </div>
            </div>
          </AdminAuthorization>
        </div>
      </div>
    </div>
  )
}
