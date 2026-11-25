import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export type TaskBankFilters = {
  orgId: number
  courseUuid?: string
  level?: number
  assignmentType?: string
  topicKey?: string
  query?: string
  onlyUnleveled?: boolean
  page?: number
  limit?: number
}

export async function getTaskBank(filters: TaskBankFilters, access_token?: string | null) {
  const params = new URLSearchParams({ org_id: String(filters.orgId) })
  if (filters.courseUuid) params.set('course_uuid', filters.courseUuid)
  if (filters.level) params.set('level', String(filters.level))
  if (filters.assignmentType) params.set('assignment_type', filters.assignmentType)
  if (filters.topicKey) params.set('topic_key', filters.topicKey)
  if (filters.query) params.set('q', filters.query)
  if (filters.onlyUnleveled) params.set('only_unleveled', 'true')
  params.set('page', String(filters.page || 1))
  params.set('limit', String(filters.limit || 50))

  const result = await fetch(
    `${getAPIUrl()}practice/bank?${params.toString()}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  return await errorHandling(result)
}

export async function updateTaskBank(
  orgId: number,
  tasks: Array<{
    task_uuid: string
    level?: number
    topic_key?: string
    estimated_minutes?: number
  }>,
  access_token?: string | null
) {
  const result = await fetch(
    `${getAPIUrl()}practice/bank/tasks?org_id=${orgId}`,
    RequestBodyWithAuthHeader('PUT', { tasks }, null, access_token || undefined)
  )
  return await errorHandling(result)
}
