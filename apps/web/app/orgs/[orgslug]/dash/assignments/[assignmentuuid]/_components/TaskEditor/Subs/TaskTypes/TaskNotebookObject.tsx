'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import toast from 'react-hot-toast'
import { v4 as uuidv4 } from 'uuid'
import { Play, Loader2, Plus, Trash2, Upload, FileCode2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentSubmission,
  useAssignmentTaskSubmissions,
} from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import {
  getAssignmentTask,
  getAssignmentTaskSubmissionsUser,
  handleAssignmentTaskSubmission,
  updateAssignmentTask,
} from '@services/courses/assignments'
import { getAPIUrl } from '@services/config/config'
import { queryKeys } from '@/lib/query/keys'
import { applyManualGrade } from './applyManualGrade'
import {
  isMissingPythonModule,
  runNotebookCellInBrowser,
} from '@/lib/notebook/pyodideRunner'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => <div className="h-[160px] bg-[#1a1b26] animate-pulse rounded-md" />,
})

type NotebookCellType = 'markdown' | 'code' | 'raw'

type CellOutput = {
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  status?: { id: number; description: string } | null
  time?: string | null
  image?: string | null
}

type NotebookCell = {
  id: string
  cell_type: NotebookCellType
  source: string
  output?: CellOutput | null
}

type NotebookContents = {
  kind: 'notebook'
  language_id: number
  cells: NotebookCell[]
}

type TaskNotebookObjectProps = {
  view: 'teacher' | 'student' | 'grading'
  assignmentTaskUUID?: string
  user_id?: string
  onGraded?: () => void
}

const DEFAULT_CONTENTS: NotebookContents = {
  kind: 'notebook',
  language_id: 71,
  cells: [],
}

const cmStyles: React.CSSProperties = {
  fontSize: '14px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
}

const cmClassName = [
  '[&_.cm-editor]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!border-r-transparent',
  '[&_.cm-activeLineGutter]:!bg-[#24283b]',
  '[&_.cm-activeLine]:!bg-[#24283b]',
  '[&_.cm-editor]:!outline-none',
  '[&_.cm-focused]:!outline-none',
  '[&_.cm-scroller]:!overflow-auto',
  '[&_.cm-line]:!px-4',
].join(' ')

function normalizeSource(source: unknown): string {
  if (Array.isArray(source)) return source.join('')
  return typeof source === 'string' ? source : ''
}

function normalizeCells(raw: any): NotebookCell[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((cell: any) => cell && typeof cell === 'object')
    .map((cell: any, index: number) => {
      const type: NotebookCellType =
        cell.cell_type === 'code' || cell.cell_type === 'raw' ? cell.cell_type : 'markdown'
      return {
        id: typeof cell.id === 'string' && cell.id ? cell.id : `cell_${index}`,
        cell_type: type,
        source: normalizeSource(cell.source),
        output: cell.output ?? null,
      }
    })
}

function normalizeContents(raw: any): NotebookContents {
  if (!raw || raw.kind !== 'notebook') return DEFAULT_CONTENTS
  return {
    kind: 'notebook',
    language_id: Number(raw.language_id) || 71,
    cells: normalizeCells(raw.cells),
  }
}

function toDefinitionCells(cells: NotebookCell[]): NotebookCell[] {
  return cells.map(({ id, cell_type, source }) => ({ id, cell_type, source }))
}

function notebookFromIpynb(raw: string): NotebookCell[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed?.cells)) {
    throw new Error('This file has no cells array')
  }
  return normalizeCells(
    parsed.cells.map((cell: any) => ({
      id: `cell_${uuidv4()}`,
      cell_type: cell.cell_type,
      source: cell.source,
    }))
  )
}

function parseJudgeOutput(result: any): CellOutput {
  return {
    stdout: result?.stdout ?? null,
    stderr: result?.stderr ?? null,
    compile_output: result?.compile_output ?? null,
    status: result?.status ?? null,
    time: result?.time ?? null,
  }
}

function hasOutput(output?: CellOutput | null): boolean {
  if (!output) return false
  return Boolean(
    output.stdout ||
      output.stderr ||
      output.compile_output ||
      output.status?.description ||
      output.image
  )
}

function CellOutputView({ output }: { output?: CellOutput | null }) {
  if (!hasOutput(output)) return null
  return (
    <div className="border-t border-gray-200 bg-[#fbfbfb] px-4 py-3 text-xs font-mono space-y-2">
      {output?.stdout ? (
        <pre className="whitespace-pre-wrap break-words text-gray-800">{output.stdout}</pre>
      ) : null}
      {output?.stderr ? (
        <pre className="whitespace-pre-wrap break-words text-rose-700">{output.stderr}</pre>
      ) : null}
      {output?.compile_output ? (
        <pre className="whitespace-pre-wrap break-words text-amber-700">{output.compile_output}</pre>
      ) : null}
      {output?.image ? (
        <img
          src={output.image}
          alt="Notebook cell output"
          className="max-w-full rounded-md border border-gray-200 bg-white"
        />
      ) : null}
      {output?.status?.description ? (
        <div className="text-[11px] text-gray-400">
          {output.status.description}
          {output.time ? ` · ${output.time}s` : ''}
        </div>
      ) : null}
    </div>
  )
}

function TaskNotebookObject({ view, assignmentTaskUUID, user_id, onGraded }: TaskNotebookObjectProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskDispatch = useAssignmentsTaskDispatch() as any
  const assignment = useAssignments() as any
  const taskSubmissionsMap = useAssignmentTaskSubmissions()
  const queryClient = useQueryClient()

  const assignmentSubmission = useAssignmentSubmission() as any
  const latestSubmissionStatus =
    Array.isArray(assignmentSubmission) && assignmentSubmission.length > 0
      ? assignmentSubmission[0]?.submission_status
      : null
  const submissionIsGraded = latestSubmissionStatus === 'GRADED'
  const canStudentSave =
    !submissionIsGraded && latestSubmissionStatus !== 'SUBMITTED'

  const [contents, setContents] = useState<NotebookContents>(DEFAULT_CONTENTS)
  const [cells, setCells] = useState<NotebookCell[]>([])
  const [initialCells, setInitialCells] = useState('[]')
  const [userSubmissions, setUserSubmissions] = useState<any>(null)
  const [taskOutsideProvider, setTaskOutsideProvider] = useState<any>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const [cmExtensions, setCmExtensions] = useState<any[]>([])
  const [cmTheme, setCmTheme] = useState<any>(null)

  const definitionHydratedRef = useRef<string | null>(null)
  const submissionHydratedRef = useRef<string | null>(null)
  const interactedRef = useRef(false)

  const isReadOnly =
    view === 'grading' ||
    (view === 'student' && !canStudentSave)
  const canRun = view !== 'grading' && (view === 'teacher' || canStudentSave)

  useEffect(() => {
    import('@codemirror/lang-python')
      .then(({ python }) => setCmExtensions([python()]))
      .catch(() => setCmExtensions([]))
    import('@uiw/codemirror-theme-tokyo-night')
      .then(({ tokyoNight }) => setCmTheme(tokyoNight))
      .catch(() => setCmTheme(null))
  }, [])

  // --- TEACHER ---
  useEffect(() => {
    if (view !== 'teacher') return
    const raw = assignmentTaskState?.assignmentTask?.contents
    if (!raw || raw.kind !== 'notebook') return
    const normalized = normalizeContents(raw)
    setContents(normalized)
    setCells(normalized.cells)
    setInitialCells(JSON.stringify(toDefinitionCells(normalized.cells)))
  }, [view, assignmentTaskState])

  // --- STUDENT ---
  useEffect(() => {
    if (view !== 'student' || !assignmentTaskUUID) return

    if (definitionHydratedRef.current !== assignmentTaskUUID) {
      const task = assignment?.assignment_tasks?.find(
        (item: any) => item.assignment_task_uuid === assignmentTaskUUID
      )
      if (task) {
        const normalized = normalizeContents(task.contents)
        setTaskOutsideProvider(task)
        setContents(normalized)
        if (submissionHydratedRef.current !== assignmentTaskUUID) {
          setCells(normalized.cells)
          setInitialCells(JSON.stringify(normalized.cells))
        }
        definitionHydratedRef.current = assignmentTaskUUID
      }
    }

    if (taskSubmissionsMap !== null && submissionHydratedRef.current !== assignmentTaskUUID) {
      const submission = taskSubmissionsMap?.[assignmentTaskUUID] ?? null
      if (submission) {
        setUserSubmissions(submission)
        const submittedCells = normalizeCells(submission?.task_submission?.cells)
        if (submittedCells.length > 0) {
          setInitialCells(JSON.stringify(submittedCells))
          if (!interactedRef.current) setCells(submittedCells)
        }
      }
      submissionHydratedRef.current = assignmentTaskUUID
    }
  }, [view, assignmentTaskUUID, assignment?.assignment_tasks, taskSubmissionsMap])

  // --- GRADING ---
  useEffect(() => {
    if (view !== 'grading' || !assignmentTaskUUID || !user_id) return
    let cancelled = false

    async function load() {
      const taskRes = await getAssignmentTask(assignmentTaskUUID as string, access_token)
      if (cancelled || !taskRes.success) return
      const normalized = normalizeContents(taskRes.data.contents)
      setTaskOutsideProvider(taskRes.data)
      setContents(normalized)
      setCells(normalized.cells)

      const submissionRes = await getAssignmentTaskSubmissionsUser(
        assignmentTaskUUID as string,
        user_id as string,
        assignment.assignment_object.assignment_uuid,
        access_token
      )
      if (cancelled) return
      if (submissionRes.success && submissionRes.data) {
        setUserSubmissions(submissionRes.data)
        const submittedCells = normalizeCells(submissionRes.data?.task_submission?.cells)
        if (submittedCells.length > 0) setCells(submittedCells)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [view, assignmentTaskUUID, user_id, assignment, access_token])

  function updateCellSource(id: string, source: string) {
    interactedRef.current = true
    setCells((prev) =>
      prev.map((cell) => (cell.id === id ? { ...cell, source, output: null } : cell))
    )
  }

  function addCell(type: 'markdown' | 'code') {
    setCells((prev) => [
      ...prev,
      {
        id: `cell_${uuidv4()}`,
        cell_type: type,
        source: type === 'code' ? '' : '',
      },
    ])
  }

  function removeCell(id: string) {
    setCells((prev) => prev.filter((cell) => cell.id !== id))
  }

  async function onNotebookUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = notebookFromIpynb(text)
      if (parsed.length === 0) {
        toast.error(t('dashboard.assignments.editor.task_editor.notebook.empty_file', {
          defaultValue: 'This notebook has no cells',
        }))
        return
      }
      setCells(parsed)
      setInitialCells(JSON.stringify(parsed))
      toast.success(t('dashboard.assignments.editor.task_editor.notebook.loaded', {
        defaultValue: 'Notebook loaded',
      }))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('dashboard.assignments.editor.task_editor.notebook.invalid_file', {
              defaultValue: 'Could not read this .ipynb file',
            })
      )
    } finally {
      event.target.value = ''
      setFileInputKey((key) => key + 1)
    }
  }

  async function runCell(cell: NotebookCell, index: number) {
    if (runningCellId || cell.cell_type !== 'code') return
    setRunningCellId(cell.id)
    try {
      const previousSources = cells
        .slice(0, index)
        .filter((item) => item.cell_type === 'code')
        .map((item) => item.source)
      const encode = (source: string) => {
        const bytes = new TextEncoder().encode(source)
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return btoa(binary)
      }
      // Re-run the preceding code cells in the same module namespace with
      // their stdout/stderr suppressed, then execute the current cell
      // normally. Judge0 has no persistent kernel, so this recreates the
      // notebook state without duplicating earlier cells' output.
      const previousLiterals = previousSources.map((source) => `'${encode(source)}'`).join(', ')
      const sourceCode = [
        'import base64 as _nb_b64, contextlib as _nb_ctx, io as _nb_io',
        '_nb_globals = globals()',
        `for _nb_src in [${previousLiterals}]:`,
        '    with _nb_ctx.redirect_stdout(_nb_io.StringIO()), _nb_ctx.redirect_stderr(_nb_io.StringIO()):',
        "        exec(compile(_nb_b64.b64decode(_nb_src).decode('utf-8'), '<cell>', 'exec'), _nb_globals)",
        `exec(compile(_nb_b64.b64decode('${encode(cell.source)}').decode('utf-8'), '<current-cell>', 'exec'), _nb_globals)`,
      ].join('\n')

      const response = await fetch(`${getAPIUrl()}code/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          activity_uuid: assignment?.activity_object?.activity_uuid,
          language_id: contents.language_id,
          source_code: sourceCode,
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        toast.error(`Code execution failed${detail ? `: ${detail}` : ''}`)
        return
      }

      const result = await response.json()
      let output = parseJudgeOutput(result)

      if (isMissingPythonModule(output)) {
        const toastId = toast.loading(
          t('dashboard.assignments.editor.task_editor.notebook.loading_runtime', {
            defaultValue: 'Loading scientific Python runtime (numpy/pandas/sklearn)…',
          }),
          { duration: 120000 }
        )
        try {
          output = await runNotebookCellInBrowser(
            previousSources,
            cell.source,
            (message) => toast.loading(message, { id: toastId })
          )
        } finally {
          toast.dismiss(toastId)
        }
      }

      setCells((prev) =>
        prev.map((item, itemIndex) =>
          itemIndex === index ? { ...item, output } : item
        )
      )
    } catch {
      toast.error('Code execution failed')
    } finally {
      setRunningCellId(null)
    }
  }

  // --- TEACHER SAVE ---
  async function saveFC() {
    if (!assignmentTaskState?.assignmentTask?.assignment_task_uuid) return
    const updatedContents: NotebookContents = {
      ...contents,
      kind: 'notebook',
      cells: toDefinitionCells(cells),
    }
    const res = await updateAssignmentTask(
      { contents: updatedContents },
      assignmentTaskState.assignmentTask.assignment_task_uuid,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success) {
      assignmentTaskDispatch({ type: 'reload' })
      setInitialCells(JSON.stringify(toDefinitionCells(cells)))
      toast.success(t('dashboard.assignments.editor.toasts.task_updated'))
    } else {
      toast.error(t('dashboard.assignments.editor.toasts.task_update_error'))
    }
  }

  // --- STUDENT SAVE / SUBMIT ---
  async function submitFC(opts?: { silent?: boolean }) {
    if (!assignmentTaskUUID) return true
    const payloadCells = cells.map(({ id, cell_type, source, output }) => ({
      id,
      cell_type,
      source,
      output: output ?? null,
    }))
    const values = {
      assignment_task_submission_uuid: userSubmissions?.assignment_task_submission_uuid || null,
      task_submission: { cells: payloadCells },
      grade: 0,
      task_submission_grade_feedback: '',
    }
    const res = await handleAssignmentTaskSubmission(
      values,
      assignmentTaskUUID,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success) {
      setUserSubmissions(res.data)
      setInitialCells(JSON.stringify(payloadCells))
      queryClient.setQueryData(
        queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid),
        (old: any) => (old ? { ...old, [assignmentTaskUUID]: res.data } : old)
      )
      if (!opts?.silent) {
        toast.success(t('dashboard.assignments.editor.toasts.task_saved'))
      }
      return true
    }
    if (!opts?.silent) {
      toast.error(t('dashboard.assignments.editor.toasts.task_save_error'))
    }
    return false
  }

  // --- MANUAL GRADE ---
  async function gradeCustomFC(grade: number, feedback?: string) {
    if (!userSubmissions) return
    await applyManualGrade({
      grade,
      feedback,
      maxPoints: taskOutsideProvider?.max_grade_value || 100,
      assignmentTaskUUID,
      assignmentUUID: assignment.assignment_object.assignment_uuid,
      accessToken: access_token,
      username: session?.data?.user?.username,
      assignmentTaskSubmissionUUID: userSubmissions.assignment_task_submission_uuid,
      taskSubmissionPayload: userSubmissions,
      onSuccess: () => onGraded?.(),
    })
  }

  const dirtyValue = useMemo(() => JSON.stringify(cells), [cells])
  const maxPoints =
    taskOutsideProvider?.max_grade_value ||
    assignmentTaskState?.assignmentTask?.max_grade_value ||
    100

  return (
    <AssignmentBoxUI
      type="notebook"
      view={view}
      saveFC={view === 'teacher' ? saveFC : undefined}
      submitFC={view === 'student' ? submitFC : undefined}
      taskUUID={assignmentTaskUUID}
      gradeCustomFC={gradeCustomFC}
      currentPoints={userSubmissions?.grade}
      currentFeedback={userSubmissions?.task_submission_grade_feedback}
      maxPoints={maxPoints}
      dirtyValue={dirtyValue}
      savedValue={initialCells}
      autoGradable={false}
    >
      <div className="flex flex-col space-y-4">
        {view === 'teacher' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50">
              <Upload size={15} />
              {t('dashboard.assignments.editor.task_editor.notebook.upload', {
                defaultValue: 'Upload .ipynb',
              })}
              <input
                key={fileInputKey}
                type="file"
                accept=".ipynb,application/x-ipynb+json"
                className="hidden"
                onChange={onNotebookUpload}
              />
            </label>
            <button
              type="button"
              onClick={() => addCell('code')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50"
            >
              <Plus size={15} /> Code cell
            </button>
            <button
              type="button"
              onClick={() => addCell('markdown')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50"
            >
              <Plus size={15} /> Markdown cell
            </button>
            <span className="text-xs text-gray-400">
              {cells.filter((cell) => cell.cell_type === 'code').length} code ·{' '}
              {cells.filter((cell) => cell.cell_type === 'markdown').length} markdown
            </span>
          </div>
        )}

        {cells.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-8 text-center text-sm text-gray-500">
            <FileCode2 className="mx-auto mb-2 text-gray-400" size={28} />
            {view === 'teacher'
              ? t('dashboard.assignments.editor.task_editor.notebook.empty_teacher', {
                  defaultValue: 'Upload a .ipynb file or add cells manually',
                })
              : t('dashboard.assignments.editor.task_editor.notebook.empty_student', {
                  defaultValue: 'This notebook has no cells yet',
                })}
          </div>
        ) : null}

        {cells.map((cell, index) => (
          <div key={cell.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <span className="rounded bg-white border border-gray-200 px-1.5 py-0.5">
                  {cell.cell_type === 'code' ? `In [${index + 1}]` : 'MD'}
                </span>
                {cell.cell_type === 'code' ? 'Python' : 'Markdown'}
              </div>
              <div className="flex items-center gap-1.5">
                {cell.cell_type === 'code' && canRun && !isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => runCell(cell, index)}
                    disabled={runningCellId !== null}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {runningCellId === cell.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Play size={13} />
                    )}
                    Run
                  </button>
                ) : null}
                {view === 'teacher' ? (
                  <button
                    type="button"
                    onClick={() => removeCell(cell.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>

            {cell.cell_type === 'markdown' ? (
              view === 'teacher' ? (
                <textarea
                  value={cell.source}
                  onChange={(event) => updateCellSource(cell.id, event.target.value)}
                  rows={Math.max(3, cell.source.split('\n').length)}
                  className="w-full resize-y px-4 py-3 text-sm font-mono text-gray-700 focus:outline-none"
                  placeholder="Markdown cell"
                />
              ) : (
                <div className="px-4 py-3 text-sm text-gray-700 prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.source}</ReactMarkdown>
                </div>
              )
            ) : (
              <CodeMirror
                value={cell.source}
                height="auto"
                minHeight="100px"
                theme={cmTheme}
                extensions={cmExtensions}
                editable={!isReadOnly}
                onChange={(value) => updateCellSource(cell.id, value)}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: !isReadOnly,
                }}
                style={cmStyles}
                className={cmClassName}
                placeholder="# Write Python here"
              />
            )}

            <CellOutputView output={cell.output} />
          </div>
        ))}
      </div>
    </AssignmentBoxUI>
  )
}

export default TaskNotebookObject
