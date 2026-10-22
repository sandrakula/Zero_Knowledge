'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, Books, ClipboardText, SignOut } from '@phosphor-icons/react'
import { signOut } from '@components/Contexts/AuthContext'

const ITEMS = [
  { href: '/dash', label: 'Главная', icon: House },
  { href: '/dash/courses', label: 'Курсы', icon: Books, prefix: '/dash/courses' },
  { href: '/dash/assignments', label: 'Задания', icon: ClipboardText, prefix: '/dash/assignments' },
]

export default function MinimalAdminNav() {
  const pathname = usePathname() || ''

  const isActive = (href: string, prefix?: string) =>
    href === '/dash' ? pathname === '/dash' : pathname.startsWith(prefix || href)

  return (
    <>
      <aside className="hidden lg:flex flex-col w-[230px] shrink-0 h-screen sticky top-0 bg-[#0f1014] text-white">
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <span className="text-base font-black tracking-tight">ZeroKnowledge</span>
        </div>
        <nav className="p-3 space-y-1">
          {ITEMS.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href, item.prefix)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Icon size={19} weight="fill" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto p-3 border-t border-white/10">
          <button
            type="button"
            onClick={() => void signOut({ redirect: true, callbackUrl: '/login' })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SignOut size={19} weight="bold" />
            Выйти
          </button>
        </div>
      </aside>

      <nav className="lg:hidden sticky top-0 z-40 bg-[#0f1014] text-white">
        <div className="flex items-center gap-1 overflow-x-auto px-2 py-2">
          {ITEMS.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href, item.prefix)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                  active ? 'bg-white/10 text-white' : 'text-white/60'
                }`}
              >
                <Icon size={16} weight="fill" />
                {item.label}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => void signOut({ redirect: true, callbackUrl: '/login' })}
            className="ms-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white/60 hover:text-white whitespace-nowrap"
          >
            <SignOut size={16} weight="bold" />
            Выйти
          </button>
        </div>
      </nav>
    </>
  )
}
