import type { Direction } from './direction'

export interface Language {
  code: string
  translationKey: string
  nativeName: string
  /** Text direction of the language. Behaviour lives in lib/direction.ts. */
  dir: Direction
}

export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'ru', translationKey: 'common.russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'en', translationKey: 'common.english', nativeName: 'English', dir: 'ltr' },
  { code: 'es', translationKey: 'common.spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'fr', translationKey: 'common.french', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', translationKey: 'common.german', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'ar', translationKey: 'common.arabic', nativeName: 'العربية', dir: 'rtl' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  const base = String(code || '').split('-')[0].toLowerCase()
  return AVAILABLE_LANGUAGES.find(lang => lang.code === base)
}

export const getCurrentLanguageNativeName = (currentLang: string): string => {
  const language = getLanguageByCode(currentLang)
  return language?.nativeName || 'English'
}
