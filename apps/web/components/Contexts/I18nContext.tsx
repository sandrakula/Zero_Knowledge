'use client'

import React, { useEffect, useState } from 'react'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import i18n, { changeLanguage, detectLanguage } from '../../lib/i18n'
import { applyDocumentDirection } from '../../lib/direction'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const [, setLang] = useState(i18n.language)
  const [ready, setReady] = useState(false)

  // Detection runs after hydration on purpose: the server cannot know the
  // visitor's browser locale, so both sides start from the bundled English
  // bundle and the visitor's language is applied here. Keeping PageLoading
  // visible until the locale finishes loading prevents flashing untranslated
  // copy or half-hydrated page state.
  useEffect(() => {
    let active = true
    const handleLanguageChanged = (lng: string) => {
      applyDocumentDirection(lng)
      if (active) setLang(lng)
    }
    i18n.on('languageChanged', handleLanguageChanged)

    const init = async () => {
      try {
        if (i18n.language.split('-')[0] === 'en') {
          const detected = detectLanguage()
          if (detected.split('-')[0] !== 'en') {
            await changeLanguage(detected)
          }
        }
        applyDocumentDirection(i18n.language)
      } finally {
        if (active) setReady(true)
      }
    }

    void init()

    return () => {
      active = false
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  return (
    <>
      {!ready && <PageLoading />}
      {children}
    </>
  )
}
