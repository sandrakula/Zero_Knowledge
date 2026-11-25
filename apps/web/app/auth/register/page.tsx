import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import { safeInternalPath } from '@services/security/url'
import RegisterClient from './register'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Create account | zerok' },
  robots: { index: false, follow: false },
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const safeNext = next ? safeInternalPath(next, '') : ''
  const orgslug = await getAuthOrgSlug()
  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, {
        revalidate: 60,
        tags: ['organizations'],
      })
    } catch {
      org = null
    }
  }
  return <RegisterClient org={org} next={safeNext || undefined} />
}
