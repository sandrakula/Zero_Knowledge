'use client'

import React, { useState } from 'react'
import CopilotBubble from '@components/Copilot/CopilotBubble'

/** Floating Tutor available on every page inside an organization. */
export default function TutorLauncher({ orgslug }: { orgslug: string }) {
  const [open, setOpen] = useState(false)
  return (
    <CopilotBubble
      orgslug={orgslug}
      open={open}
      onOpenChange={setOpen}
      sessionToLoad={null}
    />
  )
}
