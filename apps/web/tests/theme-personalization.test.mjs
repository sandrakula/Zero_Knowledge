import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import {
  ACCENT_PRESETS,
  AVATAR_FRAMES,
  COVER_PRESETS,
  THEMES,
  computeAccentInk,
  isThemeId,
} from '../lib/theme.ts'

const webRoot = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(webRoot, p), 'utf8')

describe('theme & personalization system', () => {
  test('lib/theme.ts, public/theme-init.js and styles/globals.css declare the same themes', () => {
    const initSrc = read('public/theme-init.js')
    const cssSrc = read('styles/globals.css')

    const lightMatch = initSrc.match(/var LIGHT_THEMES = \[([^\]]+)\]/)
    const darkMatch = initSrc.match(/var DARK_THEMES = \[([^\]]+)\]/)
    expect(lightMatch).not.toBeNull()
    expect(darkMatch).not.toBeNull()

    const initLight = [...lightMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    const initDark = [...darkMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])

    const libLight = THEMES.filter((t) => t.mode === 'light').map((t) => t.id)
    const libDark = THEMES.filter((t) => t.mode === 'dark').map((t) => t.id)

    expect(initLight).toEqual(libLight)
    expect(initDark).toEqual(libDark)

    for (const theme of THEMES) {
      expect(isThemeId(theme.id)).toBe(true)
      expect(cssSrc).toContain(`html[data-theme='${theme.id}']`)
    }
  })

  test('every theme and accent preset has valid hex colors and contrasting ink', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/
    for (const theme of THEMES) {
      expect(theme.preview.bg).toMatch(hexRegex)
      expect(theme.preview.surface).toMatch(hexRegex)
      expect(theme.preview.surface2).toMatch(hexRegex)
      expect(theme.preview.border).toMatch(hexRegex)
      expect(theme.preview.text).toMatch(hexRegex)
      expect(theme.preview.accent).toMatch(hexRegex)
      expect(theme.preview.ink).toMatch(hexRegex)
      expect(theme.preview.heroBg).toMatch(hexRegex)
    }

    for (const preset of ACCENT_PRESETS) {
      if (preset.id === 'theme') continue
      expect(preset.hex).toMatch(hexRegex)
      expect(preset.ink).toMatch(hexRegex)
    }

    expect(computeAccentInk('#c6ff4a')).toBe('#0a0a0a')
    expect(computeAccentInk('#fbbf24')).toBe('#0a0a0a')
    expect(computeAccentInk('#6366f1')).toBe('#ffffff')
    expect(computeAccentInk('#1d4ed8')).toBe('#ffffff')
  })

  test('avatar frames and cover presets are populated', () => {
    expect(AVATAR_FRAMES.length).toBeGreaterThanOrEqual(8)
    expect(COVER_PRESETS.length).toBeGreaterThanOrEqual(8)
  })
})
