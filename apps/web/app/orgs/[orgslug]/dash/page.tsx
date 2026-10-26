'use client'
import DashboardHome from '@components/Dashboard/Home/DashboardHome'
import StudentDashboard from '@components/Dashboard/Home/StudentDashboard'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { canManageOrgFromSession } from '@components/Hooks/useAdminStatus'

export default function DashboardPage() {
  const session = useLHSession() as any
  const org = useOrg() as any
  const canManage = canManageOrgFromSession(session, org?.id)

  if (canManage) return <DashboardHome />
  return <StudentDashboard />
}
