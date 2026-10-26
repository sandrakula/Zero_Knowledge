'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Problem,
  ProblemTest,
  createProblem,
  deleteProblem,
  importInformaticsProblem,
  importProblems,
  listProblems,
  updateProblem,
} from '@services/problems/problems'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArchiveRestore,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileArchive,
  FlaskConical,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type ProblemListResponse = {
  problems: Problem[]
  total: number
  page: number
  limit: number
}

type ImportResultItem = {
  external_id?: string | null
  title?: string | null
  status: 'created' | 'updated' | 'skipped' | 'conflict' | 'failed'
  problem_uuid?: string | null
  error?: string | null
}

type ImportReport = {
  dry_run: boolean
  created: number
  updated: number
  skipped: number
  conflicts: number
  failed: number
  results: ImportResultItem[]
}

type DraftTest = {
  id: string
  label: string
  stdin: string
  expected_stdout: string
  hidden: boolean
  weight: number
}

type Draft = {
  title: string
  statement_md: string
  input_format: string
  output_format: string
  constraints: string
  difficulty: string
  topics: string
  source_name: string
  source_url: string
  source_id: string
  time_limit_ms: string
  memory_limit_kb: string
  tests: DraftTest[]
}

const EMPTY_DRAFT: Draft = {
  title: '',
  statement_md: '',
  input_format: '',
  output_format: '',
  constraints: '',
  difficulty: '',
  topics: '',
  source_name: '',
  source_url: '',
  source_id: '',
  time_limit_ms: '',
  memory_limit_kb: '',
  tests: [
    { id: 't1', label: 'Пример 1', stdin: '', expected_stdout: '', hidden: false, weight: 1 },
  ],
}

function newTest(index: number): DraftTest {
  return {
    id: `t${Date.now()}_${index}`,
    label: `Test ${index + 1}`,
    stdin: '',
    expected_stdout: '',
    hidden: false,
    weight: 1,
  }
}

function errorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const detail = (value as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : undefined
}

function isImportReport(value: unknown): value is ImportReport {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { results?: unknown; created?: unknown }
  return Array.isArray(candidate.results) && typeof candidate.created === 'number'
}

function isProblemListResponse(value: unknown): value is ProblemListResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { problems?: unknown; total?: unknown }
  return Array.isArray(candidate.problems) && typeof candidate.total === 'number'
}

function asDraft(problem: Problem): Draft {
  return {
    title: problem.title,
    statement_md: problem.statement_md,
    input_format: problem.input_format || '',
    output_format: problem.output_format || '',
    constraints: problem.constraints || '',
    difficulty: problem.difficulty || '',
    topics: (problem.topics || []).join(', '),
    source_name: problem.source_name || '',
    source_url: problem.source_url || '',
    source_id: problem.source_id || '',
    time_limit_ms: problem.time_limit_ms ? String(problem.time_limit_ms) : '',
    memory_limit_kb: problem.memory_limit_kb ? String(problem.memory_limit_kb) : '',
    tests: (problem.tests || []).map((test) => ({
      id: test.id,
      label: test.label,
      stdin: test.stdin,
      expected_stdout: test.expected_stdout ?? '',
      hidden: test.hidden,
      weight: test.weight || 1,
    })),
  }
}

function draftToBody(draft: Draft, languages: number[]) {
  return {
    title: draft.title.trim(),
    statement_md: draft.statement_md,
    input_format: draft.input_format,
    output_format: draft.output_format,
    constraints: draft.constraints,
    difficulty: draft.difficulty || null,
    topics: draft.topics
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean),
    languages,
    tests: draft.tests.map((test) => ({
      id: test.id,
      label: test.label,
      stdin: test.stdin,
      expected_stdout: test.expected_stdout,
      hidden: test.hidden,
      weight: Number(test.weight) || 1,
    })),
    time_limit_ms: draft.time_limit_ms ? Number(draft.time_limit_ms) : null,
    memory_limit_kb: draft.memory_limit_kb ? Number(draft.memory_limit_kb) : null,
    source_name: draft.source_name || null,
    source_url: draft.source_url || null,
    source_id: draft.source_id || null,
  }
}

const INPUT =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/5'
const LABEL = 'text-xs font-semibold text-gray-500'

function ProblemLibraryPage() {
  const { t } = useTranslation()
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as { id?: number; slug?: string }
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Problem | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editorOpen, setEditorOpen] = useState(false)
  const [preview, setPreview] = useState<Problem | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [importing, setImporting] = useState(false)
  const [informaticsOpen, setInformaticsOpen] = useState(false)
  const [informaticsId, setInformaticsId] = useState('')
  const [informaticsReport, setInformaticsReport] = useState<ImportReport | null>(null)
  const [informaticsBusy, setInformaticsBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['problems', org?.id, debouncedSearch, difficulty, page, includeArchived],
    queryFn: async () => {
      const res = await listProblems(org?.id ?? 0, access_token ?? '', {
        search: debouncedSearch || undefined,
        difficulty: difficulty || undefined,
        page,
        limit: 20,
        include_archived: includeArchived,
      })
      if (!res.success || !isProblemListResponse(res.data)) return null
      return res.data
    },
    enabled: !!org?.id && !!access_token,
    staleTime: 15_000,
  })

  const problems = data?.problems ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (data?.limit ?? 20)))

  const stats = useMemo(() => {
    const tests = problems.reduce((sum, p) => sum + (p.tests?.length || 0), 0)
    return { tests }
  }, [problems])

  function openCreate() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setEditorOpen(true)
  }

  function openEdit(problem: Problem) {
    setEditing(problem)
    setDraft(asDraft(problem))
    setEditorOpen(true)
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateTest(index: number, patch: Partial<ProblemTest>) {
    setDraft((current) => ({
      ...current,
      tests: current.tests.map((test, i) => (i === index ? { ...test, ...patch } : test)),
    }))
  }

  async function saveProblem() {
    if (!access_token || !org?.id) return
    if (!draft.title.trim()) {
      toast.error(t('problems.errors.title', { defaultValue: 'Title is required' }))
      return
    }
    if (draft.tests.length === 0) {
      toast.error(t('problems.errors.tests', { defaultValue: 'At least one test is required' }))
      return
    }
    setSaving(true)
    try {
      const body = draftToBody(draft, editing?.languages ?? [71, 54])
      const res = editing
        ? await updateProblem(editing.problem_uuid, body, access_token)
        : await createProblem(org.id, body, access_token)
      if (!res.success) {
        toast.error(
          errorDetail(res.data) ||
            t('problems.errors.save', { defaultValue: 'Could not save the problem' })
        )
        return
      }
      toast.success(t('problems.saved', { defaultValue: 'Problem saved' }))
      setEditorOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['problems'] })
    } finally {
      setSaving(false)
    }
  }

  async function archiveProblem(problem: Problem) {
    if (!access_token) return
    const confirmed = window.confirm(
      t('problems.confirm_archive', {
        defaultValue: `Archive "${problem.title}"? Assignments keep their snapshots.`,
      })
    )
    if (!confirmed) return
    const res = await deleteProblem(problem.problem_uuid, access_token)
    if (!res.success) {
      toast.error(t('problems.errors.archive', { defaultValue: 'Could not archive the problem' }))
      return
    }
    toast.success(t('problems.archived', { defaultValue: 'Problem archived' }))
    await queryClient.invalidateQueries({ queryKey: ['problems'] })
  }

  async function restoreProblem(problem: Problem) {
    if (!access_token) return
    const res = await updateProblem(problem.problem_uuid, { archived: false }, access_token)
    if (!res.success) {
      toast.error(t('problems.errors.restore', { defaultValue: 'Could not restore the problem' }))
      return
    }
    toast.success(t('problems.restored', { defaultValue: 'Problem restored' }))
    await queryClient.invalidateQueries({ queryKey: ['problems'] })
  }

  async function runImport(dryRun: boolean) {
    if (!access_token || !org?.id || !importFile) return
    setImporting(true)
    try {
      const res = await importProblems(org.id, importFile, access_token, dryRun)
      if (!res.success) {
        const detail = errorDetail(res.data)
        toast.error(detail || t('problems.errors.import', { defaultValue: 'Import failed' }))
        return
      }
      if (!isImportReport(res.data)) {
        toast.error(t('problems.errors.import', { defaultValue: 'Import failed' }))
        return
      }
      setImportReport(res.data)
      if (!dryRun) {
        await queryClient.invalidateQueries({ queryKey: ['problems'] })
        toast.success(t('problems.import_done', { defaultValue: 'Import finished' }))
      }
    } finally {
      setImporting(false)
    }
  }

  async function runInformatics(dryRun: boolean) {
    if (!access_token || !org?.id) return
    const problemId = Number(informaticsId)
    if (!Number.isInteger(problemId) || problemId <= 0) {
      toast.error(t('problems.errors.informatics_id', { defaultValue: 'Enter a numeric problem id' }))
      return
    }
    setInformaticsBusy(true)
    try {
      const res = await importInformaticsProblem(org.id, problemId, access_token, dryRun)
      if (!res.success) {
        toast.error(
          errorDetail(res.data) ||
            t('problems.errors.informatics', { defaultValue: 'Informatics import failed' })
        )
        return
      }
      if (!isImportReport(res.data)) {
        toast.error(t('problems.errors.informatics', { defaultValue: 'Informatics import failed' }))
        return
      }
      setInformaticsReport(res.data)
      if (!dryRun) {
        await queryClient.invalidateQueries({ queryKey: ['problems'] })
        toast.success(t('problems.import_done', { defaultValue: 'Import finished' }))
      }
    } finally {
      setInformaticsBusy(false)
    }
  }

  return (
    <div className="flex w-full">
      <div className="ps-4 sm:ps-10 me-4 sm:me-10 flex flex-col space-y-5 w-full tracking-tight">
        <div className="flex items-start justify-between gap-4 pt-6">
          <div className="flex flex-col space-y-2">
            <Breadcrumbs
              items={[
                {
                  label: t('problems.title', { defaultValue: 'Problem library' }),
                  href: '/dash/problems',
                  icon: <BookOpenCheck size={14} />,
                },
              ]}
            />
            <h1 className="pt-3 flex font-bold text-4xl">
              {t('problems.title', { defaultValue: 'Problem library' })}
            </h1>
            <p className="text-sm text-gray-500">
              {t('problems.subtitle', {
                defaultValue: 'Reusable programming exercises with public and hidden tests.',
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setInformaticsReport(null)
                setInformaticsId('')
                setInformaticsOpen(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 nice-shadow"
            >
              <BookOpenCheck size={16} />
              {t('problems.from_informatics', { defaultValue: 'From Informatics' })}
            </button>
            <button
              onClick={() => {
                setImportReport(null)
                setImportFile(null)
                setImportOpen(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 nice-shadow"
            >
              <FileArchive size={16} />
              {t('problems.import', { defaultValue: 'Import ZIP' })}
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 nice-shadow"
            >
              <Plus size={16} />
              {t('problems.new', { defaultValue: 'New problem' })}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('problems.search', { defaultValue: 'Search by title or source id' })}
              className="w-full rounded-lg bg-white py-2 ps-9 pe-8 text-sm nice-shadow focus:outline-none focus:ring-2 focus:ring-black/5"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            value={difficulty}
            onChange={(event) => {
              setDifficulty(event.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">{t('problems.all_difficulties', { defaultValue: 'All difficulties' })}</option>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
          <label className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked)
                setPage(1)
              }}
            />
            {t('problems.show_archived', { defaultValue: 'Show archived' })}
          </label>
          <span className="text-xs text-gray-400">
            {total} {t('problems.found', { defaultValue: 'problems' })} · {stats.tests}{' '}
            {t('problems.tests_on_page', { defaultValue: 'tests on this page' })}
          </span>
        </div>

        <div className="overflow-hidden rounded-xl bg-white nice-shadow">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/60 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-5 py-3 text-start font-semibold">
                  {t('problems.table.title', { defaultValue: 'Problem' })}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('problems.table.source', { defaultValue: 'Source' })}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('problems.table.tests', { defaultValue: 'Tests' })}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('problems.table.difficulty', { defaultValue: 'Difficulty' })}
                </th>
                <th className="px-4 py-3 text-end font-semibold">
                  {t('problems.table.actions', { defaultValue: 'Actions' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                    {t('common.loading', { defaultValue: 'Loading…' })}
                  </td>
                </tr>
              )}
              {!isLoading && problems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                    {t('problems.empty', {
                      defaultValue: 'No problems yet. Import a pack or create one manually.',
                    })}
                  </td>
                </tr>
              )}
              {problems.map((problem) => {
                const visible = problem.tests.filter((test) => !test.hidden).length
                const hidden = problem.tests.length - visible
                return (
                  <tr key={problem.problem_uuid} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-gray-900">{problem.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                        {problem.topics.slice(0, 3).map((topic) => (
                          <span key={topic} className="rounded-full bg-gray-100 px-2 py-0.5">
                            {topic}
                          </span>
                        ))}
                        {problem.is_edited && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                            {t('problems.edited', { defaultValue: 'edited' })}
                          </span>
                        )}
                        {problem.archived && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">
                            {t('problems.archived_badge', { defaultValue: 'archived' })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {problem.source_url ? (
                        <a
                          href={problem.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {problem.source_name || 'source'}
                          {problem.source_id ? ` #${problem.source_id}` : ''}
                        </a>
                      ) : (
                        problem.source_name || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {visible} public
                      {hidden > 0 ? ` · ${hidden} hidden` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{problem.difficulty || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setPreview(problem)}
                          className="rounded-md p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                          aria-label="Preview"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(problem)}
                          className="rounded-md p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                          aria-label="Edit"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => (problem.archived ? restoreProblem(problem) : archiveProblem(problem))}
                          className={`rounded-md p-2 ${
                            problem.archived
                              ? 'text-gray-400 hover:bg-emerald-50 hover:text-emerald-600'
                              : 'text-gray-400 hover:bg-rose-50 hover:text-rose-600'
                          }`}
                          aria-label={problem.archived ? 'Restore' : 'Archive'}
                        >
                          {problem.archived ? <ArchiveRestore size={15} /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 pb-6">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-200 p-2 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 p-2 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <Modal
        isDialogOpen={editorOpen}
        onOpenChange={setEditorOpen}
        minWidth="md"
        dialogTitle={
          editing
            ? t('problems.edit_title', { defaultValue: 'Edit problem' })
            : t('problems.create_title', { defaultValue: 'New problem' })
        }
        dialogDescription={t('problems.editor_hint', {
          defaultValue: 'Markdown statement and test pairs. Hidden tests are never sent to students.',
        })}
        dialogContent={
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={LABEL}>{t('problems.fields.title', { defaultValue: 'Title' })}</label>
              <input
                className={INPUT}
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>
                {t('problems.fields.statement', { defaultValue: 'Statement (Markdown)' })}
              </label>
              <textarea
                className={`${INPUT} min-h-[160px] font-mono text-xs`}
                value={draft.statement_md}
                onChange={(event) => updateDraft('statement_md', event.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={LABEL}>
                  {t('problems.fields.input', { defaultValue: 'Input format' })}
                </label>
                <textarea
                  className={`${INPUT} min-h-[70px]`}
                  value={draft.input_format}
                  onChange={(event) => updateDraft('input_format', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL}>
                  {t('problems.fields.output', { defaultValue: 'Output format' })}
                </label>
                <textarea
                  className={`${INPUT} min-h-[70px]`}
                  value={draft.output_format}
                  onChange={(event) => updateDraft('output_format', event.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={LABEL}>
                  {t('problems.fields.constraints', { defaultValue: 'Constraints' })}
                </label>
                <textarea
                  className={`${INPUT} min-h-[60px]`}
                  value={draft.constraints}
                  onChange={(event) => updateDraft('constraints', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL}>{t('problems.fields.topics', { defaultValue: 'Topics' })}</label>
                <input
                  className={INPUT}
                  placeholder="arrays, loops"
                  value={draft.topics}
                  onChange={(event) => updateDraft('topics', event.target.value)}
                />
                <label className={`${LABEL} pt-2 block`}>
                  {t('problems.fields.difficulty', { defaultValue: 'Difficulty' })}
                </label>
                <select
                  className={INPUT}
                  value={draft.difficulty}
                  onChange={(event) => updateDraft('difficulty', event.target.value)}
                >
                  <option value="">—</option>
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={LABEL}>{t('problems.fields.source_name', { defaultValue: 'Source name' })}</label>
                <input
                  className={INPUT}
                  value={draft.source_name}
                  onChange={(event) => updateDraft('source_name', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL}>{t('problems.fields.source_id', { defaultValue: 'Source id' })}</label>
                <input
                  className={INPUT}
                  value={draft.source_id}
                  onChange={(event) => updateDraft('source_id', event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={LABEL}>{t('problems.fields.source_url', { defaultValue: 'Source URL' })}</label>
              <input
                className={INPUT}
                value={draft.source_url}
                onChange={(event) => updateDraft('source_url', event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LABEL}>{t('problems.fields.time', { defaultValue: 'Time limit, ms' })}</label>
                <input
                  className={INPUT}
                  type="number"
                  value={draft.time_limit_ms}
                  onChange={(event) => updateDraft('time_limit_ms', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL}>{t('problems.fields.memory', { defaultValue: 'Memory limit, KB' })}</label>
                <input
                  className={INPUT}
                  type="number"
                  value={draft.memory_limit_kb}
                  onChange={(event) => updateDraft('memory_limit_kb', event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">
                  {t('problems.tests', { defaultValue: 'Tests' })}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      tests: [...current.tests, newTest(current.tests.length)],
                    }))
                  }
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  + {t('problems.add_test', { defaultValue: 'Add test' })}
                </button>
              </div>
              <div className="space-y-2">
                {draft.tests.map((test, index) => (
                  <div key={test.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        className={`${INPUT} flex-1`}
                        value={test.label}
                        onChange={(event) => updateTest(index, { label: event.target.value })}
                        aria-label="Test label"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        <input
                          type="checkbox"
                          checked={test.hidden}
                          onChange={(event) => updateTest(index, { hidden: event.target.checked })}
                        />
                        hidden
                      </label>
                      <input
                        className="w-16 rounded-lg border border-gray-200 px-2 py-2 text-xs"
                        type="number"
                        min={1}
                        value={test.weight}
                        onChange={(event) => updateTest(index, { weight: Number(event.target.value) })}
                        aria-label="Weight"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            tests: current.tests.filter((_, i) => i !== index),
                          }))
                        }
                        className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Remove test"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <textarea
                        className={`${INPUT} min-h-[60px] font-mono text-xs`}
                        placeholder="stdin"
                        value={test.stdin}
                        onChange={(event) => updateTest(index, { stdin: event.target.value })}
                      />
                      <textarea
                        className={`${INPUT} min-h-[60px] font-mono text-xs`}
                        placeholder="expected stdout"
                        value={test.expected_stdout}
                        onChange={(event) => updateTest(index, { expected_stdout: event.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <button
                onClick={() => setEditorOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={saveProblem}
                disabled={saving}
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving
                  ? t('common.saving', { defaultValue: 'Saving…' })
                  : t('common.save', { defaultValue: 'Save' })}
              </button>
            </div>
          </div>
        }
      />

      <Modal
        isDialogOpen={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        minWidth="md"
        dialogTitle={preview?.title}
        dialogContent={
          preview && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t('problems.statement', { defaultValue: 'Statement' })}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-gray-800">{preview.statement_md}</pre>
              </div>
              {preview.input_format && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Input</div>
                  <pre className="whitespace-pre-wrap font-sans text-gray-700">{preview.input_format}</pre>
                </div>
              )}
              {preview.output_format && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Output</div>
                  <pre className="whitespace-pre-wrap font-sans text-gray-700">{preview.output_format}</pre>
                </div>
              )}
              {preview.constraints && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Constraints
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-gray-700">{preview.constraints}</pre>
                </div>
              )}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Tests ({preview.tests.length})
                </div>
                {preview.tests.map((test) => (
                  <div key={test.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-700">{test.label}</span>
                      <span className={test.hidden ? 'text-rose-600' : 'text-emerald-600'}>
                        {test.hidden ? 'hidden' : 'public'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <pre className="max-h-24 overflow-auto rounded bg-gray-50 p-2 text-xs">{test.stdin}</pre>
                      <pre className="max-h-24 overflow-auto rounded bg-gray-50 p-2 text-xs">
                        {test.expected_stdout}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      />

      <Modal
        isDialogOpen={importOpen}
        onOpenChange={setImportOpen}
        minWidth="md"
        dialogTitle={t('problems.import_title', { defaultValue: 'Import problem pack' })}
        dialogDescription={t('problems.import_hint', {
          defaultValue:
            'ZIP with manifest.json and one folder per problem. Validate first to preview conflicts without writing.',
        })}
        dialogContent={
          <div className="space-y-4">
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null)
                setImportReport(null)
              }}
              className="block w-full rounded-lg border border-dashed border-gray-300 p-4 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => runImport(true)}
                disabled={!importFile || importing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                <FlaskConical size={15} />
                {t('problems.validate', { defaultValue: 'Validate' })}
              </button>
              <button
                onClick={() => runImport(false)}
                disabled={!importFile || importing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <FileArchive size={15} />
                {t('problems.import', { defaultValue: 'Import' })}
              </button>
            </div>

            {importReport && (
              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  {[
                    ['created', importReport.created, 'text-emerald-600'],
                    ['updated', importReport.updated, 'text-blue-600'],
                    ['skipped', importReport.skipped, 'text-gray-500'],
                    ['conflicts', importReport.conflicts, 'text-amber-600'],
                    ['failed', importReport.failed, 'text-rose-600'],
                  ].map(([label, value, color]) => (
                    <div key={String(label)} className="rounded-lg bg-gray-50 p-2">
                      <div className={`text-lg font-bold ${color}`}>{String(value)}</div>
                      <div className="text-gray-400">{String(label)}</div>
                    </div>
                  ))}
                </div>
                <div className="max-h-64 overflow-auto rounded-lg border border-gray-100">
                  {importReport.results.map((item, index) => (
                    <div
                      key={`${item.external_id ?? 'item'}-${index}`}
                      className="flex items-start justify-between gap-3 border-b border-gray-50 px-3 py-2 text-xs last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-700">
                          {item.title || item.external_id || 'problem'}
                        </div>
                        {item.error && <div className="text-rose-600">{item.error}</div>}
                      </div>
                      <span className="flex-none uppercase tracking-wide text-gray-400">
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />
      <Modal
        isDialogOpen={informaticsOpen}
        onOpenChange={setInformaticsOpen}
        minWidth="md"
        dialogTitle={t('problems.informatics_title', { defaultValue: 'Import from Informatics' })}
        dialogDescription={t('problems.informatics_hint', {
          defaultValue:
            'Fetch one problem from informatics.msk.ru. Only the public statement, limits and sample tests are available; add hidden tests in the library editor.',
        })}
        dialogContent={
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={LABEL}>
                {t('problems.informatics_id', { defaultValue: 'Problem id' })}
              </label>
              <input
                className={INPUT}
                inputMode="numeric"
                placeholder="2936"
                value={informaticsId}
                onChange={(event) => setInformaticsId(event.target.value)}
              />
              <p className="text-[10px] text-gray-400">
                {t('problems.informatics_id_hint', {
                  defaultValue: 'The numeric id from the Informatics problem URL.',
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runInformatics(true)}
                disabled={informaticsBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                <FlaskConical size={15} />
                {t('problems.validate', { defaultValue: 'Validate' })}
              </button>
              <button
                onClick={() => runInformatics(false)}
                disabled={informaticsBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <BookOpenCheck size={15} />
                {t('problems.import', { defaultValue: 'Import' })}
              </button>
            </div>
            {informaticsReport && (
              <div className="space-y-2">
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  {[
                    ['created', informaticsReport.created, 'text-emerald-600'],
                    ['updated', informaticsReport.updated, 'text-blue-600'],
                    ['skipped', informaticsReport.skipped, 'text-gray-500'],
                    ['conflicts', informaticsReport.conflicts, 'text-amber-600'],
                    ['failed', informaticsReport.failed, 'text-rose-600'],
                  ].map(([label, value, color]) => (
                    <div key={String(label)} className="rounded-lg bg-gray-50 p-2">
                      <div className={`text-lg font-bold ${color}`}>{String(value)}</div>
                      <div className="text-gray-400">{String(label)}</div>
                    </div>
                  ))}
                </div>
                {informaticsReport.results.map((item, index) => (
                  <div
                    key={`${item.external_id ?? 'item'}-${index}`}
                    className="rounded-lg border border-gray-100 px-3 py-2 text-xs"
                  >
                    <div className="font-semibold text-gray-700">
                      {item.title || item.external_id || 'problem'}
                    </div>
                    <div className="text-gray-400">{item.status}</div>
                    {item.error && <div className="text-rose-600">{item.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}

export default ProblemLibraryPage
