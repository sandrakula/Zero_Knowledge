'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Check, Moon, Palette, Sparkles, Sun, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  ACCENT_PRESETS,
  BG_PATTERNS,
  THEMES,
  usePersonalization,
  type BgPatternId,
  type ThemeId,
} from '@/lib/theme'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getUriWithOrg } from '@services/config/config'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'

interface ThemeQuickSwitcherProps {
  orgslug?: string
  primaryColor?: string
}

export function ThemeQuickSwitcher({ orgslug, primaryColor = '' }: ThemeQuickSwitcherProps) {
  const { t } = useTranslation()
  const { mounted, theme, themeOption, effectiveAccent, personalization, setTheme, update } =
    usePersonalization()
  const [tab, setTab] = useState<'all' | 'light' | 'dark'>('all')
  const colors = getMenuColorClasses(primaryColor)

  const isDark = mounted && themeOption.mode === 'dark'

  const toggleLightDark = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isDark) {
      setTheme('snow')
    } else {
      setTheme('night')
    }
  }

  const visibleThemes = THEMES.filter((item) => {
    if (tab === 'light') return item.mode === 'light'
    if (tab === 'dark') return item.mode === 'dark'
    return true
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`relative flex items-center justify-center rounded-lg p-2 transition-colors ${colors.iconBtn}`}
          aria-label={t('personalization.quick_switcher_title', {
            defaultValue: 'Theme & personalization',
          })}
          title={t('personalization.quick_switcher_title', {
            defaultValue: 'Theme & personalization',
          })}
        >
          <Palette size={19} />
          {mounted && (
            <span
              className="absolute bottom-1.5 end-1.5 h-2 w-2 rounded-full ring-1 ring-black/20"
              style={{ backgroundColor: effectiveAccent }}
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-xl"
      >
        {/* Header with fast light/dark toggle */}
        <div className="flex items-center justify-between gap-2 pb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-black/50" />
            <span className="text-xs font-bold uppercase tracking-wider text-black/70">
              {t('personalization.quick_switcher_title', {
                defaultValue: 'Персонализация',
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleLightDark}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-black/70 transition-colors hover:text-black"
          >
            {isDark ? <Sun size={12} /> : <Moon size={12} />}
            <span>
              {isDark
                ? t('personalization.switch_to_light', { defaultValue: 'Светлая' })
                : t('personalization.switch_to_dark', { defaultValue: 'Тёмная' })}
            </span>
          </button>
        </div>

        {/* Mode filter tabs */}
        <div className="mb-2.5 grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1">
          {(['all', 'light', 'dark'] as const).map((modeKey) => (
            <button
              key={modeKey}
              type="button"
              onClick={() => setTab(modeKey)}
              className={`rounded-lg py-1 text-[11px] font-semibold transition-colors ${
                tab === modeKey
                  ? 'bg-black text-white shadow-xs'
                  : 'text-black/60 hover:text-black'
              }`}
            >
              {modeKey === 'all'
                ? t('personalization.filter_all', { defaultValue: 'Все' })
                : modeKey === 'light'
                  ? t('personalization.filter_light', { defaultValue: 'Светлые' })
                  : t('personalization.filter_dark', { defaultValue: 'Тёмные' })}
            </button>
          ))}
        </div>

        {/* Themes grid */}
        <div className="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto pe-0.5">
          {visibleThemes.map((item) => {
            const selected = theme === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTheme(item.id as ThemeId)}
                className={`flex items-center gap-2 rounded-xl border p-2 text-start transition-all ${
                  selected
                    ? 'border-black/60 bg-neutral-50 ring-1 ring-black/15'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <span
                  className="relative flex h-6 w-8 shrink-0 items-center justify-center rounded-md border"
                  style={{
                    backgroundColor: item.preview.bg,
                    borderColor: item.preview.border,
                  }}
                >
                  <span
                    className="h-3 w-3 rounded-full shadow-2xs"
                    style={{ backgroundColor: item.preview.accent }}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-black">
                  {t(item.labelKey, { defaultValue: item.id })}
                </span>
                {selected && <Check size={13} className="shrink-0 text-black" />}
              </button>
            )
          })}
        </div>

        <DropdownMenuSeparator className="my-3" />

        {/* Accent Color quick picker */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-black/45">
              {t('personalization.accent_title', { defaultValue: 'Акцентный цвет' })}
            </span>
            {personalization.accentColor && (
              <button
                type="button"
                onClick={() => update({ accentColor: '' })}
                className="text-[11px] font-medium text-black/45 hover:text-black"
              >
                {t('personalization.accent_reset', { defaultValue: 'Цвет темы' })}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => {
              const isSelected =
                preset.id === 'theme'
                  ? !personalization.accentColor
                  : personalization.accentColor.toLowerCase() === preset.hex.toLowerCase()
              const displayHex = preset.hex || themeOption.preview.accent
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => update({ accentColor: preset.hex })}
                  title={t(preset.labelKey, { defaultValue: preset.id })}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110 ${
                    isSelected ? 'ring-2 ring-black ring-offset-1' : 'border-black/15'
                  }`}
                  style={{ backgroundColor: displayHex }}
                >
                  {preset.id === 'theme' && (
                    <span className="text-[9px] font-black" style={{ color: themeOption.preview.ink }}>
                      A
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Background Atmosphere quick row */}
        <div className="mt-3">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-black/45">
            {t('personalization.atmosphere_title', { defaultValue: 'Атмосфера фона' })}
          </span>
          <div className="flex flex-wrap gap-1">
            {BG_PATTERNS.map((pat) => {
              const active = personalization.bgPattern === pat.id
              return (
                <button
                  key={pat.id}
                  type="button"
                  onClick={() => update({ bgPattern: pat.id as BgPatternId })}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'border-black bg-black text-white'
                      : 'border-neutral-200 bg-neutral-50 text-black/60 hover:text-black'
                  }`}
                >
                  {t(pat.labelKey, { defaultValue: pat.id })}
                </button>
              )
            })}
          </div>
        </div>

        {orgslug && (
          <>
            <DropdownMenuSeparator className="my-3" />
            <Link
              href={getUriWithOrg(orgslug, '/account/appearance')}
              className="flex w-full items-center justify-between rounded-xl bg-neutral-100 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-neutral-200/70"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal size={14} />
                {t('personalization.open_studio', {
                  defaultValue: 'Все настройки персонализации',
                })}
              </span>
              <span>→</span>
            </Link>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ThemeQuickSwitcher
