import React from 'react'
import CabinetAdminShell from './CabinetAdminShell'

export default function CabinetLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return <CabinetAdminShell>{children}</CabinetAdminShell>
}
