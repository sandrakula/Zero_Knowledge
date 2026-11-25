import { Bell } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.notifications',
  titleKey: 'notifications.title',
  descriptionKey: 'search.palette.entries.notifications.description',
  keywordsKey: 'search.palette.entries.notifications.keywords',
  icon: Bell,
  href: '/notifications',
  requiresAuth: true,
}
