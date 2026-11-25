import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useShowLearnHouseBranding } from '@components/Hooks/useLearnHouseBranding'
import { useMessaging } from '@components/Messaging/MessagingProvider'

function Watermark() {
    const { t } = useTranslation()

    const showWatermark = useShowLearnHouseBranding()
    // The chat dock owns the bottom-right corner when it's on screen.
    const { enabled: messaging, token } = useMessaging()
    const besideDock = messaging && Boolean(token)
    if (!showWatermark) return null

    return (
        <div className={`fixed bottom-8 end-8 z-50 ${besideDock ? 'md:end-auto md:start-8' : ''}`}>
            <Link href="/" className="flex items-center cursor-pointer bg-white/80 backdrop-blur-lg text-gray-700 rounded-2xl p-2 light-shadow text-xs px-5 font-semibold space-x-2">
                <p>{t('common.made_with')}</p>
                <span className="text-sm font-black lowercase tracking-[-0.04em]">
                    zerok<span className="text-[#6366f1]">.</span>
                </span>
            </Link>
        </div>
    )
}

export default Watermark