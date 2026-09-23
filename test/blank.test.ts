import { describe, expect, it } from 'vitest'
import { QrPosterError } from '@/core/errors'
import { decodePng, rgbaToPng } from '@/core/image'
import { buildManualRegionMask, detectRegionMask } from '@/core/mask'
import { createEditorEngine, type EngineOutcome } from '@/lib/editor/engine'
import { nodeImaging } from '@/core/imaging/node'
import { MAX_IMAGE_BYTES, MAX_PIXELS } from '@/lib/editor/schema'
import { BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH, buildBlankMaskRgba, buildBlankPosterRgba } from '@/lib/editor/blank'

const settings = { seed: 7, qrMargin: 1 as const, plateCorners: 'texture' as const }

describe('blank canvas starter poster', () => {
  it('is a plain white sheet that needs its full-canvas mask', async () => {
    const file = await rgbaToPng(buildBlankPosterRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    expect(file.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
    expect(BLANK_POSTER_WIDTH * BLANK_POSTER_HEIGHT).toBeLessThanOrEqual(MAX_PIXELS)
    const poster = await decodePng(file, 'blank-poster.png', 'poster')
    expect(poster.data.every((value) => value === 255)).toBe(true)
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
    const session = await createEditorEngine(nodeImaging)
    /** Same outcome unwrap as the parity harness. */
    function assertOk<T>(outcome: EngineOutcome<T>): T {
      if (!outcome.ok) throw new Error(`engine run failed: ${JSON.stringify(outcome)}`)
      return outcome.value
    }
    const prepared = assertOk(await session.prepare({ posterBytes, maskBytes, content }, 1))
    expect(prepared.validation).toBeNull()
    const result = assertOk(
      await session.assemble({ posterBytes, maskBytes, content, placement: prepared.placement, ...settings }, 1),
    )
    expect(result.report.qualified).toBe(true)
  })
})
