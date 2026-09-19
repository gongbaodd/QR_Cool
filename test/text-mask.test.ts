import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TEXT_MASK_DEFAULT_TEXT,
  TEXT_MASK_FILENAME,
  TEXT_MASK_FONTS,
  defaultTextMaskSize,
  fitTextMaskSize,
  largestWhiteSquare,
} from '../src/lib/editor/text-mask.js'

describe('text mask fonts', () => {
  it('lists bundled fonts with files served from public/', () => {
    expect(TEXT_MASK_FONTS.length).toBeGreaterThan(0)
    for (const font of TEXT_MASK_FONTS) {
      expect(font.id.trim().length).toBeGreaterThan(0)
      expect(font.family.trim().length).toBeGreaterThan(0)
      expect(font.file.startsWith('/fonts/')).toBe(true)
      expect(existsSync(`public${font.file}`)).toBe(true)
    }
    expect(TEXT_MASK_FILENAME).toBe('text-mask.png')
    expect(TEXT_MASK_DEFAULT_TEXT.trim().length).toBeGreaterThan(0)
  })

  it('defaults the cap to the poster height so words fill the region', () => {
    expect(defaultTextMaskSize(1000, 1000)).toBe(1000)
    expect(defaultTextMaskSize(688, 566)).toBe(566)
    expect(defaultTextMaskSize(20, 20)).toBe(20)
    expect(defaultTextMaskSize(10, 4)).toBe(16)
  })

  it('shrinks over-wide lines to fit and leaves fitting text alone', () => {
    expect(fitTextMaskSize(() => 100, 200, 64)).toBe(64)
    expect(fitTextMaskSize(() => 400, 200, 64)).toBe(32)
    expect(fitTextMaskSize(() => 0, 200, 64)).toBe(64)
    expect(fitTextMaskSize(() => 100000, 10, 64)).toBe(8)
  })

  it('finds the largest white square with the server selection rule', () => {
    // 10x6 canvas, opaque white rect x=2..6, y=1..4 -> largest square 4.
    const pixels = new Uint8ClampedArray(10 * 6 * 4)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
      const offset = (y * 10 + x) * 4
      const white = x >= 2 && x <= 6 && y >= 1 && y <= 4
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = white ? 255 : 0
      pixels[offset + 3] = 255
    }
    expect(largestWhiteSquare(pixels, 10, 6)).toBe(4)
    // Transparent white and dim gray do not count.
    const faint = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    for (let i = 0; i < 16; i++) faint[i * 4 + 3] = 0
    expect(largestWhiteSquare(faint, 4, 4)).toBe(0)
    const gray = new Uint8ClampedArray([100, 100, 100, 255])
    expect(largestWhiteSquare(gray, 1, 1)).toBe(0)
    const exact = new Uint8ClampedArray([128, 128, 128, 128])
    expect(largestWhiteSquare(exact, 1, 1)).toBe(1)
  })
})
