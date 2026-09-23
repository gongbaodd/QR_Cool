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
  it('is transparent and uses a separate full-canvas mask', async () => {
    const file = await rgbaToPng(buildBlankPosterRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    expect(file.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
    expect(BLANK_POSTER_WIDTH * BLANK_POSTER_HEIGHT).toBeLessThanOrEqual(MAX_PIXELS)
    const poster = await decodePng(file, 'blank-poster.png', 'poster')
    let transparent = true
    for (let offset = 0; offset < poster.data.length; offset += 4) {
      if (poster.data[offset + 3] !== 0) transparent = false
    }
    expect(transparent).toBe(true)
    expect(() => detectRegionMask(poster)).toThrowError(QrPosterError)
    const maskFile = await rgbaToPng(buildBlankMaskRgba(), BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    const maskImage = await decodePng(maskFile, 'blank-mask.png', 'mask')
    const mask = buildManualRegionMask(maskImage, BLANK_POSTER_WIDTH, BLANK_POSTER_HEIGHT)
    expect(mask.source).toBe('file')
    expect(mask.area).toBe(BLANK_POSTER_WIDTH * BLANK_POSTER_HEIGHT)
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: BLANK_POSTER_WIDTH, height: BLANK_POSTER_HEIGHT })
  })

  it('assembles white-backed texture modules and an opaque QR plate over transparency', async () => {
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
      await session.assemble(
        { posterBytes, maskBytes, content, placement: prepared.placement, transparentBlank: true, ...settings },
        1,
      ),
    )
    expect(result.report.qualified).toBe(true)
    expect(result.report.verification.checks.find((check) => check.name === 'transparentBackground')?.passed).toBe(true)

    const posterResult = await decodePng(
      new Uint8Array(await result.artifacts['poster.png']!.arrayBuffer()),
      'assembled.png',
      'assembled poster',
    )
    let transparent = 0
    let opaqueBlack = 0
    let opaqueWhite = 0
    let partial = 0
    for (let offset = 0; offset < posterResult.data.length; offset += 4) {
      const alpha = posterResult.data[offset + 3]!
      if (alpha === 0) transparent++
      else if (alpha === 255 && posterResult.data[offset] === 0) opaqueBlack++
      else if (alpha === 255 && posterResult.data[offset] === 255) opaqueWhite++
      else partial++
    }
    expect(transparent).toBeGreaterThan(0)
    expect(opaqueBlack).toBeGreaterThan(0)
    expect(opaqueWhite).toBeGreaterThan(0)
    expect(partial).toBeGreaterThan(0)

    const cut = await decodePng(
      new Uint8Array(await result.artifacts['pattern-cut.png']!.arrayBuffer()),
      'pattern-cut.png',
      'pattern cut',
    )
    let transparentCutPixels = 0
    let inkCutPixels = 0
    let whiteCutPixels = 0
    for (let offset = 3; offset < cut.data.length; offset += 4) {
      if (cut.data[offset] === 0) transparentCutPixels++
      if (cut.data[offset]! > 0) inkCutPixels++
      if (
        cut.data[offset] === 255 &&
        cut.data[offset - 1] === 255 &&
        cut.data[offset - 2] === 255 &&
        cut.data[offset - 3] === 255
      )
        whiteCutPixels++
    }
    expect(transparentCutPixels).toBeGreaterThan(0)
    expect(inkCutPixels).toBeGreaterThan(0)
    expect(whiteCutPixels).toBeGreaterThan(0)

    const rotated = assertOk(
      await session.assemble(
        {
          posterBytes,
          maskBytes,
          content,
          placement: { ...prepared.placement, rotation: 45 },
          transparentBlank: true,
          ...settings,
          rimRounded: true,
        },
        2,
      ),
    )
    expect(rotated.report.qualified).toBe(true)
    expect(rotated.report.verification.checks.find((check) => check.name === 'transparentBackground')?.passed).toBe(
      true,
    )
  })
})
