import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PALETTE,
  GUARD,
  hexToOklch,
  hexToRgb,
  luma,
  oklchToHex,
  normalizeHex,
  paletteGuard,
  parseHex,
  rgbToOklch,
  suggestPalette,
  type QrPalette,
} from '@mahu-qr/renderer/core/palette'

describe('sRGB ↔ OKLCH', () => {
  it('round-trips inside one quantization step', () => {
    const samples = ['#000000', '#ffffff', '#ff0000', '#00a000', '#0000ff', '#f5c518', '#1b3a6b', '#e94f37', '#2ec4b6']
    for (const hex of samples) {
      const oklch = rgbToOklch(parseHex(hex)!)
      expect(oklchToHex(oklch), hex).toBe(hex)
    }
  })

  it('matches the canonical OKLCH coordinates for the primaries', () => {
    expect(rgbToOklch([255, 0, 0]).l).toBeCloseTo(0.628, 3)
    expect(rgbToOklch([255, 0, 0]).c).toBeCloseTo(0.2577, 3)
    expect(rgbToOklch([255, 0, 0]).h).toBeCloseTo(29.234, 3)
    expect(rgbToOklch([0, 255, 0]).l).toBeCloseTo(0.8664, 3)
    expect(rgbToOklch([0, 255, 0]).h).toBeCloseTo(142.495, 3)
    expect(rgbToOklch([0, 0, 255]).l).toBeCloseTo(0.452, 3)
    expect(rgbToOklch([0, 0, 255]).c).toBeCloseTo(0.3132, 3)
    expect(rgbToOklch([0, 0, 255]).h).toBeCloseTo(264.052, 3)
    expect(rgbToOklch([0, 0, 0])).toMatchObject({ l: 0, c: 0 })
    const white = rgbToOklch([255, 255, 255])
    expect(white.l).toBeCloseTo(1, 6)
    expect(white.c).toBeLessThan(1e-6)
  })

  it('gamut-clamps by reducing chroma, keeping lightness', () => {
    // Far outside sRGB for this lightness: the hex must still be a valid in-gamut color.
    const hex = oklchToHex({ l: 0.9, c: 0.3, h: 300 })
    expect(parseHex(hex)).not.toBeNull()
    expect(hexToOklch(hex)!.l).toBeGreaterThan(0.8)
  })

  it('normalizes mixed-case and 3-digit hex, and rejects the rest', () => {
    expect(normalizeHex('#1A2B3C')).toBe('#1a2b3c')
    expect(normalizeHex('#0af')).toBe('#00aaff')
    expect(parseHex('nope')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
  })
})

describe('palette guard', () => {
  it('accepts the default and suggestion-derived palettes', () => {
    expect(paletteGuard(DEFAULT_PALETTE).ok).toBe(true)
  })

  it('rejects a dark background, light ink, and unparseable colors', () => {
    const dark = paletteGuard({ pixel: '#000000', marker: '#000000', background: '#a0a0a0' })
    expect(dark.ok).toBe(false)
    expect(dark.issues.length).toBe(1)
    expect(dark.issues[0]!.color).toBe('background')

    const light = paletteGuard({ ...DEFAULT_PALETTE, pixel: '#c0c0c0' })
    expect(light.ok).toBe(false)
    expect(light.issues.some((issue) => issue.color === 'pixel' && issue.message.includes('light to read'))).toBe(true)

    const broken = paletteGuard({ pixel: 'oops', marker: '#000000', background: '#ffffff' })
    expect(broken.ok).toBe(false)
  })

  it('rejects an ink with too little lightness separation from the background', () => {
    const muddy = { pixel: '#202020', marker: '#000000', background: '#2f4f4f' }
    expect(paletteGuard(muddy).ok).toBe(false)
  })
})

describe('OKLCH suggestions', () => {
  it('keeps the default palette canonical for a black pixel', () => {
    expect(suggestPalette('#000000')).toEqual({ marker: '#000000', background: '#ffffff' })
  })

  it('is deterministic and keeps hues together', () => {
    for (const pixel of ['#e94f37', '#1a237e', '#2e7d32', '#f5c518']) {
      const first = suggestPalette(pixel)
      const second = suggestPalette(pixel)
      expect(first).toEqual(second)
      const { c, h } = hexToOklch(pixel)!
      const marker = hexToOklch(first.marker)!
      const background = hexToOklch(first.background)!
      expect(first.marker).not.toBe(pixel)
      if (c > 0.01) {
        // Same-family hues: the marker keeps the same hue, chroma may be gamut-clamped downwards.
        expect(marker.c).toBeLessThan(c + 0.005)
        expect(Math.abs(hexToOklch(first.marker)!.h - h)).toBeLessThan(3)
        expect(background.c).toBeLessThan(0.04 + 0.005)
        expect(Math.abs(hexToOklch(first.background)!.h - h)).toBeLessThan(3)
      }
    }
  })

  it('suggests exactly white for achromatic pixels', () => {
    expect(suggestPalette('#404040').background).toBe('#ffffff')
    expect(suggestPalette('#ffffff').background).toBe('#ffffff')
  })

  it('always suggests palettes that pass the guard and separate in lightness', () => {
    const pixels = ['#000000', '#123a5f', '#b0413e', '#0f7b6c', '#8a6d1c', '#3d1160', '#0057b8']
    for (const pixel of pixels) {
      const suggestion: QrPalette = { pixel, ...suggestPalette(pixel) }
      const verdict = paletteGuard(suggestion)
      expect(verdict.issues).toEqual([])
      expect(luma(hexToRgb(suggestion.background))).toBeGreaterThanOrEqual(GUARD.lightLumaMin)
      expect(luma(hexToRgb(suggestion.marker))).toBeLessThanOrEqual(GUARD.inkLumaMax)
      expect(luma(hexToRgb(suggestion.pixel))).toBeLessThanOrEqual(GUARD.inkLumaMax)
      // Suggestions are darker than the base pixels for light inks, and lighter backgrounds.
      expect(hexToOklch(suggestion.marker)!.l).toBeLessThanOrEqual(hexToOklch(pixel)!.l)
      expect(hexToOklch(suggestion.background)!.l).toBeGreaterThan(0.9)
    }
  })

  it('suggests distinct families for different pixel hues', () => {
    const blue = suggestPalette('#0056b8')
    const red = suggestPalette('#b00020')
    expect(blue.marker).not.toBe(red.marker)
    expect(blue.background).not.toBe(red.background)
  })
})
