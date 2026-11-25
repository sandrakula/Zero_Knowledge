import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function getCourseCurriculum(
  course_uuid: string,
  access_token?: string | null
) {
  const result = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/curriculum`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  return await errorHandling(result)
}

export async function updateCourseCurriculum(
  course_uuid: string,
  payload: {
    topics: Array<{
      chapter_uuid: string
      topic_key?: string
      section?: string
      module?: string
      level?: number
      prerequisites?: string[]
      credit?: Record<string, number>
      estimated_minutes?: number
      order?: number | null
    }>
    tasks: Array<{
      task_uuid: string
      topic_key?: string
      level?: number
      estimated_minutes?: number
    }>
  },
  access_token?: string | null
) {
  const result = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/curriculum`,
    RequestBodyWithAuthHeader('PUT', payload, null, access_token || undefined)
  )
  return await errorHandling(result)
}
