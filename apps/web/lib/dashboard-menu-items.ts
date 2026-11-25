import {
  House,
  BookOpen,
  Files,
  Users,
  CurrencyCircleDollar,
  Buildings,
  ChatsCircle,
  ChalkboardSimple,
  Cube,
  FolderSimple,
  Headphones,
  VideoCamera,
  ChartBar,
  Code,
  Steps,
} from '@phosphor-icons/react'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'

export interface DashboardMenuItem {
  id: string
  href: string
  icon: typeof House
  labelKey: string
  /** Feature key used for plan-based gating. If undefined, item is always shown. */
  featureKey?: string
  /** If true, the feature defaults to disabled (must be explicitly enabled). */
  defaultDisabled?: boolean
  /** Hides the item when it returns false (e.g. Enterprise-only pages). */
  available?: () => boolean
}

export const DASHBOARD_MENU_ITEMS: DashboardMenuItem[] = [
  {
    id: 'home',
    href: '/cabinet',
    icon: House,
    labelKey: 'common.home',
  },
  {
    id: 'courses',
    href: '/cabinet/courses',
    icon: BookOpen,
    labelKey: 'courses.courses',
  },
  {
    id: 'assignments',
    href: '/cabinet/assignments',
    icon: Files,
    labelKey: 'common.assignments',
  },
  {
    id: 'paths',
    href: '/cabinet/paths',
    icon: Steps,
    labelKey: 'paths.title',
    featureKey: 'paths',
  },
  {
    id: 'library',
    href: '/cabinet/library',
    icon: FolderSimple,
    labelKey: 'library.library',
    featureKey: 'folders',
  },
  {
    id: 'communities',
    href: '/cabinet/communities',
    icon: ChatsCircle,
    labelKey: 'communities.title',
    featureKey: 'communities',
  },
  {
    id: 'podcasts',
    href: '/cabinet/podcasts',
    icon: Headphones,
    labelKey: 'podcasts.podcasts',
    featureKey: 'podcasts',
  },
  {
    id: 'live_sessions',
    href: '/cabinet/live-sessions',
    icon: VideoCamera,
    labelKey: 'live_sessions.title',
    featureKey: 'live_sessions',
  },
  {
    id: 'boards',
    href: '/cabinet/boards',
    icon: ChalkboardSimple,
    labelKey: 'common.boards',
    featureKey: 'boards',
    defaultDisabled: true,
  },
  {
    id: 'playgrounds',
    href: '/cabinet/playgrounds',
    icon: Cube,
    labelKey: 'common.playgrounds',
    featureKey: 'playgrounds',
    defaultDisabled: true,
  },
  {
    id: 'users',
    href: '/cabinet/users/settings/users',
    icon: Users,
    labelKey: 'common.users',
  },
  {
    id: 'payments',
    href: '/cabinet/payments/overview',
    icon: CurrencyCircleDollar,
    labelKey: 'common.payments',
    featureKey: 'payments',
  },
  {
    id: 'organization',
    href: '/cabinet/org/settings/general',
    icon: Buildings,
    labelKey: 'common.organization',
  },
  {
    id: 'analytics',
    href: '/cabinet/analytics',
    icon: ChartBar,
    labelKey: 'common.analytics',
    available: isOrgAnalyticsAvailable,
  },
  {
    id: 'developers',
    href: '/cabinet/developers/api',
    icon: Code,
    labelKey: 'dashboard.developers.breadcrumb',
  },
]
