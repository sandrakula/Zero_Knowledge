'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { User, Lock, Plug, Settings, Palette, Sparkles } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'
import { BADGE_COLORS, COVER_PRESETS, usePersonalization } from '@/lib/theme'

interface AccountSidebarProps {
  orgslug: string
  currentSubpage: string
}

const NAV_ITEMS = [
  { id: 'general', icon: Settings, labelKey: 'account.general' },
  { id: 'appearance', icon: Palette, labelKey: 'account.appearance' },
  { id: 'profile', icon: User, labelKey: 'account.profile' },
  { id: 'security', icon: Lock, labelKey: 'account.security' },
  { id: 'ai-apps', icon: Plug, labelKey: 'account.ai_apps' },
]

export function AccountSidebar({ orgslug, currentSubpage }: AccountSidebarProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const user = session?.data?.user
  const { mounted, personalization } = usePersonalization()

  const cover =
    mounted && personalization.coverPreset !== 'none'
      ? COVER_PRESETS.find((c) => c.id === personalization.coverPreset)
      : null
  const badgeStyle =
    BADGE_COLORS.find((b) => b.id === personalization.badgeColor) || BADGE_COLORS[0]

  return (
    <div className="space-y-4">
      {/* User Info Card */}
      <div className="bg-white nice-shadow rounded-2xl overflow-hidden">
        {/* Optional Personalized Cover Banner */}
        {cover && cover.background && (
          <div
            className="h-20 w-full relative"
            style={{ background: cover.background }}
          />
        )}

        {/* User Profile Header */}
        <div className={`p-4 border-b border-gray-100 ${cover && cover.background ? '-mt-11 relative' : ''}`}>
          <div className="flex flex-col items-center text-center">
            <UserAvatar
              border="border-4"
              rounded="rounded-full"
              width={80}
              showStatusEmoji
            />
            <div className="mt-3">
              <h2 className="font-semibold text-gray-900">
                {user?.first_name} {user?.last_name}
              </h2>
              <p className="text-sm text-gray-500">@{user?.username}</p>
            </div>

            {/* Custom Badge */}
            {mounted && personalization.customBadge && (
              <div className="mt-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
                  style={{
                    backgroundColor: badgeStyle.bg,
                    color: badgeStyle.text,
                    borderColor: badgeStyle.border,
                  }}
                >
                  <Sparkles size={11} />
                  {personalization.customBadge}
                </span>
              </div>
            )}

            {/* Status Pill */}
            {mounted && (personalization.statusEmoji || personalization.statusText) && (
              <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-gray-600">
                {personalization.statusEmoji && <span>{personalization.statusEmoji}</span>}
                {personalization.statusText && (
                  <span className="truncate font-medium">{personalization.statusText}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* User Bio (truncated) */}
        {user?.bio && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
              {user.bio}
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="p-2">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = currentSubpage === item.id
              return (
                <Link
                  key={item.id}
                  href={getUriWithOrg(orgslug, `/account/${item.id}`)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-white' : 'text-gray-500'} />
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}

export default AccountSidebar
