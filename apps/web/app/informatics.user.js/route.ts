import { readFile } from 'fs/promises'
import path from 'path'

import { getConfig } from '@services/config/config'

// Serving the userscript from a route (instead of a static file) lets us bake
// the public API base into it. The student then only pastes the ingest key:
// asking a non-technical learner for "the API URL" was the main setup mistake.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeApiBase(value: string, origin: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // A relative value is meant to go through the web app's /api/v1 proxy.
  const absolute = trimmed.startsWith('/') ? `${origin}${trimmed}` : trimmed
  return absolute.replace(/\/+$/, '')
}

function publicApiBase(request: Request): string {
  const origin = new URL(request.url).origin
  // getConfig prefers the runtime config file, then process.env. That keeps the
  // baked address correct in standalone builds where NEXT_PUBLIC_* was only
  // present at build time.
  const explicit = normalizeApiBase(
    getConfig('NEXT_PUBLIC_LEARNHOUSE_API_URL'),
    origin
  )
  if (explicit) return explicit

  const backend = getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL').trim()
  if (backend) {
    const base = backend.startsWith('/') ? `${origin}${backend}` : backend
    return `${base.replace(/\/+$/, '')}/api/v1`
  }

  // Last resort: the web app proxies /api/v1 on the same origin.
  return `${origin}/api/v1`
}

export async function GET(request: Request) {
  const templatePath = path.join(
    process.cwd(),
    'public',
    'informatics.user.js.template'
  )
  const template = await readFile(templatePath, 'utf8')
  const body = template.replace(
    '__ZEROK_API_BASE__',
    JSON.stringify(publicApiBase(request))
  )

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // The baked address is deployment-specific; never let a CDN or the
      // browser reuse another host's copy.
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
