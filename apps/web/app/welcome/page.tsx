import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { homePathForSession } from '@/lib/auth/home'
import WelcomeClient from './welcome'

export const metadata: Metadata = {
  title: { absolute: 'zerok — платформа для обучения и преподавания' },
  robots: { index: false, follow: false },
}

type PageProps = {
  searchParams: Promise<{ next?: string }>
}

export default async function WelcomePage({ searchParams }: PageProps) {
  // A visitor that is already signed in has no business on the welcome
  // screen; send them straight to their home (dashboard or cabinet).
  const session = await getServerSession()
  if (session && !session.unresolved) {
    redirect(homePathForSession({ roles: session.roles }))
  }

  const { next } = await searchParams
  return <WelcomeClient next={next} />
}
