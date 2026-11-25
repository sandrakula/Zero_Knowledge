'use client'

import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { isOrgFeatureEnabled } from '@/lib/org/features'

/**
 * Renders its children only while the org's messaging feature is on. The chat
 * UI (dock, inbox buttons) stays in the code; switching the feature back on in
 * the org settings brings it all back without any code changes.
 */
export default function MessagingFeatureGate({ children }: { children: React.ReactNode }) {
  const org = useOrg() as any
  if (!isOrgFeatureEnabled(org, 'messaging')) return null
  return <>{children}</>
}
