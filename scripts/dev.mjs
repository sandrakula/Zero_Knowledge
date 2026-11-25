#!/usr/bin/env node
/**
 * One-command local development stack.
 *
 *   node scripts/dev.mjs              # DB + Redis + API + Web + Collab
 *   node scripts/dev.mjs --infra-only # only DB + Redis (prints ports)
 *   node scripts/dev.mjs --stop       # stop DB + Redis
 *
 * Why this exists: the Windows Hyper-V excluded port ranges change between
 * reboots, so a hard-coded Postgres port (55432) can suddenly become
 * unbindable. This script reuses the existing containers and volume, and only
 * recreates the DB container on a free port when the old mapping is gone.
 * Passwords/secrets live in .learnhouse/dev-state.json so restarting does not
 * invalidate sessions.
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE_DIR = path.join(ROOT, '.learnhouse')
const STATE_FILE = path.join(STATE_DIR, 'dev-state.json')

const DB_CONTAINER = process.env.LEARNHOUSE_DEV_DB_CONTAINER || 'lh-review-db'
const DB_VOLUME = process.env.LEARNHOUSE_DEV_DB_VOLUME || 'lh-review-db-data'
const DB_IMAGE = process.env.LEARNHOUSE_DEV_DB_IMAGE || 'pgvector/pgvector:pg16'
const REDIS_CONTAINER = process.env.LEARNHOUSE_DEV_REDIS_CONTAINER || 'lh-review-redis'
const REDIS_IMAGE = process.env.LEARNHOUSE_DEV_REDIS_IMAGE || 'redis:7.4-alpine'

const API_PORT = 1338
const WEB_PORT = 3000
const COLLAB_PORT = 4000
// Judge0-compatible local code runner (Docker sandbox). The API talks to it
// through LEARNHOUSE_JUDGE0_API_URL; it only needs Docker when code is run.
const RUNNER_PORT = 2358

const DB_PREFERRED_PORTS = [55432, 54432, 54032, 55332]
const REDIS_PREFERRED_PORT = 6379

const IS_WINDOWS = process.platform === 'win32'
const args = new Set(process.argv.slice(2))

const color = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

const log = {
  info: (m) => console.log(m),
  ok: (m) => console.log(color.green('✓ ') + m),
  warn: (m) => console.log(color.yellow('! ') + m),
  fail: (m) => console.log(color.red('✗ ') + m),
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function run(cmd, cmdArgs, options = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: 'pipe', ...options }).trim()
}

function tryRun(cmd, cmdArgs) {
  try {
    return run(cmd, cmdArgs)
  } catch {
    return null
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function secret() {
  return crypto.randomBytes(32).toString('hex')
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function pickPort(preferred, stateKey, state, rangeStart, rangeEnd) {
  const saved = Number(state[stateKey])
  const candidates = [
    ...new Set([
      ...(Number.isInteger(saved) ? [saved] : []),
      ...preferred,
    ]),
  ]
  for (const port of candidates) {
    if (await portFree(port)) return port
  }
  for (let port = rangeStart; port <= rangeEnd; port += 1) {
    if (await portFree(port)) return port
  }
  throw new Error(`No free port in ${rangeStart}-${rangeEnd}`)
}

function dockerRunning() {
  return tryRun('docker', ['info', '--format', '{{.ServerVersion}}']) !== null
}

async function ensureDocker() {
  if (dockerRunning()) return true
  if (!IS_WINDOWS) {
    log.fail('Docker is not running. Start Docker and run again.')
    return false
  }
  const dockerDesktop = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
  if (!fs.existsSync(dockerDesktop)) {
    log.fail('Docker Desktop was not found. Install/start Docker and run again.')
    return false
  }
  log.info('Starting Docker Desktop...')
  spawn(dockerDesktop, [], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 120; i += 1) {
    await sleep(2000)
    if (dockerRunning()) {
      log.ok('Docker is ready')
      return true
    }
  }
  log.fail('Docker did not start within 4 minutes.')
  return false
}

function containerExists(name) {
  return tryRun('docker', ['inspect', '--format', '{{.Id}}', name]) !== null
}

function containerRunning(name) {
  return tryRun('docker', ['inspect', '--format', '{{.State.Running}}', name]) === 'true'
}

function containerPort(name, containerPortName) {
  const raw = tryRun('docker', [
    'inspect',
    '--format',
    `{{(index (index .HostConfig.PortBindings "${containerPortName}") 0).HostPort}}`,
    name,
  ])
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 ? port : null
}

function startContainer(name) {
  return tryRun('docker', ['start', name]) !== null
}

function removeContainer(name) {
  tryRun('docker', ['rm', '-f', name])
}

async function ensureDatabase(state) {
  if (containerExists(DB_CONTAINER)) {
    const port = containerPort(DB_CONTAINER, '5432/tcp')
    if (containerRunning(DB_CONTAINER) && port) {
      state.dbPort = port
      log.ok(`Postgres already running on 127.0.0.1:${port}`)
      return state
    }
    if (port && (await portFree(port))) {
      if (startContainer(DB_CONTAINER)) {
        state.dbPort = port
        log.ok(`Postgres started on 127.0.0.1:${port}`)
        return state
      }
    }
    log.warn('The existing database container cannot use its old port; recreating it (data is kept).')
    removeContainer(DB_CONTAINER)
  }

  const port = await pickPort(DB_PREFERRED_PORTS, 'dbPort', state, 54000, 54999)
  run('docker', [
    'run', '-d',
    '--name', DB_CONTAINER,
    '-e', 'POSTGRES_USER=learnhouse',
    '-e', 'POSTGRES_PASSWORD=learnhouse',
    '-e', 'POSTGRES_DB=learnhouse',
    '-p', `127.0.0.1:${port}:5432`,
    '-v', `${DB_VOLUME}:/var/lib/postgresql/data`,
    DB_IMAGE,
  ])
  state.dbPort = port
  log.ok(`Postgres created on 127.0.0.1:${port}`)
  return state
}

async function ensureRedis(state) {
  if (containerExists(REDIS_CONTAINER)) {
    const port = containerPort(REDIS_CONTAINER, '6379/tcp')
    if (containerRunning(REDIS_CONTAINER) && port) {
      state.redisPort = port
      log.ok(`Redis already running on 127.0.0.1:${port}`)
      return state
    }
    if (port && (await portFree(port))) {
      if (startContainer(REDIS_CONTAINER)) {
        state.redisPort = port
        log.ok(`Redis started on 127.0.0.1:${port}`)
        return state
      }
    }
    log.warn('The existing Redis container cannot use its old port; recreating it.')
    removeContainer(REDIS_CONTAINER)
  }

  const port = await pickPort([REDIS_PREFERRED_PORT], 'redisPort', state, 6380, 6480)
  run('docker', [
    'run', '-d',
    '--name', REDIS_CONTAINER,
    '-p', `127.0.0.1:${port}:6379`,
    REDIS_IMAGE,
    'redis-server', '--appendonly', 'yes',
  ])
  state.redisPort = port
  log.ok(`Redis created on 127.0.0.1:${port}`)
  return state
}

async function waitForInfra(state) {
  for (let i = 0; i < 40; i += 1) {
    const db = tryRun('docker', ['exec', DB_CONTAINER, 'pg_isready', '-U', 'learnhouse'])
    const redis = tryRun('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'ping'])
    if (db && redis === 'PONG') return true
    await sleep(1000)
  }
  return false
}

function portListening(port) {
  if (!IS_WINDOWS) return false
  return spawnSync('powershell', [
    '-NoProfile', '-Command',
    `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Measure-Object).Count`,
  ], { encoding: 'utf8' }).stdout.trim() !== '0'
}

async function failIfPortTaken(label, port) {
  if (!(await portFree(port)) || portListening(port)) {
    log.fail(`${label} port ${port} is already in use. Stop the old process and run again.`)
    process.exit(1)
  }
}

function resolveUv() {
  const localUv = path.join(process.env.USERPROFILE || process.env.HOME || '', '.local', 'bin', IS_WINDOWS ? 'uv.exe' : 'uv')
  return fs.existsSync(localUv) ? localUv : 'uv'
}

function ensureDependencies() {
  const bunInstall = (dir) => {
    log.info(`Installing dependencies in ${path.relative(ROOT, dir)}...`)
    const res = spawnSync('bun', ['install'], { cwd: dir, stdio: 'inherit', shell: IS_WINDOWS })
    if (res.status !== 0) {
      log.fail(`bun install failed in ${path.relative(ROOT, dir)}`)
      process.exit(1)
    }
  }

  for (const app of ['web', 'collab']) {
    const dir = path.join(ROOT, 'apps', app)
    if (!fs.existsSync(path.join(dir, 'node_modules'))) bunInstall(dir)
  }

  const apiDir = path.join(ROOT, 'apps/api')
  if (!fs.existsSync(path.join(apiDir, '.venv'))) {
    log.info('Installing API dependencies...')
    const res = spawnSync(resolveUv(), ['sync'], { cwd: apiDir, stdio: 'inherit', shell: IS_WINDOWS })
    if (res.status !== 0) {
      log.fail('uv sync failed in apps/api')
      process.exit(1)
    }
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function spawnService(label, command, cmdArgs, cwd, env, prefixColor) {
  const child = spawn(command, cmdArgs, {
    cwd,
    shell: IS_WINDOWS,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = prefixColor(`[${label}]`)
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue
    let pending = ''
    stream.on('data', (chunk) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) console.log(`${prefix} ${line}`)
    })
  }
  child.on('error', (err) => log.fail(`${label}: ${err.message}`))
  child.on('exit', (code) => {
    if (code !== null && code !== 0) log.warn(`${label} exited with code ${code}`)
  })
  return child
}

async function waitForHttp(url, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      /* not ready yet */
    }
    await sleep(1500)
  }
  return false
}

async function main() {
  if (args.has('--stop')) {
    if (!dockerRunning()) {
      log.warn('Docker is not running; nothing to stop.')
      return
    }
    for (const name of [DB_CONTAINER, REDIS_CONTAINER]) {
      if (containerExists(name)) tryRun('docker', ['stop', name])
    }
    log.ok('Database and Redis containers stopped (volumes kept).')
    return
  }

  if (!(await ensureDocker())) process.exit(1)

  const state = readState()
  state.apiSecret ||= secret()
  state.collabKey ||= secret()
  writeState(state)

  await ensureDatabase(state)
  await ensureRedis(state)
  writeState(state)

  if (!(await waitForInfra(state))) {
    log.fail('Database or Redis did not become healthy.')
    process.exit(1)
  }
  log.ok(`DB and Redis are healthy (db :${state.dbPort}, redis :${state.redisPort})`)
  log.info(color.dim(`State: ${path.relative(ROOT, STATE_FILE)}`))

  if (args.has('--infra-only')) {
    log.info(`Postgres: postgresql://learnhouse:learnhouse@127.0.0.1:${state.dbPort}/learnhouse`)
    log.info(`Redis:    redis://127.0.0.1:${state.redisPort}/0`)
    return
  }

  await failIfPortTaken('API', API_PORT)
  await failIfPortTaken('Web', WEB_PORT)
  await failIfPortTaken('Collab', COLLAB_PORT)
  await failIfPortTaken('Runner', RUNNER_PORT)

  ensureDependencies()
  const dbUrl = `postgresql://learnhouse:learnhouse@127.0.0.1:${state.dbPort}/learnhouse`
  const redisUrl = `redis://127.0.0.1:${state.redisPort}`

  const apiEnv = {
    LEARNHOUSE_SQL_CONNECTION_STRING: dbUrl,
    LEARNHOUSE_REDIS_CONNECTION_STRING: `${redisUrl}/0`,
    LEARNHOUSE_AUTH_JWT_SECRET_KEY: state.apiSecret,
    COLLAB_INTERNAL_KEY: state.collabKey,
    LEARNHOUSE_DEVELOPMENT_MODE: 'true',
    LEARNHOUSE_TENANCY: 'single',
    LEARNHOUSE_DOMAIN: `localhost:${WEB_PORT}`,
    LEARNHOUSE_FRONTEND_DOMAIN: `localhost:${WEB_PORT}`,
    LEARNHOUSE_PORT: String(API_PORT),
    LEARNHOUSE_ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
    LEARNHOUSE_INITIAL_ADMIN_EMAIL: process.env.LEARNHOUSE_INITIAL_ADMIN_EMAIL || 'admin@school.dev',
    LEARNHOUSE_INITIAL_ADMIN_PASSWORD: process.env.LEARNHOUSE_INITIAL_ADMIN_PASSWORD || 'ReviewPhase1!2026',
    LEARNHOUSE_INITIAL_ORG_NAME: process.env.LEARNHOUSE_INITIAL_ORG_NAME || 'ZeroKnowledge Academy',
    LEARNHOUSE_INITIAL_ORG_SLUG: process.env.LEARNHOUSE_INITIAL_ORG_SLUG || 'default',
    LEARNHOUSE_DISABLE_EE: '1',
    LEARNHOUSE_IS_AI_ENABLED: 'false',
    // Local, Judge0-compatible code runner started below. Override the env var
    // to point at an external Judge0 instead.
    LEARNHOUSE_JUDGE0_API_URL:
      process.env.LEARNHOUSE_JUDGE0_API_URL || `http://127.0.0.1:${RUNNER_PORT}`,
    FORCE_COLOR: '1',
  }

  const webEnv = {
    NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: `http://localhost:${API_PORT}`,
    NEXT_PUBLIC_LEARNHOUSE_API_URL: `http://localhost:${API_PORT}/api/v1/`,
    NEXT_PUBLIC_LEARNHOUSE_DOMAIN: `localhost:${WEB_PORT}`,
    NEXT_PUBLIC_LEARNHOUSE_HTTPS: 'false',
    NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG: 'default',
    NEXT_PUBLIC_COLLAB_URL: `ws://localhost:${COLLAB_PORT}`,
    LEARNHOUSE_INTERNAL_API_URL: `http://127.0.0.1:${API_PORT}`,
    PORT: String(WEB_PORT),
    FORCE_COLOR: '1',
  }

  const collabEnv = {
    COLLAB_PORT: String(COLLAB_PORT),
    LEARNHOUSE_API_URL: `http://127.0.0.1:${API_PORT}`,
    LEARNHOUSE_AUTH_JWT_SECRET_KEY: state.apiSecret,
    COLLAB_INTERNAL_KEY: state.collabKey,
    LEARNHOUSE_REDIS_URL: redisUrl,
    FORCE_COLOR: '1',
  }

  const runnerEnv = {
    FORCE_COLOR: '1',
  }

  log.info('')
  log.info(color.bold('Starting services...'))
  const children = [
    spawnService('api', resolveUv(), ['run', 'python', 'app.py'], path.join(ROOT, 'apps/api'), apiEnv, color.bold),
    spawnService('web', 'bun', ['run', 'dev'], path.join(ROOT, 'apps/web'), webEnv, color.cyan),
    spawnService('collab', 'bun', ['run', 'dev'], path.join(ROOT, 'apps/collab'), collabEnv, color.yellow),
    spawnService(
      'runner',
      resolveUv(),
      ['run', 'uvicorn', 'src.services.code_runner.app:app', '--host', '127.0.0.1', '--port', String(RUNNER_PORT)],
      path.join(ROOT, 'apps/api'),
      runnerEnv,
      color.green,
    ),
  ]

  const shutdown = () => {
    console.log('\n' + color.dim('Stopping API, Web, Collab and Runner (containers stay running)...'))
    for (const child of children) killTree(child)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const [apiReady, webReady, runnerReady] = await Promise.all([
    waitForHttp(`http://localhost:${API_PORT}/api/v1/health`),
    waitForHttp(`http://localhost:${WEB_PORT}/login`),
    waitForHttp(`http://127.0.0.1:${RUNNER_PORT}/`),
  ])

  console.log('')
  if (apiReady) log.ok(`API      http://localhost:${API_PORT}`)
  else log.fail('API did not answer within 2 minutes (see logs above).')
  if (webReady) log.ok(`Web      http://localhost:${WEB_PORT}`)
  else log.fail('Web did not answer within 2 minutes (see logs above).')
  log.ok(`Collab   ws://localhost:${COLLAB_PORT}`)
  if (runnerReady) log.ok(`Runner   http://127.0.0.1:${RUNNER_PORT} (local code judge)`)
  else log.warn('Runner did not answer; code tests will be unavailable until it does.')
  console.log('')
  console.log(color.dim('  Ctrl+C stops the app servers. `node scripts/dev.mjs --stop` also stops DB/Redis.'))
  console.log('')

  await new Promise(() => {})
}

main().catch((err) => {
  log.fail(err?.stack || String(err))
  process.exit(1)
})
