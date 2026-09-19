import { describe, expect, it } from 'vitest'
import { QrPosterError } from '../src/errors.js'
import { decodePng, rgbaToPng } from '../src/image.js'
import { buildManualRegionMask, detectRegionMask } from '../src/mask.js'
import { prepareEditor, assembleFromBuffers } from '../src/server/editor.js'
import { MAX_IMAGE_BYTES, MAX_PIXELS } from '../src/lib/editor/schema.js'
import {
  BLANK_POSTER_HEIGHT,
  BLANK_POSTER_WIDTH,
  buildBlankMaskRgba,
  buildBlankPosterRgba,
} from '../src/lib/editor/blank.js'

const settings = { seed: 7, qrMargin: 1 as const, plateCorners: 'texture' as const }

describe('blank canvas starter poster', () => {
  it('is a plain white sheet that needs its full-canvas mask', async () => {
    const file = await rgbaToPng(buildBlankPosterRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    expect(file.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
    expect(BLANK_POSTER_WIDTH * BLANK_POSTER_HEIGHT).toBeLessThanOrEqual(MAX_PIXELS)
    const poster = await decodePng(file, 'blank-poster.png', 'poster')
    expect(poster.data.every(value => value === 255)).toBe(true)
    expect(() => detectRegionMask(poster)).toThrowError(QrPosterError)
    const maskFile = await rgbaToPng(buildBlankMaskRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    const maskImage = await decodePng(maskFile, 'blank-mask.png', 'mask')
    const mask = buildManualRegionMask(maskImage, BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    expect(mask.source).toBe('file')
    expect(mask.area).toBe(BLANK_POSTER_WIDTH * BLANK_POSTER_HEIGHT)
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: BLANK_POSTER_WIDTH, height: BLANK_POSTER_HEIGHT })
  })

  it('prepares and assembles the white sheet with its mask', async () => {
    const posterBytes = await rgbaToPng(buildBlankPosterRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    const maskBytes = await rgbaToPng(buildBlankMaskRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    const content = 'https://example.com/qr'
    const prepared = await prepareEditor({ posterBytes, maskBytes, content })
    expect(prepared.validation).toBeNull()
    const result = await assembleFromBuffers({ posterBytes, maskBytes, content, placement: prepared.placement, ...settings })
    expect(result.report.qualified).toBe(true)
  })
})
