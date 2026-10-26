import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export type ProblemTest = {
  id: string
  label: string
  stdin: string
  expected_stdout: string
  hidden: boolean
  weight: number
}

export type Problem = {
  id: number
  problem_uuid: string
  org_id: number
  title: string
  statement_md: string
  input_format: string
  output_format: string
  constraints: string
  difficulty: string | null
  topics: string[]
  languages: number[]
  tests: ProblemTest[]
  time_limit_ms: number | null
  memory_limit_kb: number | null
  source_name: string | null
  source_url: string | null
  source_id: string | null
  checksum: string
  is_edited: boolean
  archived: boolean
  creation_date: string
  update_date: string
}

export async function listProblems(
  orgId: number,
  access_token: string,
  params: { search?: string; difficulty?: string; topic?: string; page?: number; limit?: number; include_archived?: boolean } = {}
) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.difficulty) query.set('difficulty', params.difficulty)
  if (params.topic) query.set('topic', params.topic)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.include_archived) query.set('include_archived', 'true')

  const result: Response = await fetch(
    `${getAPIUrl()}problems/org/${orgId}?${query.toString()}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function getProblem(problemUuid: string, access_token: string) {
  const result: Response = await fetch(
    `${getAPIUrl()}problems/${problemUuid}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function createProblem(orgId: number, body: unknown, access_token: string) {
  const result: Response = await fetch(
    `${getAPIUrl()}problems/org/${orgId}`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function updateProblem(problemUuid: string, body: unknown, access_token: string) {
  const result: Response = await fetch(
    `${getAPIUrl()}problems/${problemUuid}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function deleteProblem(problemUuid: string, access_token: string) {
  const result: Response = await fetch(
    `${getAPIUrl()}problems/${problemUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function importProblems(
  orgId: number,
  file: File,
  access_token: string,
  dryRun = false
) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('dry_run', dryRun ? 'true' : 'false')

  const result: Response = await fetch(
    `${getAPIUrl()}problems/org/${orgId}/import`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  return await getResponseMetadata(result)
}

export async function importInformaticsProblem(
  orgId: number,
  problemId: number,
  access_token: string,
  dryRun = false
) {
  const result: Response = await fetch(
    `${getAPIUrl()}problems/org/${orgId}/import/informatics`,
    RequestBodyWithAuthHeader(
      'POST',
      { problem_id: problemId, dry_run: dryRun },
      null,
      access_token
    )
  )
  return await getResponseMetadata(result)
}

export async function addTaskFromProblem(
  assignmentUUID: string,
  problem_uuid: string,
  access_token: string
) {
  const result: Response = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/from-problem`,
    RequestBodyWithAuthHeader('POST', { problem_uuid }, null, access_token)
  )
  return await getResponseMetadata(result)
}
