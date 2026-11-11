import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, getResponseMetadata } from '@services/utils/ts/requests'

export type TaskExplanation = {
  explanation_uuid: string
  explanation_text: string
  input_mode: string
  source_code: string
  language_id: number | null
  ai_score: number | null
  ai_level: string | null
  ai_feedback: string | null
  ai_strengths: string[]
  ai_gaps: string[]
  ai_model: string | null
  status: string
  attempt_count: number
  created_at: string
  updated_at: string
}

export async function getMyTaskExplanation(
  assignmentUUID: string,
  assignmentTaskUUID: string,
  access_token: string
) {
  const result: Response = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/explanation/me`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function getTaskExplanationForUser(
  assignmentUUID: string,
  assignmentTaskUUID: string,
  userId: string | number,
  access_token: string
) {
  const result: Response = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/explanation?user_id=${userId}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function submitTaskExplanation(
  assignmentUUID: string,
  assignmentTaskUUID: string,
  body: { explanation: string; input_mode: 'text' | 'voice'; source_code: string; language_id?: number | null },
  access_token: string
) {
  const result: Response = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/explanation`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  return getResponseMetadata(result)
}
