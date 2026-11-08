'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import InformaticsLinkPrompt from './InformaticsLinkPrompt'

type Course = {
  course_uuid?: string
  name?: string
  description?: string
  thumbnail_image?: string
}

export default function StudentDashboard() {
  const { t } = useTranslation()
  const session = useLHSession() as {
    data?: {
      tokens?: { access_token?: string }
      user?: { first_name?: string; username?: string }
    }
  }
  const org = useOrg() as { slug?: string }
  const token = session?.data?.tokens?.access_token
  const name = session?.data?.user?.first_name || session?.data?.user?.username || ''

  const { data: courses } = useQuery<Course[]>({
    queryKey: ['learner', 'courses', org?.slug],
    queryFn: async () => {
      const r = await fetch(
        `${getAPIUrl()}courses/org_slug/${org?.slug}/page/1/limit/50`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!r.ok) return []
      return r.json()
    },
    enabled: !!token && !!org?.slug,
    staleTime: 30_000,
  })

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="px-4 sm:px-10 pt-8 pb-10">
        <div className="space-y-6 max-w-[1200px] mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t('dashboard.home.welcome_back')}{name ? `, ${name}` : ''} 👋
            </h1>
            <p className="text-sm text-gray-400 mt-1">Выбери курс и приступай к задачам</p>
          </div>

          <InformaticsLinkPrompt />

          <div>
            <h2 className="text-sm font-semibold text-gray-500 mb-3">Курсы</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(courses || []).map((course) => {
                const uuid = (course.course_uuid || '').replace('course_', '')
                if (!uuid) return null
                return (
                  <a
                    key={uuid}
                    href={getUriWithOrg(org?.slug || '', `/course/${uuid}`)}
                    className="bg-white rounded-xl nice-shadow overflow-hidden flex flex-col hover:shadow-md transition-shadow"
                  >
                    <div className="p-5 flex flex-col gap-3 flex-1">
                      <div className="flex items-center gap-2 text-gray-700">
                        <BookOpen size={16} className="text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-sm leading-snug">{course.name}</span>
                      </div>
                      {course.description ? (
                        <p className="text-xs text-gray-400 line-clamp-2">{course.description}</p>
                      ) : null}
                    </div>
                  </a>
                )
              })}
              {(!courses || courses.length === 0) && (
                <p className="text-sm text-gray-400 col-span-full py-8 text-center">
                  {t('courses.no_courses')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
