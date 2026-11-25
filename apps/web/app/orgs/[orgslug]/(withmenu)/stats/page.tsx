import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import StatsClient from './stats'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: `Statistics | ${org?.name || 'Organization'}`,
    robots: { index: false, follow: false },
  }
}

export default async function StatsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  return <StatsClient orgslug={orgslug} />
}
