import type { SearchMeta } from './types'

import { searchMeta as home } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/page.search'
import { searchMeta as courses } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/courses/page.search'
import { searchMeta as coursesMigrate } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/courses/migrate/page.search'
import { searchMeta as assignments } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/assignments/page.search'
import { searchMeta as communities } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/communities/page.search'
import { searchMeta as paths } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/paths/page.search'
import { searchMeta as podcasts } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/podcasts/page.search'
import { searchMeta as liveSessions } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/live-sessions/page.search'
import { searchMeta as boards } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/boards/page.search'
import { searchMeta as playgrounds } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/playgrounds/page.search'
import { searchMeta as analytics } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/analytics/page.search'
import { searchMetas as users } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/users/page.search'
import { searchMetas as org } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/org/page.search'
import { searchMetas as payments } from '@/app/orgs/[orgslug]/(withmenu)/cabinet/payments/page.search'
import { searchMetas as account } from '@/app/orgs/[orgslug]/(withmenu)/account/page.search'

export const dashboardPages: SearchMeta[] = [
  home,
  courses,
  coursesMigrate,
  assignments,
  communities,
  paths,
  podcasts,
  liveSessions,
  boards,
  playgrounds,
  analytics,
  ...users,
  ...org,
  ...payments,
  ...account,
]
