'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import { loadDateLocale } from './format';

const LOCALE_LOADERS: Record<string, () => Promise<{ default: any }>> = {
  ru: () => import('../locales/ru.json'),
  es: () => import('../locales/es.json'),
  fr: () => import('../locales/fr.json'),
  de: () => import('../locales/de.json'),
  ar: () => import('../locales/ar.json'),
};

// Only bundle English; lazy-load all other locales on demand
const resources = {
  en: { common: en },
};

const STORAGE_KEY = 'i18nextLng'
const COOKIE_NAME = 'i18next'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Every UI language the app ships. */
export const SUPPORTED_LANGUAGES = ['en', ...Object.keys(LOCALE_LOADERS)]

function normalizeSupportedCode(lng: string | null | undefined): string {
  const base = String(lng || '').split('-')[0].toLowerCase()
  return SUPPORTED_LANGUAGES.includes(base) ? base : 'en'
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
    )
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/**
 * The language to switch to after mount.
 *
 * Detection is deliberately deferred: the server has no browser locale (and
 * Node's `navigator.language` reflects the machine, not the visitor), so the
 * first render must always be the bundled English bundle. Otherwise the SSR
 * markup and the client disagree and React reports a hydration mismatch.
 * I18nProvider calls this from an effect, after hydration.
 */
export function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en'

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return normalizeSupportedCode(stored)
  } catch {
    /* storage blocked: fall through to the cookie */
  }

  const fromCookie = readCookie(COOKIE_NAME)
  if (fromCookie) return normalizeSupportedCode(fromCookie)

  const fromQuery = new URLSearchParams(window.location.search).get('lng')
  if (fromQuery) return normalizeSupportedCode(fromQuery)

  return normalizeSupportedCode(navigator.language || 'en')
}

async function loadLocale(lng: string) {
  const code = normalizeSupportedCode(lng)
  if (code === 'en' || !LOCALE_LOADERS[code]) return;
  if (i18n.hasResourceBundle(code, 'common')) return;

  try {
    const mod = await LOCALE_LOADERS[code]();
    i18n.addResourceBundle(code, 'common', mod.default, true, true);
  } catch (e) {
    console.warn(`Failed to load locale: ${lng}`, e);
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    // Start in English on both the server and the client's first render; the
    // visitor's language is applied after mount by I18nProvider.
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    react: {
      useSuspense: false,
    }
  });

export async function changeLanguage(lng: string) {
  const safeCode = normalizeSupportedCode(lng)
  await Promise.all([loadLocale(safeCode), loadDateLocale(safeCode)])
  const result = await i18n.changeLanguage(safeCode)

  // Persist the choice here, because detection no longer caches it implicitly.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, safeCode)
    } catch {
      /* storage blocked: the cookie below still carries the choice */
    }
    try {
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(safeCode)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    } catch {
      /* cookies blocked */
    }
  }

  return result
}

export default i18n;
