import { ChartLineUp } from '@phosphor-icons/react'
import type { SitePageMeta } from '@/lib/site-search/types'

export const sitePage: SitePageMeta = {
  id: 'site.stats',
  titleKey: 'stats.title',
  descriptionKey: 'search.palette.entries.stats.description',
  keywordsKey: 'search.palette.entries.stats.keywords',
  icon: ChartLineUp,
  href: '/stats',
  menuType: 'stats',
  shortcut: 'g t',
  requiresAuth: true,
}
