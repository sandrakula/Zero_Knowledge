import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export interface InformaticsMe {
  linked: boolean
  username: string
  informatics_user_id: number
  token_created_at: string
  last_seen_at: string
  solved_count: number
}

export interface InformaticsResult {
  problem_id: number
  run_id: number
  ejudge_status: number
  tests: number
  score: number
  solved: boolean
  source: string
  created_at: string
  updated_at: string
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (body?.detail?.message) detail = String(body.detail.message)
      else if (body?.detail) detail = JSON.stringify(body.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export async function getInformaticsMe(accessToken: string): Promise<InformaticsMe> {
  const response = await fetch(
    `${getAPIUrl()}informatics/me`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsMe>(response)
}

export async function updateInformaticsUsername(
  username: string,
  informaticsUserId: number,
  accessToken: string
): Promise<InformaticsMe> {
  const response = await fetch(
    `${getAPIUrl()}informatics/me`,
    RequestBodyWithAuthHeader(
      'PATCH',
      { username, informatics_user_id: informaticsUserId },
      null,
      accessToken
    )
  )
  return parse<InformaticsMe>(response)
}

export async function createInformaticsToken(
  accessToken: string
): Promise<{ token: string; token_created_at: string }> {
  const response = await fetch(
    `${getAPIUrl()}informatics/token`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return parse<{ token: string; token_created_at: string }>(response)
}

export async function unlinkInformatics(accessToken: string): Promise<{ linked: boolean }> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return parse<{ linked: boolean }>(response)
}

export async function getInformaticsResults(
  accessToken: string,
  limit = 20
): Promise<InformaticsResult[]> {
  const response = await fetch(
    `${getAPIUrl()}informatics/results?limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsResult[]>(response)
}

export async function getInformaticsResultsByProblem(
  problemIds: number[],
  accessToken: string
): Promise<InformaticsResult[]> {
  const params = new URLSearchParams({ problem_ids: problemIds.join(',') })
  const response = await fetch(
    `${getAPIUrl()}informatics/results/by-problem?${params.toString()}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsResult[]>(response)
}

export interface InformaticsRequirement {
  course_uuid: string
  required: boolean
  connected: boolean
  script_seen: boolean
  server_linked: boolean
  ready: boolean
  reason: '' | 'connect'
  last_seen_at: string
  manage_url: string
}

export async function getInformaticsRequirement(
  courseUuid: string,
  accessToken: string
): Promise<InformaticsRequirement> {
  const params = new URLSearchParams({ course_uuid: courseUuid })
  const response = await fetch(
    `${getAPIUrl()}informatics/requirement?${params.toString()}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsRequirement>(response)
}

export interface InformaticsTaskResult {
  problem_id: number
  run_id: number
  ejudge_status: number
  solved: boolean
  tests: number
  score: number
  updated_at: string
}

export async function getInformaticsAssignmentResults(
  assignmentUuid: string,
  accessToken: string
): Promise<Record<string, InformaticsTaskResult>> {
  const response = await fetch(
    `${getAPIUrl()}informatics/results/assignment/${encodeURIComponent(assignmentUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<Record<string, InformaticsTaskResult>>(response)
}

// ── Server-side link and submissions ────────────────────────────────────────

export interface InformaticsLinkState {
  linked: boolean
  status: 'ACTIVE' | 'INVALID' | 'UNVERIFIED' | string
  informatics_user_id: number
  informatics_username: string
  email: string
  last_verified_at: string
  last_error: string
  auth_method: 'password' | 'session' | 'none' | string
  has_password: boolean
  has_session: boolean
}

export interface InformaticsLanguageInfo {
  id: number
  name: string
}

export interface InformaticsProblemInfo {
  problem_id: number
  title: string
  languages: InformaticsLanguageInfo[]
  supported_language_ids: number[]
  time_limit_ms: number
  memory_limit_kb: number
  fetched_at: string
}

export interface InformaticsAttempt {
  submission_uuid: string
  user_id: number
  problem_id: number
  status: 'QUEUED' | 'SUBMITTING' | 'RUNNING' | 'FINAL' | 'RETRY_WAIT' | 'FAILED' | 'CANCELED' | string
  verdict: string | null
  verdict_label: string | null
  ejudge_status: number | null
  run_id: number | null
  language_our_id: number
  language_informatics_id: number
  attempt_no: number
  tests_passed: number
  tests_total: number
  score: number
  max_score: number
  time_ms: number
  memory_kb: number
  compile_output: string
  stderr: string
  message: string
  last_error: string
  raw_verdict: Record<string, unknown> | null
  credited: boolean
  created_at: string
  updated_at: string
  finished_at: string
  events?: Array<{
    at: string
    phase: string
    level: string
    message: string
    http_status: number
    payload: Record<string, unknown> | null
  }>
}

export async function getInformaticsLink(accessToken: string): Promise<InformaticsLinkState> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsLinkState>(response)
}

export async function linkInformaticsAccount(
  body: { username: string; password: string; email?: string },
  accessToken: string
): Promise<InformaticsLinkState> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link`,
    RequestBodyWithAuthHeader('POST', body, null, accessToken)
  )
  return parse<InformaticsLinkState>(response)
}

export async function linkInformaticsSession(
  body: { moodle_session: string; email?: string },
  accessToken: string
): Promise<InformaticsLinkState> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link/session`,
    RequestBodyWithAuthHeader('POST', body, null, accessToken)
  )
  return parse<InformaticsLinkState>(response)
}

export async function verifyInformaticsLink(accessToken: string): Promise<InformaticsLinkState> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link/verify`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return parse<InformaticsLinkState>(response)
}

export async function unlinkInformaticsServer(
  accessToken: string
): Promise<InformaticsLinkState> {
  const response = await fetch(
    `${getAPIUrl()}informatics/link/server`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return parse<InformaticsLinkState>(response)
}

export async function getInformaticsProblem(
  problemId: number,
  accessToken: string,
  refresh = false
): Promise<InformaticsProblemInfo> {
  const params = new URLSearchParams()
  if (refresh) params.set('refresh', 'true')
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await fetch(
    `${getAPIUrl()}informatics/problems/${problemId}${suffix}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsProblemInfo>(response)
}

export async function createInformaticsSubmission(
  body: {
    problem_id: number
    language_id: number
    source_code: string
    assignment_task_uuid?: string
    assignment_uuid?: string
    activity_uuid?: string
    client_request_id?: string
  },
  accessToken: string
): Promise<InformaticsAttempt> {
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions`,
    RequestBodyWithAuthHeader('POST', body, null, accessToken)
  )
  return parse<InformaticsAttempt>(response)
}

export async function getInformaticsSubmission(
  submissionUuid: string,
  accessToken: string
): Promise<InformaticsAttempt> {
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions/${encodeURIComponent(submissionUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsAttempt>(response)
}

export async function listInformaticsSubmissions(
  params: { problem_id?: number; status?: string; limit?: number; cursor?: number },
  accessToken: string
): Promise<InformaticsAttempt[]> {
  const query = new URLSearchParams()
  if (params.problem_id) query.set('problem_id', String(params.problem_id))
  if (params.status) query.set('status', params.status)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', String(params.cursor))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions${suffix}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsAttempt[]>(response)
}

export async function listInformaticsTaskSubmissions(
  assignmentTaskUuid: string,
  accessToken: string
): Promise<InformaticsAttempt[]> {
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions/task/${encodeURIComponent(assignmentTaskUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsAttempt[]>(response)
}

export async function retryInformaticsSubmission(
  submissionUuid: string,
  accessToken: string
): Promise<InformaticsAttempt> {
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions/${encodeURIComponent(submissionUuid)}/retry`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return parse<InformaticsAttempt>(response)
}

export async function cancelInformaticsSubmission(
  submissionUuid: string,
  accessToken: string
): Promise<InformaticsAttempt> {
  const response = await fetch(
    `${getAPIUrl()}informatics/submissions/${encodeURIComponent(submissionUuid)}/cancel`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return parse<InformaticsAttempt>(response)
}

export interface InformaticsStatistics {
  user_id: number | null
  org_id: number | null
  period: 'week' | 'month' | 'all' | string
  course_uuid: string | null
  total_attempts: number
  solved_problems: number
  accepted_attempts: number
  final_attempts: number
  average_score: number | null
  last_activity: string
  by_verdict: Record<string, number>
  by_language: Record<string, number>
}

export async function getInformaticsStatistics(
  accessToken: string,
  params: {
    org_id?: number
    user_id?: number
    period?: 'week' | 'month' | 'all'
    course_uuid?: string | null
  } = {}
): Promise<InformaticsStatistics> {
  const query = new URLSearchParams()
  if (params.org_id) query.set('org_id', String(params.org_id))
  if (params.user_id) query.set('user_id', String(params.user_id))
  if (params.period) query.set('period', params.period)
  if (params.course_uuid) query.set('course_uuid', params.course_uuid)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const response = await fetch(
    `${getAPIUrl()}informatics/statistics${suffix}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return parse<InformaticsStatistics>(response)
}
