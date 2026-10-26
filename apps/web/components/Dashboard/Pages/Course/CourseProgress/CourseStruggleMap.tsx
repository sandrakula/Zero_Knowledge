'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  type StruggleMap,
  type StruggleTask,
  getCourseStruggleMap,
} from '@services/courses/courses'

function isStruggleMap(value: unknown): value is StruggleMap {
  return (
    !!value &&
    typeof value === 'object' &&
    'tasks' in value &&
    Array.isArray(value.tasks)
  )
}

function verdictColor(task: StruggleTask): string {
  if (task.students_stuck === 0) return 'text-emerald-600'
  if (task.students_stuck >= task.students_attempted) return 'text-rose-600'
  return 'text-amber-600'
}

export default function CourseStruggleMap({ courseUUID }: { courseUUID: string }) {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const access_token = session?.data?.tokens?.access_token
  const { data, isLoading, isError } = useQuery({
    queryKey: ['course-struggle', courseUUID],
    queryFn: async () => {
      const res = await getCourseStruggleMap(courseUUID, access_token)
      return res.success && isStruggleMap(res.data) ? res.data : null
    },
    enabled: !!access_token,
    staleTime: 15_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin me-2" />
        Building struggle map…
      </div>
    )
  }
  if (isError || !data) return null

  const tasks = data.tasks.filter((task) => task.attempts > 0)

  return (
    <div className="px-4 sm:px-6 pb-6 space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Struggle map</h2>
        <p className="text-xs text-gray-500">
          Where the class is stuck, aggregated from durable CODE attempts. Top failed test cases and
          learners whose latest attempt is not accepted.
        </p>
      </div>

      {tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
          No CODE attempts yet. The map appears after learners run/submit code tasks.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {tasks.map((task) => (
          <div key={task.assignment_task_uuid} className="rounded-xl border border-gray-100 bg-white p-4 nice-shadow">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-gray-900">{task.task_title}</div>
                <div className="truncate text-xs text-gray-400">{task.assignment_title}</div>
              </div>
              <div className={`flex items-center gap-1 text-xs font-semibold ${verdictColor(task)}`}>
                <AlertTriangle size={13} />
                {task.students_stuck} stuck
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-gray-50 p-2">
                <div className="text-base font-bold text-gray-800">{task.attempts}</div>
                <div className="text-gray-400">attempts</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <div className="text-base font-bold text-gray-800">{task.accepted_rate}%</div>
                <div className="text-gray-400">accepted</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <div className="text-base font-bold text-gray-800">{task.students_attempted}</div>
                <div className="text-gray-400">learners</div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold">
              {task.wrong_answer > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                  WA {task.wrong_answer}
                </span>
              )}
              {task.compilation_error > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                  CE {task.compilation_error}
                </span>
              )}
              {task.runtime_error > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                  RE {task.runtime_error}
                </span>
              )}
              {task.time_limit > 0 && (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">
                  TLE {task.time_limit}
                </span>
              )}
            </div>

            {task.top_failed_tests.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {task.top_failed_tests.map((test) => {
                  const max = Math.max(...task.top_failed_tests.map((item) => item.failures), 1)
                  return (
                    <div key={test.id}>
                      <div className="flex items-center justify-between text-[11px] text-gray-500">
                        <span className="truncate">{test.label || test.id}</span>
                        <span className="font-semibold tabular-nums">{test.failures} fails</span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-rose-400"
                          style={{ width: `${Math.max(6, (test.failures / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
