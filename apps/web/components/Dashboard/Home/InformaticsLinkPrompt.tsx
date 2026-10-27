'use client'

import Link from 'next/link'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'

// Prompts a learner who has not yet linked their Informatics account. Rendered
// on the learner dashboard; disappears once the account is linked.
export default function InformaticsLinkPrompt() {
  const session = useLHSession() as { data?: { tokens?: { access_token?: string } } }
  const token = session?.data?.tokens?.access_token

  const { data } = useQuery({
    queryKey: ['informatics', 'link-status'],
    queryFn: async () => {
      const res = await fetch(`${getAPIUrl()}informatics/link`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return { linked: false }
      return res.json()
    },
    enabled: !!token,
  })

  if (!data || data.linked) return null

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <Link2 size={16} className="shrink-0" />
        <span>Привяжите аккаунт Informatics — без него нельзя отправлять решения задач на проверку.</span>
      </div>
      <Link
        href="/account/connections"
        className="shrink-0 self-start sm:self-auto px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 rounded-md hover:bg-amber-700"
      >
        Привязать
      </Link>
    </div>
  )
}
