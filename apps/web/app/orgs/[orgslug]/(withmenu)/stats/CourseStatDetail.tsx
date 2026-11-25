'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import {
  getCourseStats,
  getCourseStudents,
  type CourseStatDetail,
  type CourseStudentRow,
  type StatsPeriod,
} from '@services/stats/stats'
import { formatDate } from '@/lib/format'

type Props = {
  orgId: number
  token: string
  courseUuid: string
  courseName: string
  period: StatsPeriod
  isStaff: boolean
  onClose: () => void
}

export default function CourseStatDetailPanel({
  orgId,
  token,
  courseUuid,
  courseName,
  period,
  isStaff,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation()
  const [detail, setDetail] = useState<CourseStatDetail | null>(null)
  const [students, setStudents] = useState<CourseStudentRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [studentsBlocked, setStudentsBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCourseStats(orgId, courseUuid, token, undefined, period)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId, courseUuid, token, period])

  useEffect(() => {
    if (!isStaff) return
    let cancelled = false
    getCourseStudents(orgId, courseUuid, token)
      .then((rows) => {
        if (!cancelled) setStudents(rows)
      })
      .catch(() => {
        if (!cancelled) {
          setStudents([])
          setStudentsBlocked(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isStaff, orgId, courseUuid, token])

  const periodLabel =
    period === 'week'
      ? t('stats.period_week', { defaultValue: 'Week' })
      : period === 'month'
        ? t('stats.period_month', { defaultValue: 'Month' })
        : t('stats.period_all', { defaultValue: 'All time' })

  const statusLabel = (status: string) =>
    status === 'locked'
      ? t('stats.status_locked', { defaultValue: 'Locked' })
      : status === 'available'
        ? t('stats.status_available', { defaultValue: 'Available' })
        : status === 'completed'
          ? t('stats.status_completed', { defaultValue: 'Completed' })
          : t('stats.status_in_progress', { defaultValue: 'In progress' })

  const statusClass = (status: string) =>
    status === 'locked'
      ? 'border-neutral-200 bg-neutral-100 text-neutral-500'
      : status === 'available'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : status === 'completed'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-sky-200 bg-sky-50 text-sky-700'

  const formulaLabel = (key: string): string => {
    switch (key) {
      case 'completion':
        return t('stats.formula_completion', { defaultValue: 'Completion' })
      case 'grades':
        return t('stats.formula_grades', { defaultValue: 'Grades' })
      case 'regularity':
        return t('stats.kpi_regularity', { defaultValue: 'Regularity' })
      case 'practice':
        return t('stats.formula_practice', { defaultValue: 'Practice' })
      case 'solved':
        return t('stats.formula_solved', { defaultValue: 'Solved problems' })
      case 'score':
        return t('stats.formula_score', { defaultValue: 'Score' })
      case 'efficiency':
        return t('stats.formula_efficiency', { defaultValue: 'Acceptance efficiency' })
      default:
        return key
    }
  }

  const components = detail?.components
  const isInformatics = detail?.is_informatics ?? (components?.informatics_attempts ?? 0) > 0
  const activeWeeksPct =
    components && components.total_weeks > 0
      ? Math.min(100, Math.round((components.active_weeks / components.total_weeks) * 100))
      : 0

  const metrics = components
    ? isInformatics
      ? [
          {
            label: t('stats.detail_solved', { defaultValue: 'Solved problems' }),
            value: `${components.informatics_solved}`,
            hint: t('stats.detail_of', {
              defaultValue: 'of {{total}}',
              total: components.tasks_total,
            }),
          },
          {
            label: t('stats.detail_attempts', { defaultValue: 'Attempts' }),
            value: `${components.informatics_attempts}`,
          },
          {
            label: t('stats.detail_accepted', { defaultValue: 'Accepted' }),
            value: `${components.informatics_accepted}`,
          },
          {
            label: t('stats.detail_avg_score', { defaultValue: 'Average score' }),
            value:
              components.informatics_avg_score === null
                ? '—'
                : `${Math.round(components.informatics_avg_score)}`,
          },
          {
            label: t('stats.detail_active_weeks', { defaultValue: 'Active weeks' }),
            value: `${components.active_weeks}/${Number(components.total_weeks.toFixed(1))}`,
            hint: `${activeWeeksPct}%`,
          },
          {
            label: t('stats.active_days', { defaultValue: 'Active days' }),
            value: `${components.active_days}`,
          },
        ]
      : [
          {
            label: t('stats.detail_activities', { defaultValue: 'Activities' }),
            value: `${components.activities_completed}`,
            hint: t('stats.detail_of', {
              defaultValue: 'of {{total}}',
              total: components.activities_total,
            }),
          },
          {
            label: t('stats.detail_assignments', { defaultValue: 'Assignments graded' }),
            value: `${components.assignments_graded}`,
            hint: t('stats.detail_of', {
              defaultValue: 'of {{total}}',
              total: components.assignments_total,
            }),
          },
          {
            label: t('stats.detail_tasks', { defaultValue: 'Tasks solved' }),
            value: `${components.tasks_solved}`,
            hint: t('stats.detail_of', {
              defaultValue: 'of {{total}}',
              total: components.tasks_total,
            }),
          },
          {
            label: t('stats.detail_grade', { defaultValue: 'Average grade' }),
            value: `${Math.round(components.grade_percent)}%`,
          },
          {
            label: t('stats.kpi_defenses', { defaultValue: 'Defenses' }),
            value: `${components.defense_count}`,
          },
          {
            label: t('stats.detail_active_weeks', { defaultValue: 'Active weeks' }),
            value: `${components.active_weeks}/${Number(components.total_weeks.toFixed(1))}`,
            hint: `${activeWeeksPct}%`,
          },
          {
            label: t('stats.active_days', { defaultValue: 'Active days' }),
            value: `${components.active_days}`,
          },
        ]
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={courseName}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-neutral-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-black/35">
              {t('stats.course_detail', { defaultValue: 'Course statistics' })}
              {' · '}
              {periodLabel}
            </p>
            <h2 className="truncate text-xl font-black tracking-tight text-black">
              {detail?.name || courseName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="rounded-lg p-2 text-black/40 transition-colors hover:bg-neutral-100 hover:text-black"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-black/40">
              {t('common.loading', { defaultValue: 'Loading' })}
            </p>
          ) : !detail || !components ? (
            <p className="py-10 text-center text-sm text-black/40">
              {t('stats.detail_unavailable', {
                defaultValue: 'Statistics for this course are not available yet.',
              })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-black/35">
                    {t('stats.course_kpi', { defaultValue: 'Course KPI' })}
                  </p>
                  <p className="mt-1 text-5xl font-black tracking-tight text-black tabular-nums">
                    {Math.round(detail.course_kpi)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(
                    detail.status,
                  )}`}
                >
                  {statusLabel(detail.status)}
                </span>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-black/55">
                    {t('stats.course_percent', { defaultValue: 'Completion' })}
                  </span>
                  <span className="text-black/40">{Math.round(detail.course_percent)}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-[#c6ff4a]"
                    style={{
                      width: `${Math.min(100, Math.max(0, detail.course_percent))}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-black/35">
                  {t('stats.course_weight', { defaultValue: 'Weight' })}: {detail.weight}
                  {detail.last_activity_at
                    ? ` · ${t('stats.detail_last_activity', {
                        defaultValue: 'Last activity',
                      })}: ${formatDate(detail.last_activity_at, i18n.language, {
                        dateStyle: 'medium',
                      })}`
                    : ''}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {metrics.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-neutral-100 bg-neutral-50 p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">
                      {item.label}
                    </p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-black">
                      {item.value}
                    </p>
                    {item.hint && (
                      <p className="mt-0.5 text-[10px] text-black/35">{item.hint}</p>
                    )}
                  </div>
                ))}
              </div>

              {detail.formula && Object.keys(detail.formula).length > 0 && (
                <div className="mt-5 rounded-xl border border-neutral-100 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-black">
                      {t('stats.detail_composition', {
                        defaultValue: 'How the KPI is built',
                      })}
                    </h3>
                    <span className="text-[10px] uppercase tracking-wide text-black/35">
                      {Math.round(
                        Object.values(detail.formula).reduce(
                          (sum, value) => sum + Number(value || 0),
                          0,
                        ) * 100,
                      )}
                      %
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {Object.entries(detail.formula).map(([key, weight]) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 text-xs font-semibold text-black/60">
                          {formulaLabel(key)}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className="h-full rounded-full bg-[#c6ff4a]"
                            style={{
                              width: `${Math.min(100, Math.max(0, Number(weight || 0) * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-end text-xs tabular-nums text-black/45">
                          {Math.round(Number(weight || 0) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isStaff && (
                <div className="mt-6">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-black">
                      {t('stats.teacher_table', { defaultValue: 'Students' })}
                    </h3>
                    {students && students.length > 0 && (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-bold text-black/55">
                        {students.length}
                      </span>
                    )}
                  </div>
                  {studentsBlocked ? (
                    <p className="mt-3 text-xs text-black/40">
                      {t('stats.teacher_table_denied', {
                        defaultValue: 'Only the course instructor can see the student table.',
                      })}
                    </p>
                  ) : students === null ? (
                    <p className="mt-3 text-xs text-black/40">
                      {t('common.loading', { defaultValue: 'Loading' })}
                    </p>
                  ) : students.length === 0 ? (
                    <p className="mt-3 text-xs text-black/40">
                      {t('stats.teacher_table_empty', {
                        defaultValue: 'No students have started this course yet.',
                      })}
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-100 bg-neutral-50 text-start text-[10px] uppercase tracking-wide text-black/35">
                            <th className="px-3 py-2 font-semibold">
                              {t('stats.student', { defaultValue: 'Student' })}
                            </th>
                            <th className="px-3 py-2 font-semibold">
                              {t('stats.course_kpi', { defaultValue: 'KPI' })}
                            </th>
                            <th className="px-3 py-2 font-semibold">
                              {t('stats.course_percent', { defaultValue: '%' })}
                            </th>
                            <th className="px-3 py-2 font-semibold">
                              {t('stats.status', { defaultValue: 'Status' })}
                            </th>
                            <th className="px-3 py-2 font-semibold">
                              {t('stats.active_days', { defaultValue: 'Days' })}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {students.map((row) => (
                            <tr key={row.user_id}>
                              <td className="px-3 py-2.5">
                                <span className="font-semibold text-black/80">
                                  {row.name || row.username}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-black tabular-nums text-black">
                                {Math.round(row.course_kpi)}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-black/55">
                                {Math.round(row.course_percent)}%
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(
                                    row.status,
                                  )}`}
                                >
                                  {statusLabel(row.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-black/55">
                                {row.active_days}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
