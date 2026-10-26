'use client'

import React from 'react'
import { Activity, AlertTriangle, Bug, CheckCircle2, Gauge, Info, Timer } from 'lucide-react'
import type { CodeAnalysis, CodeIssue } from '@/lib/code-analysis'

interface RunResultLike {
  passed?: boolean
  time?: string | null
  memory?: number | null
  status?: { description?: string } | null
}

interface CodeAnalysisPanelProps {
  analysis: CodeAnalysis
  results?: RunResultLike[]
  isRunning?: boolean
}

const ISSUE_STYLE: Record<CodeIssue['severity'], string> = {
  error: 'text-rose-700 bg-rose-50 border-rose-200',
  warning: 'text-amber-700 bg-amber-50 border-amber-200',
  info: 'text-sky-700 bg-sky-50 border-sky-200',
}

const ISSUE_ICON: Record<CodeIssue['kind'], React.ReactNode> = {
  bug: <Bug size={12} />,
  typo: <AlertTriangle size={12} />,
  practice: <Info size={12} />,
  style: <Sparkle />,
}

function Sparkle() {
  return <span className="text-[11px] leading-none">✦</span>
}

export default function CodeAnalysisPanel({ analysis, results = [], isRunning = false }: CodeAnalysisPanelProps) {
  const measured = results.filter((result) => typeof result.time === 'string' && result.time !== '')
  const maxTime = measured.reduce((max, result) => Math.max(max, Number(result.time) || 0), 0)
  const maxMemory = results.reduce((max, result) => Math.max(max, Number(result.memory) || 0), 0)
  const passed = results.filter((result) => result.passed).length
  const errors = analysis.issues.filter((issue) => issue.severity === 'error')
  const warnings = analysis.issues.filter((issue) => issue.severity === 'warning')

  return (
    <aside className="w-full xl:w-[300px] xl:flex-shrink-0 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
          <Activity size={14} className="text-violet-500" />
          Анализ кода
        </span>
        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-bold text-violet-700">
          {analysis.complexity}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{analysis.complexityReason}</p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-slate-50 p-1.5">
          <div className="font-bold text-slate-800">{analysis.metrics.nonEmpty}</div>
          <div className="text-[10px] text-slate-400">строк</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-1.5">
          <div className="font-bold text-slate-800">{analysis.metrics.loops}</div>
          <div className="text-[10px] text-slate-400">циклов</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-1.5">
          <div className="font-bold text-slate-800">{analysis.metrics.functions}</div>
          <div className="text-[10px] text-slate-400">функций</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-600">
          <Timer size={12} /> Профиль запуска
        </div>
        {isRunning ? (
          <p className="mt-1 text-[11px] text-slate-400">Выполняется…</p>
        ) : results.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>тесты: {passed}/{results.length}</span>
            {maxTime > 0 && <span>макс: {maxTime.toFixed(3)}s</span>}
            {maxMemory > 0 && <span>память: {maxMemory} KB</span>}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-400">Запустите код, чтобы увидеть время и память.</p>
        )}
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-semibold text-slate-700">Замечания</span>
          <span className="flex items-center gap-2 text-[10px] font-semibold">
            {errors.length > 0 && <span className="text-rose-600">{errors.length} ошибок</span>}
            {warnings.length > 0 && <span className="text-amber-600">{warnings.length} предупр.</span>}
          </span>
        </div>
        {analysis.issues.length === 0 ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 size={13} /> Замечаний нет — выглядит чисто
          </div>
        ) : (
          <ul className="max-h-[260px] space-y-1 overflow-auto pe-0.5">
            {analysis.issues.map((issue) => (
              <li
                key={`${issue.line}:${issue.kind}:${issue.message}`}
                className={`flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-snug ${ISSUE_STYLE[issue.severity]}`}
              >
                <span className="mt-0.5 flex-shrink-0">{ISSUE_ICON[issue.kind]}</span>
                <span>
                  <b>стр. {issue.line}:</b> {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Gauge size={11} /> Оценка сложности и замечания статические; профиль — по последнему запуску.
      </div>
    </aside>
  )
}
