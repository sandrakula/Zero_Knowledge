'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAPIUrl } from '@services/config/config'

/**
 * Post-login router: admins land in the dashboard, learners in the course
 * catalog. The previous hard-coded /dash destination showed learners the
 * "admin_only" denial page.
 */
export default function AfterLoginPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function route() {
      try {
        const response = await fetch(`${getAPIUrl()}users/session`, {
          credentials: 'include',
        })
        if (!response.ok) {
          if (!cancelled) router.replace('/login')
          return
        }
        const data = await response.json()
        const roles: any[] = data?.roles || []
        const isAdmin =
          data?.user?.is_superadmin === true ||
          roles.some((role) => role?.role?.rights?.dashboard?.action_access === true)
        if (!cancelled) router.replace(isAdmin ? '/dash' : '/courses')
      } catch {
        if (!cancelled) router.replace('/courses')
      }
    }

    route()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f8f8]">
      <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-gray-800 animate-spin" />
    </div>
  )
}
