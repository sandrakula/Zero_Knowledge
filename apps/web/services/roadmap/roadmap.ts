import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export type RoadmapImportPayload = {
  org_id: number
  plan: unknown
  course_uuid?: string
  generate_missing: boolean
  publish: boolean
}

export async function importRoadmap(
  payload: RoadmapImportPayload,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/import`,
    RequestBodyWithAuthHeader('POST', payload, null, access_token)
  )
  return await errorHandling(result)
}

export async function getRoadmapJob(job_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/jobs/${job_uuid}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return await errorHandling(result)
}

export async function retryRoadmapJob(job_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/jobs/${job_uuid}/retry`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return await errorHandling(result)
}

export async function askRoadmapAssistant(
  course_uuid: string,
  body: {
    message: string
    activity_uuid?: string
    assignment_task_uuid?: string
  },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/${course_uuid}/assistant`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  return await errorHandling(result)
}

export async function applyRoadmapOperations(
  course_uuid: string,
  operations: unknown[],
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/${course_uuid}/operations`,
    RequestBodyWithAuthHeader('POST', { operations }, null, access_token)
  )
  return await errorHandling(result)
}

export async function getMyLessonFeedback(
  activity_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/activities/${activity_uuid}/feedback`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return await errorHandling(result)
}

export async function saveLessonFeedback(
  activity_uuid: string,
  data: { content: string; rating?: number | null },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/activities/${activity_uuid}/feedback`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  return await errorHandling(result)
}

export async function getCourseFeedback(
  course_uuid: string,
  access_token: string,
  status?: 'OPEN' | 'RESOLVED'
) {
  const query = status ? `?status=${status}` : ''
  const result = await fetch(
    `${getAPIUrl()}roadmap/courses/${course_uuid}/feedback${query}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return await errorHandling(result)
}

export async function updateLessonFeedback(
  feedback_uuid: string,
  data: { content?: string; rating?: number | null; status?: 'OPEN' | 'RESOLVED' },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/feedback/${feedback_uuid}`,
    RequestBodyWithAuthHeader('PATCH', data, null, access_token)
  )
  return await errorHandling(result)
}

export async function deleteLessonFeedback(
  feedback_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}roadmap/feedback/${feedback_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return await errorHandling(result)
}
