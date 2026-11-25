import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import NotificationsClient from './notifications'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: `Notifications | ${org?.name || 'Organization'}`,
    robots: { index: false, follow: false },
  }
}

export default function NotificationsPage() {
  return <NotificationsClient />
}
