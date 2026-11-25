/**
 * Account themes & UI/profile personalization.
 *
 * The chosen theme, accent, atmosphere and profile/cabinet decorations are
 * local preferences: `theme-init.js` applies theme, accent, pattern and radius
 * before first paint from localStorage (and `?theme=` for previews), and the
 * appearance settings / quick switcher / cabinet customizer write them back.
 * The <html> attributes are never part of React's tree, so applying them
 * outside React cannot cause hydration errors.
 */

import { useCallback, useSyncExternalStore } from 'react'

export type ThemeId =
  | 'snow'
  | 'paper'
  | 'mist'
  | 'sage'
  | 'rose'
  | 'lavender'
  | 'sand'
  | 'graphite'
  | 'night'
  | 'midnight'
  | 'nord'
  | 'obsidian'
  | 'forest'
  | 'espresso'

export type ThemeMode = 'light' | 'dark'

export interface ThemeOption {
  id: ThemeId
  mode: ThemeMode
  labelKey: string
  descriptionKey: string
  /** Swatch preview: page background, card surface, secondary surface, border, text, accent, ink. */
  preview: {
    bg: string
    surface: string
    surface2: string
    border: string
    text: string
    muted: string
    accent: string
    ink: string
    heroBg: string
  }
}

export const THEMES: ThemeOption[] = [
  // ── Light Themes ──────────────────────────────────────────────────────────
  {
    id: 'snow',
    mode: 'light',
    labelKey: 'theme.snow',
    descriptionKey: 'theme.snow_desc',
    preview: {
      bg: '#ffffff',
      surface: '#ffffff',
      surface2: '#f4f4f6',
      border: '#e5e7eb',
      text: '#0a0a0c',
      muted: '#6b7280',
      accent: '#c6ff4a',
      ink: '#0a0a0a',
      heroBg: '#0b0c0d',
    },
  },
  {
    id: 'paper',
    mode: 'light',
    labelKey: 'theme.paper',
    descriptionKey: 'theme.paper_desc',
    preview: {
      bg: '#faf6ee',
      surface: '#fffdf8',
      surface2: '#f2ece0',
      border: '#e5dccd',
      text: '#1c160f',
      muted: '#7d705f',
      accent: '#f59e0b',
      ink: '#1c1202',
      heroBg: '#231b12',
    },
  },
  {
    id: 'mist',
    mode: 'light',
    labelKey: 'theme.mist',
    descriptionKey: 'theme.mist_desc',
    preview: {
      bg: '#f1f5fb',
      surface: '#ffffff',
      surface2: '#e6edf7',
      border: '#d8e2f0',
      text: '#0d1526',
      muted: '#63738a',
      accent: '#6366f1',
      ink: '#ffffff',
      heroBg: '#111827',
    },
  },
  {
    id: 'sage',
    mode: 'light',
    labelKey: 'theme.sage',
    descriptionKey: 'theme.sage_desc',
    preview: {
      bg: '#f1f7f2',
      surface: '#ffffff',
      surface2: '#e5efe7',
      border: '#d4e4d7',
      text: '#0e1c12',
      muted: '#5d7463',
      accent: '#10b981',
      ink: '#04231a',
      heroBg: '#102418',
    },
  },
  {
    id: 'rose',
    mode: 'light',
    labelKey: 'theme.rose',
    descriptionKey: 'theme.rose_desc',
    preview: {
      bg: '#fcf3f6',
      surface: '#ffffff',
      surface2: '#f7e6ec',
      border: '#edd5de',
      text: '#220d13',
      muted: '#87636e',
      accent: '#f43f5e',
      ink: '#ffffff',
      heroBg: '#281018',
    },
  },
  {
    id: 'lavender',
    mode: 'light',
    labelKey: 'theme.lavender',
    descriptionKey: 'theme.lavender_desc',
    preview: {
      bg: '#f5f3fc',
      surface: '#ffffff',
      surface2: '#ebe6f8',
      border: '#dfd8f2',
      text: '#181028',
      muted: '#6e6388',
      accent: '#8b5cf6',
      ink: '#ffffff',
      heroBg: '#1c1230',
    },
  },
  {
    id: 'sand',
    mode: 'light',
    labelKey: 'theme.sand',
    descriptionKey: 'theme.sand_desc',
    preview: {
      bg: '#f7f3ed',
      surface: '#fffdfa',
      surface2: '#efe8de',
      border: '#e3d9cb',
      text: '#211711',
      muted: '#7c6b5d',
      accent: '#ea580c',
      ink: '#ffffff',
      heroBg: '#271a13',
    },
  },
  {
    id: 'graphite',
    mode: 'light',
    labelKey: 'theme.graphite',
    descriptionKey: 'theme.graphite_desc',
    preview: {
      bg: '#eef0f3',
      surface: '#ffffff',
      surface2: '#e3e6eb',
      border: '#d3d7df',
      text: '#101216',
      muted: '#646973',
      accent: '#0d9488',
      ink: '#ffffff',
      heroBg: '#15181e',
    },
  },

  // ── Dark Themes ───────────────────────────────────────────────────────────
  {
    id: 'night',
    mode: 'dark',
    labelKey: 'theme.night',
    descriptionKey: 'theme.night_desc',
    preview: {
      bg: '#0a0b0e',
      surface: '#13161b',
      surface2: '#1c2027',
      border: '#2c323c',
      text: '#f5f7fa',
      muted: '#a3abb8',
      accent: '#c6ff4a',
      ink: '#0a0a0a',
      heroBg: '#181c23',
    },
  },
  {
    id: 'midnight',
    mode: 'dark',
    labelKey: 'theme.midnight',
    descriptionKey: 'theme.midnight_desc',
    preview: {
      bg: '#080d18',
      surface: '#101829',
      surface2: '#19243b',
      border: '#293959',
      text: '#f0f5fc',
      muted: '#9db0ce',
      accent: '#38bdf8',
      ink: '#051624',
      heroBg: '#152138',
    },
  },
  {
    id: 'nord',
    mode: 'dark',
    labelKey: 'theme.nord',
    descriptionKey: 'theme.nord_desc',
    preview: {
      bg: '#181d24',
      surface: '#222933',
      surface2: '#2c3542',
      border: '#3d495a',
      text: '#eef3f8',
      muted: '#a6b5c7',
      accent: '#88c0d0',
      ink: '#0e151d',
      heroBg: '#27303d',
    },
  },
  {
    id: 'obsidian',
    mode: 'dark',
    labelKey: 'theme.obsidian',
    descriptionKey: 'theme.obsidian_desc',
    preview: {
      bg: '#0d0a14',
      surface: '#171224',
      surface2: '#221b35',
      border: '#352a52',
      text: '#f5f1fc',
      muted: '#b0a3cc',
      accent: '#a855f7',
      ink: '#ffffff',
      heroBg: '#1e1630',
    },
  },
  {
    id: 'forest',
    mode: 'dark',
    labelKey: 'theme.forest',
    descriptionKey: 'theme.forest_desc',
    preview: {
      bg: '#08110d',
      surface: '#101f18',
      surface2: '#182e24',
      border: '#284739',
      text: '#edf7f1',
      muted: '#9abaa8',
      accent: '#34d399',
      ink: '#042115',
      heroBg: '#14271e',
    },
  },
  {
    id: 'espresso',
    mode: 'dark',
    labelKey: 'theme.espresso',
    descriptionKey: 'theme.espresso_desc',
    preview: {
      bg: '#110d0b',
      surface: '#1b1512',
      surface2: '#271f1a',
      border: '#3d3029',
      text: '#f8f1ea',
      muted: '#baa99a',
      accent: '#fbbf24',
      ink: '#1c1103',
      heroBg: '#221a15',
    },
  },
]

// ── Independent Accent Colors ────────────────────────────────────────────────

export type AccentPresetId =
  | 'theme'
  | 'lime'
  | 'indigo'
  | 'violet'
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'rose'
  | 'coral'
  | 'teal'
  | 'pink'

export interface AccentOption {
  id: AccentPresetId
  labelKey: string
  hex: string // empty for 'theme' (uses theme default)
  ink: string
}

export const ACCENT_PRESETS: AccentOption[] = [
  { id: 'theme', labelKey: 'personalization.accent.theme', hex: '', ink: '' },
  { id: 'lime', labelKey: 'personalization.accent.lime', hex: '#c6ff4a', ink: '#0a0a0a' },
  { id: 'indigo', labelKey: 'personalization.accent.indigo', hex: '#6366f1', ink: '#ffffff' },
  { id: 'violet', labelKey: 'personalization.accent.violet', hex: '#8b5cf6', ink: '#ffffff' },
  { id: 'emerald', labelKey: 'personalization.accent.emerald', hex: '#10b981', ink: '#04231a' },
  { id: 'sky', labelKey: 'personalization.accent.sky', hex: '#0ea5e9', ink: '#041d2e' },
  { id: 'amber', labelKey: 'personalization.accent.amber', hex: '#f59e0b', ink: '#1c1202' },
  { id: 'rose', labelKey: 'personalization.accent.rose', hex: '#f43f5e', ink: '#ffffff' },
  { id: 'coral', labelKey: 'personalization.accent.coral', hex: '#f97316', ink: '#ffffff' },
  { id: 'teal', labelKey: 'personalization.accent.teal', hex: '#14b8a6', ink: '#04231f' },
  { id: 'pink', labelKey: 'personalization.accent.pink', hex: '#ec4899', ink: '#ffffff' },
]

// ── Background Atmosphere & Corner Radius ────────────────────────────────────

export type BgPatternId = 'none' | 'dots' | 'grid' | 'glow' | 'mesh'
export type RadiusId = 'sharp' | 'default' | 'round'

export const BG_PATTERNS: { id: BgPatternId; labelKey: string }[] = [
  { id: 'none', labelKey: 'personalization.pattern.none' },
  { id: 'glow', labelKey: 'personalization.pattern.glow' },
  { id: 'mesh', labelKey: 'personalization.pattern.mesh' },
  { id: 'dots', labelKey: 'personalization.pattern.dots' },
  { id: 'grid', labelKey: 'personalization.pattern.grid' },
]

export const RADIUS_OPTIONS: { id: RadiusId; labelKey: string }[] = [
  { id: 'sharp', labelKey: 'personalization.radius.sharp' },
  { id: 'default', labelKey: 'personalization.radius.default' },
  { id: 'round', labelKey: 'personalization.radius.round' },
]

// ── Avatar & Profile Decorations ─────────────────────────────────────────────

export type AvatarFrameId =
  | 'none'
  | 'accent'
  | 'aurora'
  | 'sunset'
  | 'neon'
  | 'gold'
  | 'ocean'
  | 'sakura'

export type AvatarShapeId = 'circle' | 'rounded' | 'squircle'

export type CoverPresetId =
  | 'aurora'
  | 'sunset'
  | 'cosmos'
  | 'cyber'
  | 'sakura'
  | 'ocean'
  | 'forest'
  | 'minimal'
  | 'none'

export type BadgeColorId = 'accent' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'sky'

export interface AvatarFrameOption {
  id: AvatarFrameId
  labelKey: string
  gradient: string
  glow?: string
}

export const AVATAR_FRAMES: AvatarFrameOption[] = [
  { id: 'none', labelKey: 'personalization.frame.none', gradient: '' },
  {
    id: 'accent',
    labelKey: 'personalization.frame.accent',
    gradient: 'linear-gradient(135deg, var(--t-accent), color-mix(in srgb, var(--t-accent) 60%, #6366f1))',
    glow: '0 0 14px color-mix(in srgb, var(--t-accent) 45%, transparent)',
  },
  {
    id: 'aurora',
    labelKey: 'personalization.frame.aurora',
    gradient: 'linear-gradient(135deg, #34d399 0%, #06b6d4 50%, #6366f1 100%)',
    glow: '0 0 14px rgba(6, 182, 212, 0.38)',
  },
  {
    id: 'sunset',
    labelKey: 'personalization.frame.sunset',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #f97316 50%, #fbbf24 100%)',
    glow: '0 0 14px rgba(244, 63, 94, 0.35)',
  },
  {
    id: 'neon',
    labelKey: 'personalization.frame.neon',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #38bdf8 100%)',
    glow: '0 0 16px rgba(168, 85, 247, 0.45)',
  },
  {
    id: 'gold',
    labelKey: 'personalization.frame.gold',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #fde047 50%, #d97706 100%)',
    glow: '0 0 14px rgba(245, 158, 11, 0.38)',
  },
  {
    id: 'ocean',
    labelKey: 'personalization.frame.ocean',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #3b82f6 50%, #1d4ed8 100%)',
    glow: '0 0 14px rgba(56, 189, 248, 0.38)',
  },
  {
    id: 'sakura',
    labelKey: 'personalization.frame.sakura',
    gradient: 'linear-gradient(135deg, #f9a8d4 0%, #f43f5e 50%, #c084fc 100%)',
    glow: '0 0 14px rgba(244, 114, 182, 0.38)',
  },
]

export interface CoverPresetOption {
  id: CoverPresetId
  labelKey: string
  background: string
  pattern?: string
  darkText?: boolean
}

export const COVER_PRESETS: CoverPresetOption[] = [
  {
    id: 'aurora',
    labelKey: 'personalization.cover.aurora',
    background:
      'radial-gradient(at 15% 20%, rgba(52, 211, 153, 0.42) 0px, transparent 55%), radial-gradient(at 85% 15%, rgba(99, 102, 241, 0.45) 0px, transparent 55%), radial-gradient(at 50% 90%, rgba(6, 182, 212, 0.35) 0px, transparent 55%), linear-gradient(135deg, #0b132b 0%, #112233 50%, #0f172a 100%)',
  },
  {
    id: 'sunset',
    labelKey: 'personalization.cover.sunset',
    background:
      'radial-gradient(at 20% 20%, rgba(251, 191, 36, 0.38) 0px, transparent 52%), radial-gradient(at 80% 30%, rgba(244, 63, 94, 0.48) 0px, transparent 55%), linear-gradient(135deg, #2a0f1d 0%, #3b1522 50%, #1f1124 100%)',
  },
  {
    id: 'cosmos',
    labelKey: 'personalization.cover.cosmos',
    background:
      'radial-gradient(at 25% 25%, rgba(168, 85, 247, 0.45) 0px, transparent 50%), radial-gradient(at 78% 70%, rgba(56, 189, 248, 0.35) 0px, transparent 50%), linear-gradient(135deg, #090b14 0%, #151129 55%, #0a1020 100%)',
  },
  {
    id: 'cyber',
    labelKey: 'personalization.cover.cyber',
    background:
      'radial-gradient(at 15% 50%, rgba(198, 255, 74, 0.32) 0px, transparent 50%), radial-gradient(at 85% 25%, rgba(20, 184, 166, 0.35) 0px, transparent 55%), linear-gradient(135deg, #0a0c0e 0%, #13191d 60%, #0d1317 100%)',
  },
  {
    id: 'sakura',
    labelKey: 'personalization.cover.sakura',
    background:
      'radial-gradient(at 20% 25%, rgba(244, 114, 182, 0.42) 0px, transparent 55%), radial-gradient(at 80% 30%, rgba(192, 132, 252, 0.42) 0px, transparent 55%), linear-gradient(135deg, #2b1222 0%, #24142c 60%, #1b1121 100%)',
  },
  {
    id: 'ocean',
    labelKey: 'personalization.cover.ocean',
    background:
      'radial-gradient(at 15% 30%, rgba(56, 189, 248, 0.45) 0px, transparent 55%), radial-gradient(at 85% 75%, rgba(59, 130, 246, 0.42) 0px, transparent 55%), linear-gradient(135deg, #07192b 0%, #0c2540 50%, #09182c 100%)',
  },
  {
    id: 'forest',
    labelKey: 'personalization.cover.forest',
    background:
      'radial-gradient(at 20% 30%, rgba(16, 185, 129, 0.4) 0px, transparent 55%), radial-gradient(at 80% 70%, rgba(132, 204, 22, 0.25) 0px, transparent 55%), linear-gradient(135deg, #081c14 0%, #102a1f 55%, #0a1912 100%)',
  },
  {
    id: 'minimal',
    labelKey: 'personalization.cover.minimal',
    background:
      'radial-gradient(at 12% 35%, color-mix(in srgb, var(--t-accent) 34%, transparent) 0px, transparent 55%), radial-gradient(at 88% 65%, color-mix(in srgb, var(--t-accent) 20%, #6366f1) 0px, transparent 60%), linear-gradient(135deg, var(--t-hero-bg, #111317) 0%, color-mix(in srgb, var(--t-hero-bg, #111317) 85%, #1e293b) 100%)',
  },
  {
    id: 'none',
    labelKey: 'personalization.cover.none',
    background: '',
  },
]

export const STATUS_PRESETS: { emoji: string; labelKey: string; defaultText: string }[] = [
  { emoji: '🚀', labelKey: 'personalization.status.flow', defaultText: 'В потоке обучения' },
  { emoji: '🎯', labelKey: 'personalization.status.exam', defaultText: 'Готовлюсь к защите' },
  { emoji: '💻', labelKey: 'personalization.status.coding', defaultText: 'Решаю задачи' },
  { emoji: '📚', labelKey: 'personalization.status.reading', defaultText: 'Изучаю конспекты' },
  { emoji: '☕', labelKey: 'personalization.status.coffee', defaultText: 'На кофе-брейке' },
  { emoji: '🔥', labelKey: 'personalization.status.streak', defaultText: 'Держу ударный темп' },
  { emoji: '💡', labelKey: 'personalization.status.team', defaultText: 'Открыт к проектам' },
  { emoji: '🏆', labelKey: 'personalization.status.goal', defaultText: 'Иду к цели' },
]

export const BADGE_PRESETS: { labelKey: string; defaultText: string; color: BadgeColorId }[] = [
  { labelKey: 'personalization.badge_preset.explorer', defaultText: 'AI Explorer', color: 'violet' },
  { labelKey: 'personalization.badge_preset.solver', defaultText: 'Problem Solver', color: 'emerald' },
  { labelKey: 'personalization.badge_preset.scholar', defaultText: 'Отличник', color: 'amber' },
  { labelKey: 'personalization.badge_preset.builder', defaultText: 'Код-мастер', color: 'sky' },
  { labelKey: 'personalization.badge_preset.mentor', defaultText: 'Ментор', color: 'indigo' },
  { labelKey: 'personalization.badge_preset.sprinter', defaultText: 'Марафонец', color: 'rose' },
]

export const BADGE_COLORS: {
  id: BadgeColorId
  labelKey: string
  bg: string
  text: string
  border: string
  swatch: string
}[] = [
  {
    id: 'accent',
    labelKey: 'personalization.accent.theme',
    bg: 'color-mix(in srgb, var(--t-accent) 20%, var(--t-surface))',
    text: 'var(--t-text)',
    border: 'color-mix(in srgb, var(--t-accent) 55%, var(--t-border))',
    swatch: 'var(--t-accent)',
  },
  {
    id: 'indigo',
    labelKey: 'personalization.accent.indigo',
    bg: 'rgba(99, 102, 241, 0.16)',
    text: 'color-mix(in srgb, #6366f1 80%, var(--t-text))',
    border: 'rgba(99, 102, 241, 0.36)',
    swatch: '#6366f1',
  },
  {
    id: 'emerald',
    labelKey: 'personalization.accent.emerald',
    bg: 'rgba(16, 185, 129, 0.16)',
    text: 'color-mix(in srgb, #10b981 80%, var(--t-text))',
    border: 'rgba(16, 185, 129, 0.36)',
    swatch: '#10b981',
  },
  {
    id: 'rose',
    labelKey: 'personalization.accent.rose',
    bg: 'rgba(244, 63, 94, 0.16)',
    text: 'color-mix(in srgb, #f43f5e 80%, var(--t-text))',
    border: 'rgba(244, 63, 94, 0.36)',
    swatch: '#f43f5e',
  },
  {
    id: 'amber',
    labelKey: 'personalization.accent.amber',
    bg: 'rgba(245, 158, 11, 0.16)',
    text: 'color-mix(in srgb, #f59e0b 80%, var(--t-text))',
    border: 'rgba(245, 158, 11, 0.36)',
    swatch: '#f59e0b',
  },
  {
    id: 'violet',
    labelKey: 'personalization.accent.violet',
    bg: 'rgba(139, 92, 246, 0.16)',
    text: 'color-mix(in srgb, #8b5cf6 80%, var(--t-text))',
    border: 'rgba(139, 92, 246, 0.36)',
    swatch: '#8b5cf6',
  },
  {
    id: 'sky',
    labelKey: 'personalization.accent.sky',
    bg: 'rgba(14, 165, 233, 0.16)',
    text: 'color-mix(in srgb, #0ea5e9 80%, var(--t-text))',
    border: 'rgba(14, 165, 233, 0.36)',
    swatch: '#0ea5e9',
  },
]

export interface CabinetWidgetsConfig {
  showBanner: boolean
  showFocusGoal: boolean
  showContinueHero: boolean
  showStatsRow: boolean
  showDeadlines: boolean
}

export interface UserPersonalization {
  accentColor: string // '' = theme default, or hex like '#6366f1'
  bgPattern: BgPatternId
  radius: RadiusId
  avatarFrame: AvatarFrameId
  avatarShape: AvatarShapeId
  statusEmoji: string
  statusText: string
  customBadge: string
  badgeColor: BadgeColorId
  coverPreset: CoverPresetId
  dailyGoal: string
  weeklyTargetLessons: number
  completedTodayCount: number
  cabinetWidgets: CabinetWidgetsConfig
}

export const DEFAULT_PERSONALIZATION: UserPersonalization = {
  accentColor: '',
  bgPattern: 'none',
  radius: 'default',
  avatarFrame: 'none',
  avatarShape: 'circle',
  statusEmoji: '',
  statusText: '',
  customBadge: '',
  badgeColor: 'accent',
  coverPreset: 'aurora',
  dailyGoal: '',
  weeklyTargetLessons: 5,
  completedTodayCount: 0,
  cabinetWidgets: {
    showBanner: true,
    showFocusGoal: true,
    showContinueHero: true,
    showStatsRow: true,
    showDeadlines: true,
  },
}

// ── Storage Keys & Helpers ───────────────────────────────────────────────────

export const THEME_STORAGE_KEY = 'lh_theme'
export const ACCENT_STORAGE_KEY = 'lh_accent'
export const PATTERN_STORAGE_KEY = 'lh_bg_pattern'
export const RADIUS_STORAGE_KEY = 'lh_radius'
export const PERSONALIZATION_STORAGE_KEY = 'lh_personalization'
export const PERSONALIZATION_EVENT = 'lh-personalization-change'

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && THEMES.some((theme) => theme.id === value)
}

export function getThemeOption(id: ThemeId): ThemeOption {
  return THEMES.find((theme) => theme.id === id) || THEMES[0]
}

export function getStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return 'snow'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(stored) ? stored : 'snow'
  } catch {
    return 'snow'
  }
}

/** Compute readable foreground ink (#0a0a0a or #ffffff) for any hex accent color */
export function computeAccentInk(hex: string): string {
  const clean = hex.replace('#', '').trim()
  if (clean.length !== 6) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#ffffff'
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
  return luminance > 0.36 ? '#0a0a0a' : '#ffffff'
}

function emitPersonalizationChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PERSONALIZATION_EVENT))
}

export function applyTheme(id: ThemeId) {
  if (typeof document === 'undefined') return
  const option = getThemeOption(id)
  document.documentElement.setAttribute('data-theme', id)
  document.documentElement.setAttribute('data-theme-mode', option.mode)
  document.documentElement.classList.toggle('dark', option.mode === 'dark')
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    /* storage blocked: the theme still applies for this session */
  }
  emitPersonalizationChange()
}

export function applyAccentOverride(hex: string) {
  if (typeof document === 'undefined') return
  const validHex = /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim().toLowerCase() : ''
  if (validHex) {
    const preset = ACCENT_PRESETS.find((p) => p.hex.toLowerCase() === validHex)
    const ink = preset?.ink || computeAccentInk(validHex)
    document.documentElement.style.setProperty('--t-accent', validHex)
    document.documentElement.style.setProperty('--t-accent-ink', ink)
  } else {
    document.documentElement.style.removeProperty('--t-accent')
    document.documentElement.style.removeProperty('--t-accent-ink')
  }
  try {
    if (validHex) {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, validHex)
    } else {
      window.localStorage.removeItem(ACCENT_STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function applyBgPattern(pattern: BgPatternId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-bg-pattern', pattern)
  try {
    window.localStorage.setItem(PATTERN_STORAGE_KEY, pattern)
  } catch {
    /* ignore */
  }
}

export function applyRadius(radius: RadiusId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-radius', radius)
  try {
    window.localStorage.setItem(RADIUS_STORAGE_KEY, radius)
  } catch {
    /* ignore */
  }
}

export function getStoredPersonalization(): UserPersonalization {
  if (typeof window === 'undefined') return DEFAULT_PERSONALIZATION
  try {
    const raw = window.localStorage.getItem(PERSONALIZATION_STORAGE_KEY)
    const accent = window.localStorage.getItem(ACCENT_STORAGE_KEY) || ''
    const bgPattern = (window.localStorage.getItem(PATTERN_STORAGE_KEY) as BgPatternId) || 'none'
    const radius = (window.localStorage.getItem(RADIUS_STORAGE_KEY) as RadiusId) || 'default'
    if (!raw) {
      return {
        ...DEFAULT_PERSONALIZATION,
        accentColor: accent,
        bgPattern: BG_PATTERNS.some((p) => p.id === bgPattern) ? bgPattern : 'none',
        radius: RADIUS_OPTIONS.some((r) => r.id === radius) ? radius : 'default',
      }
    }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_PERSONALIZATION,
      ...parsed,
      accentColor: parsed.accentColor ?? accent,
      bgPattern: parsed.bgPattern ?? bgPattern,
      radius: parsed.radius ?? radius,
      cabinetWidgets: {
        ...DEFAULT_PERSONALIZATION.cabinetWidgets,
        ...(parsed.cabinetWidgets || {}),
      },
    }
  } catch {
    return DEFAULT_PERSONALIZATION
  }
}

export function updatePersonalization(patch: Partial<UserPersonalization>): UserPersonalization {
  const current = getStoredPersonalization()
  const next: UserPersonalization = {
    ...current,
    ...patch,
    cabinetWidgets: {
      ...current.cabinetWidgets,
      ...(patch.cabinetWidgets || {}),
    },
  }

  if (patch.accentColor !== undefined) {
    applyAccentOverride(next.accentColor)
  }
  if (patch.bgPattern !== undefined) {
    applyBgPattern(next.bgPattern)
  }
  if (patch.radius !== undefined) {
    applyRadius(next.radius)
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  emitPersonalizationChange()
  return next
}

export function resetPersonalization(): UserPersonalization {
  applyTheme('snow')
  applyAccentOverride('')
  applyBgPattern('none')
  applyRadius('default')
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        PERSONALIZATION_STORAGE_KEY,
        JSON.stringify(DEFAULT_PERSONALIZATION),
      )
    } catch {
      /* ignore */
    }
  }
  emitPersonalizationChange()
  return DEFAULT_PERSONALIZATION
}

interface PersonalizationSnapshot {
  mounted: boolean
  theme: ThemeId
  personalization: UserPersonalization
}

const SERVER_SNAPSHOT: PersonalizationSnapshot = {
  mounted: false,
  theme: 'snow',
  personalization: DEFAULT_PERSONALIZATION,
}

let cachedSnapshotKey = ''
let cachedSnapshot: PersonalizationSnapshot = SERVER_SNAPSHOT

function getClientSnapshot(): PersonalizationSnapshot {
  const theme = getStoredTheme()
  const personalization = getStoredPersonalization()
  const key = `${theme}:${JSON.stringify(personalization)}`
  if (key !== cachedSnapshotKey || !cachedSnapshot.mounted) {
    cachedSnapshotKey = key
    cachedSnapshot = {
      mounted: true,
      theme,
      personalization,
    }
  }
  return cachedSnapshot
}

function getServerSnapshot(): PersonalizationSnapshot {
  return SERVER_SNAPSHOT
}

function subscribePersonalization(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (
      !e.key ||
      e.key === THEME_STORAGE_KEY ||
      e.key === PERSONALIZATION_STORAGE_KEY ||
      e.key === ACCENT_STORAGE_KEY ||
      e.key === PATTERN_STORAGE_KEY ||
      e.key === RADIUS_STORAGE_KEY
    ) {
      callback()
    }
  }
  window.addEventListener(PERSONALIZATION_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PERSONALIZATION_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Reactive hook for reading and updating theme & personalization across all components.
 * Uses useSyncExternalStore so server render and initial hydration match cleanly.
 */
export function usePersonalization() {
  const { mounted, theme, personalization } = useSyncExternalStore(
    subscribePersonalization,
    getClientSnapshot,
    getServerSnapshot,
  )

  const setTheme = useCallback((id: ThemeId) => {
    applyTheme(id)
  }, [])

  const update = useCallback((patch: Partial<UserPersonalization>) => {
    return updatePersonalization(patch)
  }, [])

  const reset = useCallback(() => {
    resetPersonalization()
  }, [])

  const themeOption = getThemeOption(theme)
  const effectiveAccent = personalization.accentColor || themeOption.preview.accent

  return {
    mounted,
    theme,
    themeOption,
    effectiveAccent,
    personalization,
    setTheme,
    update,
    reset,
  }
}
