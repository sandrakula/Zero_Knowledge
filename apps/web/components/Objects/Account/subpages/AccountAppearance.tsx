'use client'

import React, { useState } from 'react'
import {
  Check,
  LayoutDashboard,
  Moon,
  Palette,
  RotateCcw,
  Smile,
  Sparkles,
  Sun,
  Target,
  UserCheck,
  Wand2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  ACCENT_PRESETS,
  AVATAR_FRAMES,
  BADGE_COLORS,
  BADGE_PRESETS,
  BG_PATTERNS,
  COVER_PRESETS,
  RADIUS_OPTIONS,
  STATUS_PRESETS,
  THEMES,
  usePersonalization,
  type AvatarFrameId,
  type AvatarShapeId,
  type BadgeColorId,
  type BgPatternId,
  type CabinetWidgetsConfig,
  type CoverPresetId,
  type RadiusId,
  type ThemeId,
} from '@/lib/theme'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { Input } from '@components/ui/input'

export default function AccountAppearance() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const user = session?.data?.user
  const {
    mounted,
    theme,
    themeOption,
    effectiveAccent,
    personalization,
    setTheme,
    update,
    reset,
  } = usePersonalization()

  const [modeFilter, setModeFilter] = useState<'all' | 'light' | 'dark'>('all')

  const filteredThemes = THEMES.filter((item) => {
    if (modeFilter === 'light') return item.mode === 'light'
    if (modeFilter === 'dark') return item.mode === 'dark'
    return true
  })

  const activeCover = COVER_PRESETS.find((c) => c.id === personalization.coverPreset)
  const activeBadgeStyle =
    BADGE_COLORS.find((b) => b.id === personalization.badgeColor) || BADGE_COLORS[0]

  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
    user?.username ||
    t('personalization.preview_user', { defaultValue: 'Студент zerok' })

  const toggleWidget = (key: keyof CabinetWidgetsConfig) => {
    update({
      cabinetWidgets: {
        ...personalization.cabinetWidgets,
        [key]: !personalization.cabinetWidgets[key],
      },
    })
  }

  return (
    <div className="space-y-6 pb-10">
      {/* 1. Live Interactive Preview Card */}
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div
          className="relative h-28 w-full transition-all sm:h-32"
          style={
            activeCover && activeCover.background
              ? { background: activeCover.background }
              : {
                  background:
                    'linear-gradient(135deg, var(--t-surface-2) 0%, var(--t-border) 100%)',
                }
          }
        >
          <div className="absolute top-3 end-3 flex items-center gap-2">
            <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
              {t('personalization.live_preview', { defaultValue: 'Живое превью' })}
            </span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-black shadow-xs transition-opacity hover:opacity-90"
            >
              <RotateCcw size={12} />
              {t('personalization.reset_all', { defaultValue: 'Сбросить' })}
            </button>
          </div>
        </div>

        <div className="relative px-6 pb-6">
          <div className="-mt-11 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <UserAvatar
                width={84}
                rounded="rounded-full"
                frameOverride={personalization.avatarFrame}
                shapeOverride={personalization.avatarShape}
                emojiOverride={personalization.statusEmoji}
                showStatusEmoji
              />
              <div className="pt-1 sm:pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black tracking-tight text-black">{displayName}</h2>
                  {personalization.customBadge && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold"
                      style={{
                        backgroundColor: activeBadgeStyle.bg,
                        color: activeBadgeStyle.text,
                        borderColor: activeBadgeStyle.border,
                      }}
                    >
                      <Sparkles size={11} />
                      {personalization.customBadge}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/50">
                  <span>@{user?.username || 'student'}</span>
                  {(personalization.statusEmoji || personalization.statusText) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 font-medium text-black/70">
                      {personalization.statusEmoji && <span>{personalization.statusEmoji}</span>}
                      {personalization.statusText && <span>{personalization.statusText}</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold"
                style={{
                  backgroundColor: 'var(--t-accent)',
                  color: 'var(--t-accent-ink)',
                }}
              >
                <Wand2 size={14} />
                {t(themeOption.labelKey, { defaultValue: themeOption.id })}
              </span>
            </div>
          </div>

          {personalization.dailyGoal && (
            <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-xs">
              <Target size={15} className="shrink-0 text-black/50" />
              <span className="font-semibold text-black/55">
                {t('personalization.focus_label', { defaultValue: 'Мой фокус:' })}
              </span>
              <span className="font-medium text-black">{personalization.dailyGoal}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Themes & Color Palettes */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Palette size={18} className="text-black/45" />
              <h2 className="text-base font-bold text-black">
                {t('account.appearance', { defaultValue: 'Темы и гармоничные палитры' })}
              </h2>
            </div>
            <p className="mt-1 text-sm text-black/45">
              {t('account.appearance_subtitle', {
                defaultValue:
                  'Подобранные светлые и тёмные темы, где фон, карточки, кнопки и акценты сочетаются между собой.',
              })}
            </p>
          </div>

          {/* Filter: All / Light / Dark */}
          <div className="inline-flex self-start rounded-xl bg-neutral-100 p-1 sm:self-auto">
            {(
              [
                { id: 'all', label: t('personalization.filter_all', { defaultValue: 'Все (14)' }) },
                {
                  id: 'light',
                  label: t('personalization.filter_light', { defaultValue: 'Светлые (8)' }),
                  Icon: Sun,
                },
                {
                  id: 'dark',
                  label: t('personalization.filter_dark', { defaultValue: 'Тёмные (6)' }),
                  Icon: Moon,
                },
              ] as const
            ).map((tab) => {
              const Icon = 'Icon' in tab ? tab.Icon : null
              const active = modeFilter === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setModeFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? 'bg-black text-white shadow-2xs' : 'text-black/60 hover:text-black'
                  }`}
                >
                  {Icon && <Icon size={13} />}
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredThemes.map((option) => {
            const selected = mounted && theme === option.id
            const previewAccent = personalization.accentColor || option.preview.accent
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id as ThemeId)}
                aria-pressed={selected}
                className={`group relative overflow-hidden rounded-2xl border bg-white p-3 text-start transition-all ${
                  selected
                    ? 'border-black/70 ring-2 ring-black/15'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {/* Detailed mini-UI preview */}
                <div
                  className="flex h-24 flex-col justify-between rounded-xl border p-2.5"
                  style={{
                    backgroundColor: option.preview.bg,
                    borderColor: option.preview.border,
                  }}
                >
                  {/* Top bar preview */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: previewAccent }}
                      />
                      <span
                        className="h-2 w-12 rounded-full opacity-75"
                        style={{ backgroundColor: option.preview.text }}
                      />
                    </div>
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase"
                      style={{
                        backgroundColor: option.preview.surface2,
                        color: option.preview.muted,
                      }}
                    >
                      {option.mode === 'dark' ? 'Dark' : 'Light'}
                    </span>
                  </div>

                  {/* Surface card + Hero mini preview */}
                  <div className="flex items-end gap-2">
                    <div
                      className="flex h-11 flex-1 flex-col justify-between rounded-lg border p-2"
                      style={{
                        backgroundColor: option.preview.surface,
                        borderColor: option.preview.border,
                      }}
                    >
                      <span
                        className="h-1.5 w-14 rounded-full opacity-70"
                        style={{ backgroundColor: option.preview.text }}
                      />
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full"
                        style={{ backgroundColor: option.preview.surface2 }}
                      >
                        <div
                          className="h-full w-2/3 rounded-full"
                          style={{ backgroundColor: previewAccent }}
                        />
                      </div>
                    </div>

                    <div
                      className="flex h-11 w-12 flex-col items-center justify-center rounded-lg p-1.5"
                      style={{ backgroundColor: option.preview.heroBg }}
                    >
                      <span
                        className="h-3.5 w-7 rounded-md"
                        style={{ backgroundColor: previewAccent }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-black">
                      {t(option.labelKey, { defaultValue: option.id })}
                    </p>
                    <p className="truncate text-xs text-black/45">
                      {t(option.descriptionKey, {
                        defaultValue:
                          option.mode === 'dark' ? 'Глубокая тёмная палитра' : 'Мягкая светлая палитра',
                      })}
                    </p>
                  </div>
                  {selected && (
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                      style={{
                        backgroundColor: 'var(--t-accent)',
                        color: 'var(--t-accent-ink)',
                      }}
                    >
                      <Check size={13} />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 3. Accent Color, Background Atmosphere & Corner Radius */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Wand2 size={18} className="text-black/45" />
          <h2 className="text-base font-bold text-black">
            {t('personalization.style_section_title', {
              defaultValue: 'Акцентный цвет и атмосфера интерфейса',
            })}
          </h2>
        </div>
        <p className="mt-1 text-sm text-black/45">
          {t('personalization.style_section_subtitle', {
            defaultValue:
              'Настройте фирменный акцент под себя или оставьте родной цвет выбранной темы.',
          })}
        </p>

        {/* Accent Presets + Custom Color Picker */}
        <div className="mt-5">
          <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
            {t('personalization.accent_title', { defaultValue: 'Акцентный цвет' })}
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {ACCENT_PRESETS.map((preset) => {
              const selected =
                preset.id === 'theme'
                  ? !personalization.accentColor
                  : personalization.accentColor.toLowerCase() === preset.hex.toLowerCase()
              const swatchColor = preset.hex || themeOption.preview.accent
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => update({ accentColor: preset.hex })}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                    selected
                      ? 'border-black/70 bg-neutral-50 ring-2 ring-black/10'
                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-black/15"
                    style={{ backgroundColor: swatchColor }}
                  />
                  <span className="text-black">
                    {t(preset.labelKey, { defaultValue: preset.id })}
                  </span>
                </button>
              )
            })}

            {/* Custom Hex Color Picker */}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-black/70 hover:border-black/40">
              <input
                type="color"
                value={personalization.accentColor || effectiveAccent}
                onChange={(e) => update({ accentColor: e.target.value })}
                className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span>{t('personalization.custom_color', { defaultValue: 'Свой цвет' })}</span>
              {personalization.accentColor && (
                <span className="font-mono text-[11px] uppercase text-black/50">
                  {personalization.accentColor}
                </span>
              )}
            </label>
          </div>
        </div>

        {/* Background Atmosphere & Card Radius */}
        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-neutral-100 pt-6 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('personalization.atmosphere_title', { defaultValue: 'Атмосфера фона' })}
            </label>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {BG_PATTERNS.map((pat) => {
                const active = personalization.bgPattern === pat.id
                return (
                  <button
                    key={pat.id}
                    type="button"
                    onClick={() => update({ bgPattern: pat.id as BgPatternId })}
                    className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-200 bg-white text-black/70 hover:border-neutral-300'
                    }`}
                  >
                    {t(pat.labelKey, { defaultValue: pat.id })}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('personalization.radius_title', { defaultValue: 'Скругление карточек' })}
            </label>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {RADIUS_OPTIONS.map((rad) => {
                const active = personalization.radius === rad.id
                return (
                  <button
                    key={rad.id}
                    type="button"
                    onClick={() => update({ radius: rad.id as RadiusId })}
                    className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-200 bg-white text-black/70 hover:border-neutral-300'
                    }`}
                  >
                    {t(rad.labelKey, { defaultValue: rad.id })}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Profile & Avatar Decorations */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <UserCheck size={18} className="text-black/45" />
          <h2 className="text-base font-bold text-black">
            {t('personalization.profile_section_title', {
              defaultValue: 'Украшения профиля и аватара',
            })}
          </h2>
        </div>
        <p className="mt-1 text-sm text-black/45">
          {t('personalization.profile_section_subtitle', {
            defaultValue:
              'Выберите светящуюся рамку аватара, форму, художественную обложку, статус и личный бейдж.',
          })}
        </p>

        {/* Avatar Frame */}
        <div className="mt-5">
          <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
            {t('personalization.avatar_frame_title', { defaultValue: 'Рамка и свечение аватара' })}
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {AVATAR_FRAMES.map((frame) => {
              const selected = personalization.avatarFrame === frame.id
              return (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => update({ avatarFrame: frame.id as AvatarFrameId })}
                  className={`flex items-center gap-3 rounded-xl border p-2.5 text-start transition-all ${
                    selected
                      ? 'border-black/70 bg-neutral-50 ring-2 ring-black/10'
                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={
                      frame.gradient
                        ? {
                            background: frame.gradient,
                            boxShadow: frame.glow,
                            padding: '2.5px',
                          }
                        : { border: '1.5px dashed var(--t-border)' }
                    }
                  >
                    <span className="h-full w-full rounded-full bg-white" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-black">
                    {t(frame.labelKey, { defaultValue: frame.id })}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Avatar Shape */}
        <div className="mt-6">
          <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
            {t('personalization.avatar_shape_title', { defaultValue: 'Форма аватара' })}
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(
              [
                {
                  id: 'circle',
                  label: t('personalization.shape.circle', { defaultValue: 'Круг' }),
                },
                {
                  id: 'squircle',
                  label: t('personalization.shape.squircle', { defaultValue: 'Сквиркл' }),
                },
                {
                  id: 'rounded',
                  label: t('personalization.shape.rounded', { defaultValue: 'Скруглённый квадрат' }),
                },
              ] as { id: AvatarShapeId; label: string }[]
            ).map((shape) => {
              const active = personalization.avatarShape === shape.id
              return (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => update({ avatarShape: shape.id })}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                    active
                      ? 'border-black bg-black text-white'
                      : 'border-neutral-200 bg-white text-black/70 hover:border-neutral-300'
                  }`}
                >
                  {shape.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Profile & Cabinet Cover Banner */}
        <div className="mt-6 border-t border-neutral-100 pt-6">
          <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
            {t('personalization.cover_title', {
              defaultValue: 'Обложка профиля и личного кабинета',
            })}
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {COVER_PRESETS.map((cover) => {
              const selected = personalization.coverPreset === cover.id
              return (
                <button
                  key={cover.id}
                  type="button"
                  onClick={() => update({ coverPreset: cover.id as CoverPresetId })}
                  className={`group overflow-hidden rounded-xl border p-2 text-start transition-all ${
                    selected
                      ? 'border-black/70 ring-2 ring-black/10'
                      : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <div
                    className="h-12 w-full rounded-lg border border-black/10"
                    style={
                      cover.background
                        ? { background: cover.background }
                        : { backgroundColor: 'var(--t-surface-2)' }
                    }
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-black">
                      {t(cover.labelKey, { defaultValue: cover.id })}
                    </span>
                    {selected && <Check size={13} className="text-black" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Emoji Status & Custom Badge */}
        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-neutral-100 pt-6 lg:grid-cols-2">
          {/* Status */}
          <div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-black/50">
                <Smile size={14} />
                {t('personalization.status_title', { defaultValue: 'Эмодзи-статус и настроение' })}
              </label>
              {(personalization.statusEmoji || personalization.statusText) && (
                <button
                  type="button"
                  onClick={() => update({ statusEmoji: '', statusText: '' })}
                  className="text-xs font-medium text-black/45 hover:text-black"
                >
                  {t('personalization.clear', { defaultValue: 'Очистить' })}
                </button>
              )}
            </div>

            <div className="mt-2.5 flex gap-2">
              <Input
                value={personalization.statusEmoji}
                onChange={(e) => update({ statusEmoji: e.target.value.slice(0, 4) })}
                placeholder="🚀"
                className="w-16 text-center text-base"
                maxLength={4}
              />
              <Input
                value={personalization.statusText}
                onChange={(e) => update({ statusText: e.target.value.slice(0, 48) })}
                placeholder={t('personalization.status_placeholder', {
                  defaultValue: 'Чем вы сейчас заняты?',
                })}
                className="flex-1"
                maxLength={48}
              />
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {STATUS_PRESETS.map((preset) => {
                const label = t(preset.labelKey, { defaultValue: preset.defaultText })
                const active =
                  personalization.statusEmoji === preset.emoji &&
                  personalization.statusText === label
                return (
                  <button
                    key={preset.emoji}
                    type="button"
                    onClick={() => update({ statusEmoji: preset.emoji, statusText: label })}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-200 bg-neutral-50 text-black/70 hover:border-neutral-300'
                    }`}
                  >
                    <span>{preset.emoji}</span>
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom Badge / Title */}
          <div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-black/50">
                <Sparkles size={14} />
                {t('personalization.badge_title', { defaultValue: 'Личный бейдж / титул' })}
              </label>
              {personalization.customBadge && (
                <button
                  type="button"
                  onClick={() => update({ customBadge: '' })}
                  className="text-xs font-medium text-black/45 hover:text-black"
                >
                  {t('personalization.clear', { defaultValue: 'Очистить' })}
                </button>
              )}
            </div>

            <div className="mt-2.5">
              <Input
                value={personalization.customBadge}
                onChange={(e) => update({ customBadge: e.target.value.slice(0, 28) })}
                placeholder={t('personalization.badge_placeholder', {
                  defaultValue: 'Например: AI Explorer, Отличник, Ментор...',
                })}
                maxLength={28}
              />
            </div>

            {/* Badge Color Swatches */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {BADGE_COLORS.map((bc) => {
                const selected = personalization.badgeColor === bc.id
                return (
                  <button
                    key={bc.id}
                    type="button"
                    onClick={() => update({ badgeColor: bc.id as BadgeColorId })}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                      selected ? 'ring-2 ring-black ring-offset-1' : 'border-black/15'
                    }`}
                    style={{ backgroundColor: bc.swatch }}
                    title={t(bc.labelKey, { defaultValue: bc.id })}
                  />
                )
              })}
            </div>

            {/* Quick Badge Presets */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {BADGE_PRESETS.map((preset) => {
                const label = t(preset.labelKey, { defaultValue: preset.defaultText })
                const active = personalization.customBadge === label
                return (
                  <button
                    key={preset.labelKey}
                    type="button"
                    onClick={() =>
                      update({ customBadge: label, badgeColor: preset.color })
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-200 bg-neutral-50 text-black/70 hover:border-neutral-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 5. Cabinet (/cabinet) Personalization */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={18} className="text-black/45" />
          <h2 className="text-base font-bold text-black">
            {t('personalization.cabinet_section_title', {
              defaultValue: 'Персонализация кабинета (/cabinet)',
            })}
          </h2>
        </div>
        <p className="mt-1 text-sm text-black/45">
          {t('personalization.cabinet_section_subtitle', {
            defaultValue:
              'Задайте личную цель обучения и выберите, какие виджеты отображать на главной странице кабинета.',
          })}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('personalization.daily_goal_label', {
                defaultValue: 'Личная цель или девиз обучения',
              })}
            </label>
            <Input
              value={personalization.dailyGoal}
              onChange={(e) => update({ dailyGoal: e.target.value.slice(0, 100) })}
              placeholder={t('personalization.daily_goal_placeholder', {
                defaultValue: 'Например: Проходить по 2 урока в день и готовиться к контесту',
              })}
              className="mt-2"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('personalization.daily_target_label', {
                defaultValue: 'Цель шагов на день',
              })}
            </label>
            <div className="mt-2 flex items-center gap-2">
              {[3, 5, 7, 10].map((num) => {
                const active = personalization.weeklyTargetLessons === num
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => update({ weeklyTargetLessons: num })}
                    className={`flex-1 rounded-xl border py-2 text-xs font-bold transition-colors ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-200 bg-neutral-50 text-black/70 hover:border-neutral-300'
                    }`}
                  >
                    {num}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Cabinet Widget Visibility Toggles */}
        <div className="mt-6 border-t border-neutral-100 pt-5">
          <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
            {t('personalization.widgets_title', {
              defaultValue: 'Видимые блоки в кабинете',
            })}
          </label>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                {
                  key: 'showBanner',
                  label: t('personalization.widget.banner', {
                    defaultValue: 'Атмосферная обложка и профиль',
                  }),
                },
                {
                  key: 'showFocusGoal',
                  label: t('personalization.widget.focus', {
                    defaultValue: 'Виджет «Мой фокус и цель дня»',
                  }),
                },
                {
                  key: 'showContinueHero',
                  label: t('personalization.widget.continue', {
                    defaultValue: 'Баннер «Продолжить обучение»',
                  }),
                },
                {
                  key: 'showStatsRow',
                  label: t('personalization.widget.stats', {
                    defaultValue: 'Карточки сводной статистики',
                  }),
                },
                {
                  key: 'showDeadlines',
                  label: t('personalization.widget.deadlines', {
                    defaultValue: 'Блок дедлайнов и событий',
                  }),
                },
              ] as { key: keyof CabinetWidgetsConfig; label: string }[]
            ).map((item) => {
              const enabled = personalization.cabinetWidgets[item.key]
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleWidget(item.key)}
                  aria-pressed={enabled}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-start text-xs font-semibold transition-all ${
                    enabled
                      ? 'border-black/60 bg-neutral-50 text-black'
                      : 'border-neutral-200 bg-white text-black/45'
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                      enabled ? 'border-black bg-black text-white' : 'border-neutral-300'
                    }`}
                  >
                    {enabled && <Check size={12} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
