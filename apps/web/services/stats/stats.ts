import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, getResponseMetadata } from '@services/utils/ts/requests'

export type StatsPeriod = 'week' | 'month' | 'all'

export interface ScoreBreakdown {
  score: number
  regularity: number
  defenses: number
  solved: number
  contests: number
  conversion: number
  active_weeks: number
  total_weeks: number
  solved_count: number
  defense_count: number
  contest_count: number
  components: Record<string, number>
}

export interface LeaderboardEntry {
  rank: number
  score: number
  defenses: number
  solved: number
  contests: number
  regularity: number
  user_id: number
  name: string
  username: string
}

export interface MyStats {
  period: StatsPeriod
  score: number
  breakdown: ScoreBreakdown
  rank: number | null
  participants: number
  top: LeaderboardEntry[]
  course?: {
    course_uuid: string
    course_name: string
    score: number
    rank: number | null
    participants: number
    breakdown: ScoreBreakdown
  } | null
}

export interface Leaderboard {
  period: StatsPeriod
  scope: 'organization' | 'course'
  course_uuid: string | null
  participants: number
  items: LeaderboardEntry[]
  me: LeaderboardEntry | null
}

export interface ContestEntry {
  id: number
  title: string
  happened_on: string
}

export interface GlobalCourseStat {
  course_uuid: string
  name: string
  sequence_order: number
  weight: number
  status: 'locked' | 'available' | 'in_progress' | 'completed' | string
  course_kpi: number
  course_percent: number
  contribution: number
  included: boolean
  last_activity_at: string
  activities_completed: number
  activities_total: number
  informatics_solved: number
  informatics_attempts: number
}

export interface GlobalStats {
  program_id: number
  program_name: string
  period: StatsPeriod | string
  global_kpi: number
  weighted_kpi_sum: number
  weight_sum: number
  coverage: number
  active_days: number
  courses_included: number
  courses_started: number
  courses_completed: number
  courses_locked: number
  computed_at: string
  courses: GlobalCourseStat[]
}

export function getGlobalStats(
  orgId: number,
  token: string,
  programId?: number | null,
  period?: StatsPeriod,
): Promise<GlobalStats> {
  const query = new URLSearchParams({ org_id: String(orgId) })
  if (programId) query.set('program_id', String(programId))
  if (period) query.set('period', period)
  return getJson(`${getAPIUrl()}stats/global?${query.toString()}`, token)
}

export interface CourseStatComponents {
  activities_completed: number
  activities_total: number
  assignments_graded: number
  assignments_total: number
  tasks_solved: number
  tasks_total: number
  grade_percent: number
  defense_count: number
  informatics_attempts: number
  informatics_solved: number
  informatics_accepted: number
  informatics_avg_score: number | null
  active_weeks: number
  total_weeks: number
  active_days: number
}

export interface CourseStatDetail {
  course_uuid: string
  name: string
  program_id: number
  period: StatsPeriod | string
  status: string
  weight: number
  course_kpi: number
  course_percent: number
  is_informatics: boolean
  formula: Record<string, number>
  components: CourseStatComponents
  last_activity_at: string
  computed_at: string
}

export interface CourseStudentRow {
  user_id: number
  name: string
  username: string
  course_kpi: number
  course_percent: number
  status: string
  active_days: number
  last_activity_at: string
}

export function getCourseStats(
  orgId: number,
  courseUuid: string,
  token: string,
  programId?: number | null,
  period?: StatsPeriod,
): Promise<CourseStatDetail> {
  const query = new URLSearchParams({ org_id: String(orgId) })
  if (programId) query.set('program_id', String(programId))
  if (period) query.set('period', period)
  return getJson(
    `${getAPIUrl()}stats/courses/${encodeURIComponent(courseUuid)}?${query.toString()}`,
    token,
  )
}

export function getCourseStudents(
  orgId: number,
  courseUuid: string,
  token: string,
  programId?: number | null,
): Promise<CourseStudentRow[]> {
  const query = new URLSearchParams({ org_id: String(orgId) })
  if (programId) query.set('program_id', String(programId))
  return getJson(
    `${getAPIUrl()}stats/courses/${encodeURIComponent(courseUuid)}/students?${query.toString()}`,
    token,
  )
}

async function getJson(url: string, token?: string) {
  const res = await fetch(url, RequestBodyWithAuthHeader('GET', null, null, token))
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

export function getMyStats(
  orgId: number,
  token: string,
  period: StatsPeriod,
  courseUuid?: string | null,
): Promise<MyStats> {
  const query = new URLSearchParams({ org_id: String(orgId), period })
  if (courseUuid) query.set('course_uuid', courseUuid)
  return getJson(`${getAPIUrl()}stats/me?${query.toString()}`, token)
}

export function getLeaderboard(
  orgId: number,
  token: string,
  period: StatsPeriod,
  courseUuid?: string | null,
  limit = 10,
): Promise<Leaderboard> {
  const query = new URLSearchParams({
    org_id: String(orgId),
    period,
    limit: String(limit),
  })
  if (courseUuid) query.set('course_uuid', courseUuid)
  return getJson(`${getAPIUrl()}stats/leaderboard?${query.toString()}`, token)
}

export function listMyContests(
  orgId: number,
  token: string,
  period: StatsPeriod,
): Promise<{ items: ContestEntry[] }> {
  return getJson(`${getAPIUrl()}stats/contests?org_id=${orgId}&period=${period}`, token)
}

export async function addContest(
  orgId: number,
  token: string,
  body: { title?: string; happened_on?: string },
) {
  const res = await fetch(
    `${getAPIUrl()}stats/contests`,
    RequestBodyWithAuthHeader('POST', { org_id: orgId, ...body }, null, token),
  )
  const data = await getResponseMetadata(res)
  return data as unknown as { id: number; happened_on: string; title: string }
}

export async function deleteContest(orgId: number, token: string, contestId: number) {
  const res = await fetch(
    `${getAPIUrl()}stats/contests/${contestId}?org_id=${orgId}`,
    RequestBodyWithAuthHeader('DELETE', null, null, token),
  )
  const data = await getResponseMetadata(res)
  return data as unknown as { ok: boolean }
}

export async function addDefense(
  orgId: number,
  token: string,
  body: { user_id: number; course_uuid?: string | null; note?: string },
) {
  const res = await fetch(
    `${getAPIUrl()}stats/defenses`,
    RequestBodyWithAuthHeader('POST', { org_id: orgId, ...body }, null, token),
  )
  const data = await getResponseMetadata(res)
  return data as unknown as { id: number }
}
