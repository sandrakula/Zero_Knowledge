export type IssueSeverity = 'error' | 'warning' | 'info'

export interface CodeIssue {
  line: number
  message: string
  severity: IssueSeverity
  kind: 'bug' | 'practice' | 'typo' | 'style'
}

export interface CodeAnalysis {
  complexity: string
  complexityReason: string
  issues: CodeIssue[]
  lineClasses: Record<number, string>
  metrics: {
    lines: number
    nonEmpty: number
    loops: number
    functions: number
    nesting: number
  }
}

// One issue per line is enough for the editor gutter; keep the highest severity.
const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 3, warning: 2, info: 1 }
const CLASS_BY_SEVERITY: Record<IssueSeverity, string> = {
  error: 'cm-analysis-error',
  warning: 'cm-analysis-warning',
  info: 'cm-analysis-info',
}

function lineIndent(line: string): number {
  return line.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ').length || 0
}

function collectLineClasses(issues: CodeIssue[]): Record<number, string> {
  const best: Record<number, IssueSeverity> = {}
  for (const issue of issues) {
    if (!best[issue.line] || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[best[issue.line]]) {
      best[issue.line] = issue.severity
    }
  }
  const classes: Record<number, string> = {}
  for (const [line, severity] of Object.entries(best)) {
    classes[Number(line)] = CLASS_BY_SEVERITY[severity]
  }
  return classes
}

function estimateComplexity(lines: string[], languageId: number): { complexity: string; reason: string; nesting: number; loops: number; functions: number } {
  const isPython = languageId === 71
  let loops = 0
  let functions = 0
  let nesting = 0
  let braceDepth = 0
  let currentLoopDepth = 0
  const loopStack: number[] = []

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, '').replace(/#.*$/, '')
    const trimmed = line.trim()
    if (!trimmed) continue

    if (isPython) {
      const indent = lineIndent(raw)
      if (/^(for|while)\b/.test(trimmed)) {
        loops++
        while (loopStack.length && loopStack[loopStack.length - 1] >= indent) loopStack.pop()
        loopStack.push(indent)
        nesting = Math.max(nesting, loopStack.length)
      } else if (trimmed && !/^\s/.test(raw) && !/^(if|elif|else|try|except|finally|with|@)/.test(trimmed)) {
        while (loopStack.length && loopStack[loopStack.length - 1] >= indent) loopStack.pop()
      }
      if (/^def\s+[A-Za-z_]\w*\s*\(/.test(trimmed)) functions++
    } else {
      if (/\b(for|while)\s*\(/.test(trimmed)) {
        loops++
        currentLoopDepth = loopStack.length + 1
        loopStack.push(braceDepth)
        nesting = Math.max(nesting, loopStack.length)
      }
      if (/\b[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*\([^;]*\)\s*(const)?\s*\{/.test(trimmed) && !/\b(if|for|while|switch|catch)\b/.test(trimmed)) {
        functions++
      }
      braceDepth += (trimmed.match(/\{/g) || []).length
      braceDepth -= (trimmed.match(/\}/g) || []).length
      while (loopStack.length && braceDepth <= loopStack[loopStack.length - 1]) loopStack.pop()
      if (currentLoopDepth && loopStack.length === 0) currentLoopDepth = 0
    }
  }

  const text = lines.join('\n')
  const hasSort = /\b(sort|sorted|qsort)\s*\(/.test(text)
  const hasBinarySearch = /\b(mid|low|high|left|right)\b/.test(text) && /\b(while|for)\b/.test(text) && /\/\s*2|\b>>\s*1\b/.test(text)
  const functionNames = [...text.matchAll(/\b(?:def|void|int|double|float|long|bool|string|auto)\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1])
  const recursive = functionNames.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (text.match(new RegExp(`\\b${escaped}\\s*\\(`, 'g')) || []).length > 1
  })

  if (recursive) return { complexity: 'O(2^n)?', reason: 'обнаружена рекурсия', nesting, loops, functions }
  if (hasSort) return { complexity: 'O(n log n)', reason: 'используется сортировка', nesting, loops, functions }
  if (hasBinarySearch) return { complexity: 'O(log n)', reason: 'похоже на бинарный поиск', nesting, loops, functions }
  if (nesting >= 3) return { complexity: 'O(n³)', reason: `${nesting} уровня вложенных циклов`, nesting, loops, functions }
  if (nesting === 2) return { complexity: 'O(n²)', reason: 'два уровня вложенных циклов', nesting, loops, functions }
  if (nesting === 1) return { complexity: 'O(n)', reason: 'один цикл', nesting, loops, functions }
  return { complexity: 'O(1)', reason: 'циклов не найдено', nesting, loops, functions }
}

function cppIssues(lines: string[]): CodeIssue[] {
  const issues: CodeIssue[] = []
  const full = lines.join('\n')
  let braces = 0

  const typoPatterns: Array<[RegExp, string]> = [
    [/#include\s*<iosteam>/, 'Опечатка: iosteam → iostream'],
    [/#include\s*<iostram>/, 'Опечатка: iostram → iostream'],
    [/\busing\s+namesapce\b/, 'Опечатка: namesapce → namespace'],
    [/\bpritnf\s*\(/, 'Опечатка: pritnf → printf'],
    [/\bconut\s*<</, 'Опечатка: conut → cout'],
    [/\bend1\b/, 'Опечатка: end1 → endl'],
  ]

  lines.forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('//')) return

    for (const [pattern, message] of typoPatterns) {
      if (pattern.test(trimmed)) issues.push({ line, message, severity: 'error', kind: 'typo' })
    }
    if (/\bendl\b/.test(trimmed)) {
      issues.push({ line, message: "endl сбрасывает буфер на каждом выводе; для скорости лучше '\\n'", severity: 'warning', kind: 'practice' })
    }
    if (/\bsystem\s*\(/.test(trimmed)) {
      issues.push({ line, message: 'system() опасен и непереносим', severity: 'warning', kind: 'practice' })
    }
    if (/\bgets\s*\(/.test(trimmed)) {
      issues.push({ line, message: 'gets() небезопасен и удалён из C++', severity: 'error', kind: 'bug' })
    }
    if (/\bscanf\s*\([^)]*%[diu]/.test(trimmed) && !trimmed.includes('&')) {
      issues.push({ line, message: 'В scanf для %d/%i/%u обычно нужен & перед переменной', severity: 'warning', kind: 'bug' })
    }
    if (/\/\s*0\b/.test(trimmed)) {
      issues.push({ line, message: 'Деление на ноль', severity: 'error', kind: 'bug' })
    }
    if (/\bwhile\s*\(\s*(true|1)\s*\)/.test(trimmed)) {
      issues.push({ line, message: 'Бесконечный цикл: убедитесь, что внутри есть break/return', severity: 'warning', kind: 'practice' })
    }
    const forHeader = trimmed.match(/\bfor\s*\(([^)]*)\)/)
    if (forHeader) {
      const header = forHeader[1]
      const semicolons = (header.match(/;/g) || []).length
      if (semicolons < 2 && header.includes(',')) {
        issues.push({
          line,
          message: 'В заголовке for нужны две точки с запятой (;), а не запятые между условиями',
          severity: 'error',
          kind: 'bug',
        })
      }
    }

    braces += (trimmed.match(/\{/g) || []).length
    braces -= (trimmed.match(/\}/g) || []).length

    const isContinuation =
      /[,+\-*/%&|?:=(]$/.test(trimmed) ||
      /\\$/.test(trimmed) ||
      /^(if|for|while|switch|else|do|try|catch|case|default|public|private|protected|namespace|using|struct|class|template)\b/.test(trimmed) ||
      /^(#include|#define|#pragma|#if|#else|#endif)\b/.test(trimmed)
    const endsStatement = /[;{}:]$/.test(trimmed) || trimmed.endsWith(')') === false
    if (
      /[;{}:]\s*$/.test(trimmed) === false &&
      /^(cout|cin|cerr|printf|scanf|return|break|continue|delete|throw)\b/.test(trimmed) &&
      !isContinuation
    ) {
      issues.push({ line, message: 'Похоже, пропущена точка с запятой', severity: 'error', kind: 'bug' })
    }
    if (trimmed.endsWith(')') && /^(cout|cin|cerr)\b/.test(trimmed)) {
      issues.push({ line, message: 'Похоже, пропущена точка с запятой', severity: 'error', kind: 'bug' })
    }
    if (!endsStatement && /^(cout|cin|cerr)\b/.test(trimmed)) {
      issues.push({ line, message: 'Похоже, пропущена точка с запятой', severity: 'error', kind: 'bug' })
    }
  })

  if (braces > 0) issues.push({ line: lines.length, message: `Не закрыто фигурных скобок: ${braces}`, severity: 'error', kind: 'bug' })
  if (braces < 0) issues.push({ line: 1, message: 'Лишние закрывающие фигурные скобки', severity: 'error', kind: 'bug' })
  if (/\bint\s+main\s*\(/.test(full) === false) {
    issues.push({ line: 1, message: 'Не найдена функция int main()', severity: 'warning', kind: 'practice' })
  }
  return issues
}

function pythonIssues(lines: string[]): CodeIssue[] {
  const issues: CodeIssue[] = []
  const full = lines.join('\n')

  lines.forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const typoPatterns: Array<[RegExp, string]> = [
      [/\bprnt\s*\(/, 'Опечатка: prnt → print'],
      [/\bimoprt\b/, 'Опечатка: imoprt → import'],
      [/\bflase\b|\bFasle\b/, 'Опечатка: flase/Fasle → False'],
      [/\bTure\b|\bTru\b/, 'Опечатка: Ture/Tru → True'],
    ]
    for (const [pattern, message] of typoPatterns) {
      if (pattern.test(trimmed)) issues.push({ line, message, severity: 'error', kind: 'typo' })
    }
    if (/^except\s*:/.test(trimmed)) {
      issues.push({ line, message: 'Голый except перехватывает всё; укажите тип исключения', severity: 'warning', kind: 'practice' })
    }
    if (/==\s*None\b/.test(trimmed)) {
      issues.push({ line, message: 'Сравнение с None: используйте is None', severity: 'warning', kind: 'practice' })
    }
    if (/\b(eval|exec)\s*\(/.test(trimmed)) {
      issues.push({ line, message: 'eval/exec небезопасны для пользовательского ввода', severity: 'warning', kind: 'practice' })
    }
    if (/\bdef\s+\w+\s*\([^)]*=\s*(\[\]|\{\})/.test(trimmed)) {
      issues.push({ line, message: 'Изменяемый аргумент по умолчанию создаётся один раз', severity: 'warning', kind: 'bug' })
    }
    if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(trimmed) && !trimmed.endsWith(':')) {
      issues.push({ line, message: 'Похоже, пропущено двоеточие в конце строки', severity: 'error', kind: 'bug' })
    }
    if (/\brange\s*\(\s*len\s*\(/.test(trimmed)) {
      issues.push({ line, message: 'range(len(...)) обычно заменяется на enumerate(...)', severity: 'info', kind: 'style' })
    }
    if (/\bprint\s*\(/.test(trimmed) && /\b(for|while)\b/.test(trimmed) === false) {
      // Print itself is not a bug; only flag it when it looks like debug output
      // left in a computational solution.
      if (/debug|test|xxx|todo/i.test(trimmed)) {
        issues.push({ line, message: 'Похоже на отладочный вывод', severity: 'info', kind: 'practice' })
      }
    }
  })

  if (/\bdef\s+main\s*\(/.test(full) === false && /\bprint\s*\(/.test(full) === false) {
    issues.push({ line: 1, message: 'Нет вывода: программа ничего не печатает', severity: 'warning', kind: 'practice' })
  }
  return issues
}

export function analyzeCode(code: string, languageId: number): CodeAnalysis {
  const lines = (code || '').split('\n')
  const nonEmpty = lines.filter((line) => line.trim().length > 0).length
  const isPython = languageId === 71
  const issues = isPython ? pythonIssues(lines) : cppIssues(lines)
  const estimate = estimateComplexity(lines, languageId)
  const unique = [...new Map(issues.map((issue) => [`${issue.line}:${issue.message}`, issue])).values()]
    .sort((a, b) => a.line - b.line || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])

  return {
    complexity: estimate.complexity,
    complexityReason: estimate.reason,
    issues: unique,
    lineClasses: collectLineClasses(unique),
    metrics: {
      lines: lines.length,
      nonEmpty,
      loops: estimate.loops,
      functions: estimate.functions,
      nesting: estimate.nesting,
    },
  }
}
