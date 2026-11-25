'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  Check,
  Edit3,
  Minus,
  Palette,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  ACCENT_PRESETS,
  AVATAR_FRAMES,
  BADGE_COLORS,
  COVER_PRESETS,
  STATUS_PRESETS,
  THEMES,
  usePersonalization,
  type AvatarFrameId,
  type CabinetWidgetsConfig,
  type CoverPresetId,
  type ThemeId,
} from '@/lib/theme'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'

interface CabinetPersonalBannerProps {
  orgslug: string
  eyebrow: string
  greeting: string
  subtitle: string
  chips?: React.ReactNode
  actions?: React.ReactNode
}

export function CabinetPersonalBanner({
  orgslug,
  eyebrow,
  greeting,
  subtitle,
  chips,
  actions,
}: CabinetPersonalBannerProps) {
  const { t } = useTranslation()
  const {
    mounted,
    theme,
    themeOption,
    personalization,
    setTheme,
    update,
  } = usePersonalization()
  const [customizerOpen, setCustomizerOpen] = useState(false)

  const showBanner =
    !mounted || (personalization.cabinetWidgets.showBanner && personalization.coverPreset !== 'none')
  const activeCover = COVER_PRESETS.find((c) => c.id === personalization.coverPreset)
  const badgeStyle =
    BADGE_COLORS.find((b) => b.id === personalization.badgeColor) || BADGE_COLORS[0]

  const toggleWidget = (key: keyof CabinetWidgetsConfig) => {
    update({
      cabinetWidgets: {
        ...personalization.cabinetWidgets,
        [key]: !personalization.cabinetWidgets[key],
      },
    })
  }

  return (
    <div>
      {showBanner ? (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          {/* Artistic Cover */}
          <div
            className="relative h-28 w-full sm:h-36"
            style={
              activeCover && activeCover.background
                ? { background: activeCover.background }
                : {
                    background:
                      'radial-gradient(at 15% 20%, rgba(52, 211, 153, 0.42) 0px, transparent 55%), radial-gradient(at 85% 15%, rgba(99, 102, 241, 0.45) 0px, transparent 55%), linear-gradient(135deg, #0b132b 0%, #112233 50%, #0f172a 100%)',
                  }
            }
          >
            <div className="absolute top-3.5 end-3.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCustomizerOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/65"
              >
                <SlidersHorizontal size={13} />
                <span>
                  {t('personalization.customize_cabinet', { defaultValue: 'Настроить вид' })}
                </span>
              </button>
            </div>
          </div>

          {/* Content below cover */}
          <div className="relative px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end">
                <UserAvatar
                  width={80}
                  rounded="rounded-full"
                  border="border-4"
                  showStatusEmoji
                />
                <div className="pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-black/40">
                      {eyebrow}
                    </p>
                    {mounted && personalization.customBadge && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
                        style={{
                          backgroundColor: badgeStyle.bg,
                          color: badgeStyle.text,
                          borderColor: badgeStyle.border,
                        }}
                      >
                        <Sparkles size={10} />
                        {personalization.customBadge}
                      </span>
                    )}
                    {mounted && (personalization.statusEmoji || personalization.statusText) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-black/70">
                        {personalization.statusEmoji && <span>{personalization.statusEmoji}</span>}
                        {personalization.statusText && <span>{personalization.statusText}</span>}
                      </span>
                    )}
                  </div>
                  <h1 className="mt-1 text-2xl font-black tracking-tight text-black sm:text-3xl">
                    {greeting}
                  </h1>
                  <p className="mt-0.5 text-sm text-black/45">{subtitle}</p>
                </div>
              </div>

              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>

            {chips && <div className="mt-4 flex flex-wrap items-center gap-2">{chips}</div>}
          </div>
        </div>
      ) : (
        /* Compact Header without Cover Banner */
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <UserAvatar width={56} rounded="rounded-full" showStatusEmoji />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/35">
                  {eyebrow}
                </p>
                {mounted && personalization.customBadge && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
                    style={{
                      backgroundColor: badgeStyle.bg,
                      color: badgeStyle.text,
                      borderColor: badgeStyle.border,
                    }}
                  >
                    <Sparkles size={10} />
                    {personalization.customBadge}
                  </span>
                )}
                {mounted && (personalization.statusEmoji || personalization.statusText) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-medium text-black/70">
                    {personalization.statusEmoji && <span>{personalization.statusEmoji}</span>}
                    {personalization.statusText && <span>{personalization.statusText}</span>}
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-black">{greeting}</h1>
              <p className="mt-1 text-sm text-black/45">{subtitle}</p>
              {chips && <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setCustomizerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-black/70 transition-colors hover:text-black"
            >
              <SlidersHorizontal size={14} />
              <span>
                {t('personalization.customize_cabinet', { defaultValue: 'Настроить вид' })}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Inline Quick Customizer Panel */}
      {customizerOpen && (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-md">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-3">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-black/50" />
              <h3 className="text-sm font-bold text-black">
                {t('personalization.cabinet_customizer_title', {
                  defaultValue: 'Быстрая персонализация кабинета и темы',
                })}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={getUriWithOrg(orgslug, '/account/appearance')}
                className="text-xs font-semibold text-black/55 hover:text-black"
              >
                {t('personalization.open_studio', {
                  defaultValue: 'Все настройки персонализации',
                })}{' '}
                →
              </Link>
              <button
                type="button"
                onClick={() => setCustomizerOpen(false)}
                className="rounded-lg p-1 text-black/45 hover:bg-neutral-100 hover:text-black"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Column 1: Themes & Accent */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">
                {t('account.appearance', { defaultValue: 'Тема и акцент' })}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {THEMES.map((item) => {
                  const selected = theme === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTheme(item.id as ThemeId)}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start text-xs font-semibold transition-all ${
                        selected
                          ? 'border-black/70 bg-neutral-50 ring-1 ring-black/10'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                        style={{
                          backgroundColor: item.preview.bg,
                          borderColor: item.preview.border,
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: item.preview.accent }}
                        />
                      </span>
                      <span className="truncate text-black">
                        {t(item.labelKey, { defaultValue: item.id })}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="pt-1">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-black/45">
                  {t('personalization.accent_title', { defaultValue: 'Акцентный цвет' })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ACCENT_PRESETS.map((preset) => {
                    const isSelected =
                      preset.id === 'theme'
                        ? !personalization.accentColor
                        : personalization.accentColor.toLowerCase() === preset.hex.toLowerCase()
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => update({ accentColor: preset.hex })}
                        className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                          isSelected ? 'ring-2 ring-black ring-offset-1' : 'border-black/15'
                        }`}
                        style={{
                          backgroundColor: preset.hex || themeOption.preview.accent,
                        }}
                        title={t(preset.labelKey, { defaultValue: preset.id })}
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Column 2: Cover, Avatar Frame & Status */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">
                {t('personalization.cover_title', { defaultValue: 'Обложка и рамка аватара' })}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {COVER_PRESETS.map((cov) => {
                  const selected = personalization.coverPreset === cov.id
                  return (
                    <button
                      key={cov.id}
                      type="button"
                      onClick={() => update({ coverPreset: cov.id as CoverPresetId })}
                      className={`overflow-hidden rounded-xl border p-1.5 text-start transition-all ${
                        selected
                          ? 'border-black/70 ring-1 ring-black/15'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <div
                        className="h-6 w-full rounded-md"
                        style={
                          cov.background
                            ? { background: cov.background }
                            : { backgroundColor: 'var(--t-surface-2)' }
                        }
                      />
                      <p className="mt-1 truncate text-[11px] font-semibold text-black">
                        {t(cov.labelKey, { defaultValue: cov.id })}
                      </p>
                    </button>
                  )
                })}
              </div>

              <div className="pt-1">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-black/45">
                  {t('personalization.avatar_frame_title', { defaultValue: 'Рамка аватара' })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AVATAR_FRAMES.map((frame) => {
                    const active = personalization.avatarFrame === frame.id
                    return (
                      <button
                        key={frame.id}
                        type="button"
                        onClick={() => update({ avatarFrame: frame.id as AvatarFrameId })}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          active
                            ? 'border-black bg-black text-white'
                            : 'border-neutral-200 bg-neutral-50 text-black/70 hover:text-black'
                        }`}
                      >
                        {t(frame.labelKey, { defaultValue: frame.id })}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="pt-1">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-black/45">
                  {t('personalization.status_title', { defaultValue: 'Быстрый статус' })}
                </p>
                <div className="flex flex-wrap gap-1">
                  {STATUS_PRESETS.slice(0, 6).map((preset) => {
                    const label = t(preset.labelKey, { defaultValue: preset.defaultText })
                    const active = personalization.statusEmoji === preset.emoji
                    return (
                      <button
                        key={preset.emoji}
                        type="button"
                        onClick={() =>
                          update(
                            active
                              ? { statusEmoji: '', statusText: '' }
                              : { statusEmoji: preset.emoji, statusText: label },
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-black bg-black text-white'
                            : 'border-neutral-200 bg-neutral-50 text-black/70 hover:text-black'
                        }`}
                      >
                        <span>{preset.emoji}</span>
                        <span>{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Column 3: Visible Cabinet Widgets */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">
                {t('personalization.widgets_title', { defaultValue: 'Видимые блоки кабинета' })}
              </p>
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
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-start text-xs font-semibold transition-colors ${
                      enabled
                        ? 'border-black/50 bg-neutral-50 text-black'
                        : 'border-neutral-200 bg-white text-black/45'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        enabled ? 'border-black bg-black text-white' : 'border-neutral-300'
                      }`}
                    >
                      {enabled && <Check size={10} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function CabinetFocusWidget() {
  const { t } = useTranslation()
  const { mounted, personalization, update } = usePersonalization()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (mounted && !personalization.cabinetWidgets.showFocusGoal) {
    return null
  }

  const target = personalization.weeklyTargetLessons || 5
  const done = Math.min(target, Math.max(0, personalization.completedTodayCount || 0))
  const percent = Math.min(100, Math.round((done / target) * 100))

  const startEditing = () => {
    setDraft(personalization.dailyGoal || '')
    setEditing(true)
  }

  const saveGoal = () => {
    update({ dailyGoal: draft.trim() })
    setEditing(false)
  }

  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
              style={{
                backgroundColor: 'var(--t-accent)',
                color: 'var(--t-accent-ink)',
              }}
            >
              <Target size={15} />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-black/50">
              {t('personalization.focus_widget_title', {
                defaultValue: 'Мой фокус и цель на сегодня',
              })}
            </span>
            {!editing && (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-black/40 hover:bg-neutral-100 hover:text-black"
              >
                <Edit3 size={11} />
                {t('personalization.edit_goal', { defaultValue: 'Изменить' })}
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 100))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveGoal()
                  if (e.key === 'Escape') setEditing(false)
                }}
                placeholder={t('personalization.daily_goal_placeholder', {
                  defaultValue: 'Запишите главную учебную цель на сегодня...',
                })}
                className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm text-black focus:outline-hidden"
                autoFocus
              />
              <button
                type="button"
                onClick={saveGoal}
                className="rounded-xl bg-black px-3 py-1.5 text-xs font-bold text-white"
              >
                {t('common.save', { defaultValue: 'Сохранить' })}
              </button>
            </div>
          ) : (
            <p
              onClick={startEditing}
              className="mt-2 cursor-pointer text-sm font-semibold text-black hover:opacity-80"
            >
              {mounted && personalization.dailyGoal
                ? personalization.dailyGoal
                : t('personalization.daily_goal_empty', {
                    defaultValue:
                      'Нажмите, чтобы задать свою личную цель или фокус на день ✨',
                  })}
            </p>
          )}
        </div>

        {/* Interactive Daily Step Counter */}
        <div className="flex shrink-0 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5">
          <div className="min-w-[110px]">
            <div className="flex items-center justify-between text-xs font-bold text-black">
              <span>
                {t('personalization.daily_steps', { defaultValue: 'Шаги за день' })}
              </span>
              <span>
                {done}/{target}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${percent}%`,
                  backgroundColor: 'var(--t-accent)',
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => update({ completedTodayCount: Math.max(0, done - 1) })}
              disabled={done <= 0}
              className="grid h-7 w-7 place-items-center rounded-lg border border-neutral-200 bg-white text-black transition-colors hover:bg-neutral-100 disabled:opacity-40"
              aria-label="Decrease daily steps"
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              onClick={() => update({ completedTodayCount: Math.min(target, done + 1) })}
              disabled={done >= target}
              className="grid h-7 w-7 place-items-center rounded-lg border border-neutral-200 bg-white text-black transition-colors hover:bg-neutral-100 disabled:opacity-40"
              aria-label="Increase daily steps"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
