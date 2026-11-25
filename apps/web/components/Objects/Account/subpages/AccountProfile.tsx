'use client'

import React from 'react'
import UserProfileBuilder from '@components/Dashboard/Pages/UserAccount/UserProfile/UserProfileBuilder'
import AccountInformatics from './AccountInformatics'

function AccountProfile() {
  return (
    <div className="space-y-6">
      <AccountInformatics />
      <UserProfileBuilder />
    </div>
  )
}

export default AccountProfile
