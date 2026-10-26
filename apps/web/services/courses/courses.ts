import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(
  org_slug: string,
  next: any,
  access_token?: any,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}courses/org_slug/${org_slug}/page/1/limit/100${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function searchOrgCourses(
  org_slug: string,
  query: string,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_slug}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseMetadata(
  course_uuid: string,
  next: any,
  access_token: string | null | undefined,
  options?: { slim?: boolean; withUnpublishedActivities?: boolean }
) {
  const searchParams = new URLSearchParams()
  if (options?.slim) searchParams.set('slim', 'true')
  if (options?.withUnpublishedActivities !== undefined) {
    searchParams.set('with_unpublished_activities', String(options.withUnpublishedActivities))
  }
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const result = await fetch(
    `${getAPIUrl()}courses/course_${course_uuid}/meta${qs}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourse(course_uuid: any, data: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourse(course_uuid: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseById(course_id: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/id/${course_id}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseThumbnail(course_uuid: any, formData: FormData, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createNewCourse(
  org_id: string,
  course_body: any,
  thumbnail: any,
  access_token: any
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('name', course_body.name || '')
  formData.append('description', course_body.description || '')
  formData.append('public', course_body.visibility)
  formData.append('learnings', course_body.learnings || '')
  formData.append('tags', course_body.tags || '')
  formData.append('about', course_body.description || '')

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}courses/?org_id=${org_id}`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseFromBackend(course_uuid: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function cloneCourse(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/clone`,
    RequestBodyWithAuthHeader('POST', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getCourseContributors(course_uuid: string, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors`,
    RequestBodyWithAuthHeader('GET', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function editContributor(course_uuid: string, contributor_id: string, authorship: any, authorship_status: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors/${contributor_id}?authorship=${authorship}&authorship_status=${authorship_status}`,
    RequestBodyWithAuthHeader('PUT', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function applyForContributor(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/apply-contributor`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkAddContributors(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-add-contributors`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkRemoveContributors(course_uuid: string, data: any, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-remove-contributors`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseRights(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export type CourseProgressAssignment = {
  assignment_uuid: string
  title: string
  activity_uuid?: string | null
  required: boolean
  published: boolean
  due_date?: string | null
  max_grade: number
  submission_status: string
  grade: number
  attempt_number: number
  is_late: boolean
}

export type CourseProgressStudent = {
  user_id: number
  username: string
  email: string
  first_name: string
  last_name: string
  enrollment_status?: string | null
  completed_assignments: number
  submitted_assignments: number
  required_assignments: number
  percent: number
  assignments: CourseProgressAssignment[]
}

export type CourseProgressSummary = {
  course_uuid: string
  course_name: string
  total_students: number
  page: number
  limit: number
  assignments: CourseProgressAssignment[]
  students: CourseProgressStudent[]
}

export async function getCourseProgressSummary(
  course_uuid: string,
  access_token: string | null | undefined,
  page = 1,
  limit = 50
) {
  const result: Response = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/progress?page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export type StruggleFailedTest = {
  id: string
  label: string
  failures: number
}

export type StruggleTask = {
  assignment_uuid: string
  assignment_title: string
  assignment_task_uuid: string
  task_title: string
  attempts: number
  accepted: number
  wrong_answer: number
  compilation_error: number
  runtime_error: number
  time_limit: number
  memory_limit: number
  other_errors: number
  students_attempted: number
  students_stuck: number
  accepted_rate: number
  top_failed_tests: StruggleFailedTest[]
}

export type StruggleMap = {
  course_uuid: string
  course_name: string
  tasks: StruggleTask[]
}

export async function getCourseStruggleMap(
  course_uuid: string,
  access_token: string | null | undefined
) {
  const result: Response = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/struggle`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}