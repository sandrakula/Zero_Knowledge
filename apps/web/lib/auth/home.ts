/**
 * Where each kind of account calls "home".
 *
 * The cabinet is home for everyone: learners get the learning view,
 * instructors the teaching view, admins the same teaching view plus the
 * org-management widgets and entries. These paths are used after sign-in and
 * by the logo/home links.
 */

export const CABINET_HOME = '/cabinet'

const ADMIN_ROLE_UUID = 'role_global_admin'
const STAFF_ROLE_UUIDS = ['role_global_admin', 'role_global_instructor']

/** Role UUIDs from a `/users/session` payload (`{ roles: [...] }`). */
export function roleUuidsFromSession(session: any): string[] {
  const roles: any[] = Array.isArray(session?.roles) ? session.roles : []
  return roles
    .map((entry) => entry?.role?.role_uuid ?? entry?.role_uuid ?? entry?.role?.id)
    .filter(Boolean)
}

export function isAdminSession(session: any): boolean {
  return roleUuidsFromSession(session).includes(ADMIN_ROLE_UUID)
}

/** Instructor or admin: someone who works with content, not just learns. */
export function isStaffSession(session: any): boolean {
  const uuids = roleUuidsFromSession(session)
  return STAFF_ROLE_UUIDS.some((uuid) => uuids.includes(uuid))
}

export function homePathForSession(_session: any): string {
  return CABINET_HOME
}

/**
 * Logo / "home" link inside an organization. The cabinet is home for every
 * role; admins preview content from the dedicated management pages.
 */
export function orgHomePathForSession(_session: any): string {
  return CABINET_HOME
}
