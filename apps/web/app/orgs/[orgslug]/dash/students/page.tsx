'use client'

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2, Users } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  type CourseProgressSummary,
  getCourseProgressSummary,
  getOrgCourses,
} from '@services/courses/courses'

type CourseInfo = { course_uuid: string; name: string }
type GlobalStudent = {
  user_id: number
  name: string
  email: string
  courses: Array<{ uuid: string; name: string; percent: number }>
}

type StudentsOverview = {
  courses: CourseInfo[]
  students: GlobalStudent[]
}

function isCourseList(value: unknown): value is CourseInfo[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        'course_uuid' in item &&
        'name' in item
    )
  )
}

function isSummary(value: unknown): value is CourseProgressSummary {
  return (
    !!value &&
    typeof value === 'object' &&
    'students' in value &&
    Array.isArray(value.students)
  )
}

function dashboardCourseId(uuid: string): string {
  return uuid.replace(/^course_/, '')
}

export default function StudentsOverviewPage() {
  const org = useOrg() as { slug?: string; id?: number }
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const access_token = session?.data?.tokens?.access_token

  const { data, isLoading, isError } = useQuery<StudentsOverview>({
    queryKey: ['global-students', org?.slug],
    queryFn: async () => {
      if (!org?.slug || !access_token) return { courses: [], students: [] }
      const coursesRes = await getOrgCourses(org.slug, null, access_token, true)
      if (!isCourseList(coursesRes)) {
        return { courses: [], students: [] }
      }
      const courses: CourseInfo[] = coursesRes
      const summaries = await Promise.all(
        courses.map(async (course) => {
          const res = await getCourseProgressSummary(course.course_uuid, access_token, 1, 200)
          return {
            course,
            summary: res.success && isSummary(res.data) ? res.data : null,
          }
        })
      )

      const students = new Map<number, GlobalStudent>()
      for (const { course, summary } of summaries) {
        for (const student of summary?.students || []) {
          const existing: GlobalStudent = students.get(student.user_id) || {
            user_id: student.user_id,
            name:
              `${student.first_name || ''} ${student.last_name || ''}`.trim() ||
              student.username,
            email: student.email,
            courses: [],
          }
          existing.courses.push({
            uuid: dashboardCourseId(course.course_uuid),
            name: course.name,
            percent: student.percent,
          })
          students.set(student.user_id, existing)
        }
      }

      return {
        courses,
        students: Array.from(students.values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      }
    },
    enabled: !!org?.slug && !!access_token,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-gray-400">
        <Loader2 size={18} className="animate-spin me-2" />
        Loading students…
      </div>
    )
  }

  if (isError || !data) {
    return <div className="p-10 text-center text-sm text-gray-500">Could not load students.</div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Students</h1>
        <p className="text-sm text-gray-500">
          Everyone enrolled in a course, with a direct link to their per-course gradebook and Struggle Map.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.courses.map((course) => (
          <Link
            key={course.course_uuid}
            href={`/dash/courses/course/${dashboardCourseId(course.course_uuid)}/progress`}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 nice-shadow hover:border-gray-200 hover:bg-gray-50/50"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">{course.name}</div>
              <div className="text-xs text-gray-400">Open gradebook + Struggle Map</div>
            </div>
            <ChevronRight size={16} className="flex-none text-gray-400" />
          </Link>
        ))}
        {data.courses.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400">
            No courses yet.
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white nice-shadow">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/70 text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">Student</th>
              <th className="px-4 py-3 text-start font-semibold">Courses</th>
              <th className="px-4 py-3 text-end font-semibold">Avg progress</th>
            </tr>
          </thead>
          <tbody>
            {data.students.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-gray-400">
                  No enrolled students yet.
                </td>
              </tr>
            )}
            {data.students.map((student) => {
              const avg = student.courses.length
                ? Math.round(
                    student.courses.reduce((sum, course) => sum + course.percent, 0) /
                      student.courses.length
                  )
                : 0
              return (
                <tr key={student.user_id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <Users size={13} />
                      </span>
                      <div>
                        <div className="font-semibold text-gray-900">{student.name}</div>
                        <div className="text-xs text-gray-400">{student.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {student.courses.map((course) => (
                        <Link
                          key={course.uuid}
                          href={`/dash/courses/course/${course.uuid}/progress`}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                          title={`${course.name}: ${course.percent}%`}
                        >
                          {course.name}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(0, Math.min(100, avg))}%` }}
                        />
                      </div>
                      <span className="w-10 text-end text-xs font-semibold tabular-nums text-gray-600">
                        {avg}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
