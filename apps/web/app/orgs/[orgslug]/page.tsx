import { redirect } from 'next/navigation'

/**
 * The org root used to fall through to the tenant rewrite and render a 404.
 * Send it through the same role-aware entry point as login: admins land in the
 * dashboard, learners in the course catalog.
 */
export default function OrgRootPage() {
  redirect('/after-login')
}
