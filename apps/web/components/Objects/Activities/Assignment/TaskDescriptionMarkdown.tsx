'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'

import {
  BASE_REMARK_PLUGINS,
  MATH_HINT,
  NO_REHYPE_PLUGINS,
  loadMathPlugins,
  normalizeMathDelimiters,
  type MathPlugins,
} from '@/lib/copilot/markdown'

/**
 * Student-facing renderer for assignment task statements.
 *
 * The informatics tasks ship Markdown (headings, examples in fenced blocks,
 * tables, inline LaTeX), so the plain `<p>{task.description}</p>` the page used
 * to render would show the raw syntax. KaTeX is loaded lazily: statements
 * without math never pull it into the bundle.
 */
export default function TaskDescriptionMarkdown({
  content,
  className = '',
}: {
  content: string
  className?: string
}) {
  const text = React.useMemo(() => normalizeMathDelimiters(content || ''), [content])
  const needsMath = React.useMemo(() => MATH_HINT.test(text), [text])
  const [mathPlugins, setMathPlugins] = React.useState<MathPlugins | null>(null)

  React.useEffect(() => {
    if (!needsMath || mathPlugins) return
    let active = true
    loadMathPlugins().then((plugins) => {
      if (active) setMathPlugins(plugins)
    })
    return () => {
      active = false
    }
  }, [needsMath, mathPlugins])

  const components = React.useMemo(
    () => ({
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="mt-4 mb-2 text-lg font-bold leading-snug text-neutral-900 first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 className="mt-4 mb-1.5 text-base font-bold leading-snug text-neutral-900 first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 className="mt-3 mb-1 text-sm font-semibold leading-snug text-neutral-800 first:mt-0">
          {children}
        </h3>
      ),
      h4: ({ children }: { children?: React.ReactNode }) => (
        <h4 className="mt-3 mb-1 text-sm font-semibold text-neutral-800 first:mt-0">{children}</h4>
      ),
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="my-2 text-sm leading-relaxed text-neutral-700 first:mt-0 last:mb-0">
          {children}
        </p>
      ),
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="my-2 list-disc space-y-1 ps-5 text-sm leading-relaxed text-neutral-700">
          {children}
        </ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="my-2 list-decimal space-y-1 ps-5 text-sm leading-relaxed text-neutral-700">
          {children}
        </ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="my-2 border-s-2 border-neutral-300 ps-3 text-sm italic text-neutral-600">
          {children}
        </blockquote>
      ),
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-neutral-900 underline underline-offset-2"
        >
          {children}
        </a>
      ),
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <img
          src={src}
          alt={alt || ''}
          className="my-2 max-w-full rounded-lg border border-neutral-200"
        />
      ),
      hr: () => <hr className="my-3 border-neutral-200" />,
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="my-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-800">
          {children}
        </pre>
      ),
      code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
        className?.includes('language-') ? (
          <code className={`${className} font-mono`}>{children}</code>
        ) : (
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-neutral-800">
            {children}
          </code>
        ),
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="my-3 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse text-sm text-neutral-700">{children}</table>
        </div>
      ),
      th: ({ children }: { children?: React.ReactNode }) => (
        <th className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-start font-semibold text-neutral-800">
          {children}
        </th>
      ),
      td: ({ children }: { children?: React.ReactNode }) => (
        <td className="border-b border-neutral-100 px-3 py-1.5 align-top last:border-b-0">
          {children}
        </td>
      ),
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-semibold text-neutral-900">{children}</strong>
      ),
    }),
    []
  )

  if (!text.trim()) return null

  return (
    <div
      className={`lh-task-md max-w-none break-words [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1 ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={mathPlugins ? mathPlugins.remark : BASE_REMARK_PLUGINS}
        rehypePlugins={mathPlugins ? mathPlugins.rehype : NO_REHYPE_PLUGINS}
        components={components as never}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
