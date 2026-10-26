'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Problem, addTaskFromProblem, listProblems } from '@services/problems/problems'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpenCheck, Loader2, Search } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

function errorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const detail = (value as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : undefined
}

function isProblemList(value: unknown): value is { problems: Problem[]; total: number } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { problems?: unknown; total?: unknown }
  return Array.isArray(candidate.problems) && typeof candidate.total === 'number'
}

export default function AddProblemTaskModal({
  assignment_uuid,
  closeModal,
}: {
  assignment_uuid: string
  closeModal: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as { id?: number }
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['problems', org?.id, debounced, 'assignment-picker'],
    queryFn: async () => {
      const res = await listProblems(org?.id ?? 0, access_token ?? '', {
        search: debounced || undefined,
        limit: 50,
      })
      if (!res.success || !isProblemList(res.data)) return null
      return res.data
    },
    enabled: !!org?.id && !!access_token,
    staleTime: 30_000,
  })

  async function addProblem(problem: Problem) {
    if (!access_token) return
    setAdding(problem.problem_uuid)
    try {
      const res = await addTaskFromProblem(assignment_uuid, problem.problem_uuid, access_token)
      if (!res.success) {
        toast.error(
          errorDetail(res.data) ||
            t('problems.errors.add_to_assignment', {
              defaultValue: 'Could not add the problem to this assignment',
            })
        )
        return
      }
      toast.success(t('problems.added_to_assignment', { defaultValue: 'Task added' }))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['assignment', assignment_uuid, 'tasks'],
        }),
        queryClient.invalidateQueries({ queryKey: ['assignment', assignment_uuid] }),
      ])
      closeModal(false)
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('problems.search', { defaultValue: 'Search by title or source id' })}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 ps-9 pe-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
        />
      </div>

      <div className="max-h-[55vh] space-y-2 overflow-y-auto pe-1">
        {isLoading && <div className="py-8 text-center text-sm text-gray-400">Loading…</div>}
        {!isLoading && (data?.problems.length ?? 0) === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
            {t('problems.empty', {
              defaultValue: 'No problems yet. Import a pack or create one manually.',
            })}
          </div>
        )}
        {data?.problems.map((problem) => {
          const visible = problem.tests.filter((test) => !test.hidden).length
          return (
            <button
              key={problem.problem_uuid}
              type="button"
              onClick={() => addProblem(problem)}
              disabled={adding !== null}
              className="flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 text-start hover:border-gray-200 hover:bg-gray-50/60 disabled:opacity-60"
            >
              <span className="mt-0.5 rounded-lg bg-emerald-50 p-2 text-emerald-600">
                <BookOpenCheck size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-800">
                  {problem.title}
                </span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {visible} public
                  {problem.tests.length - visible > 0
                    ? ` · ${problem.tests.length - visible} hidden`
                    : ''}
                  {problem.source_name ? ` · ${problem.source_name}` : ''}
                </span>
              </span>
              {adding === problem.problem_uuid && (
                <Loader2 size={16} className="mt-1 animate-spin text-gray-400" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
