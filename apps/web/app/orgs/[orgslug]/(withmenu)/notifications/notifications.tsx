'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from '@phosphor-icons/react'

import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

/**
 * In-app notifications.
 *
 * The feed itself is the next step: deadlines, graded work and course updates
 * will be aggregated here. For now this is the destination the header button
 * points at, so the entry is not a dead link.
 */
export default function NotificationsClient() {
  const { t } = useTranslation()

  return (
    <GeneralWrapperStyled>
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
          <Bell size={30} weight="fill" aria-hidden />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-black">
          {t('notifications.title', { defaultValue: 'Notifications' })}
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-black/45">
          {t('notifications.empty', {
            defaultValue:
              'Nothing here yet. Deadlines, graded work and course updates will appear here.',
          })}
        </p>
      </div>
    </GeneralWrapperStyled>
  )
}
