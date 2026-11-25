'use client';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import { useOnboarding } from '@components/Hooks/useOnboarding';
import DemoBanner from '@components/Objects/Demo/DemoBanner';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { UpgradeModalProvider } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { AtlasMiniProvider } from '@ee/components/Atlas/AtlasMiniContext'
import React from 'react'
import dynamic from 'next/dynamic'

const WelcomeModal = dynamic(() => import('@components/Dashboard/Onboarding/WelcomeModal'), { ssr: false })

// Most admins have already seen the welcome modal; don't load its globe and
// animation code for them.
function WelcomeModalGate() {
    const { welcomeSeen, dismissed } = useOnboarding()
    if (welcomeSeen || dismissed) return null
    return <WelcomeModal />
}

/**
 * The shell around the cabinet's management pages (courses, assignments,
 * users, settings, …). The dashboard sidebar is gone: navigation lives in the
 * cabinet home and in the top bar, so this shell only keeps the providers,
 * the permission gate and the onboarding / command-palette extras.
 */
function CabinetAdminShell({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    <UpgradeModalProvider>
                        <AtlasMiniProvider>
                            {/* Built-in page translation (Chrome/Edge/Firefox) swaps text
                                nodes out from under React. On the editor, where nodes are
                                constantly inserted and moved, that desyncs the two trees
                                and the next render dies on "insertBefore ... not a child of
                                this node", taking the whole page with it. The cabinet is
                                already translated by i18n, so opting it out costs nothing.
                                Public course pages stay translatable. */}
                            <div translate="no" className="notranslate">
                                {/* Renders nothing outside the demo organization. */}
                                <DemoBanner />
                                {children}
                                <OnboardingTracker />
                            </div>
                            <WelcomeModalGate />
                            <CommandPalette />
                        </AtlasMiniProvider>
                    </UpgradeModalProvider>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default CabinetAdminShell
