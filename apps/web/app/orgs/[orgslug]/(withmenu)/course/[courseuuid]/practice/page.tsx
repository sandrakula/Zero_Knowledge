import PracticeClient from './practice'

type PageParams = Promise<{ orgslug: string; courseuuid: string }>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}) {
  const { courseuuid } = await params
  return {
    title: `Практика · ${courseuuid.replace('course_', '')}`,
    robots: { index: false, follow: false },
  }
}

export default async function PracticePage({ params }: { params: PageParams }) {
  const { orgslug, courseuuid } = await params
  return <PracticeClient orgslug={orgslug} courseuuid={courseuuid} />
}
