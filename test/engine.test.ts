import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { createEditorEngine } from '@/lib/editor/engine'
import type { EditorEngineApi, EngineOutcome } from '@/lib/editor/engine'
import type { Imaging } from '@/core/imaging/types'
import { nodeImaging } from '@/core/imaging/node'
import { requestSchema } from '@/lib/editor/schema'
import { buildModuleLattice, computeRegionBands, computeSafeArea } from '@/core/module-cut'
import { prepareSource } from '@/lib/editor/engine/pipeline'

const posterBytes = new Uint8Array(await readFile('source/poster.png'))
const content = 'https://example.com/qr'
const settings = {
  seed: 42,
  qrMargin: 1 as const,
  plateCorners: 'texture' as const,
  rimModules: 4 as const,
  rimRounded: false as const,
}

const makeEngine = (): Promise<EditorEngineApi> => createEditorEngine(nodeImaging)

function assertOk<T>(outcome: EngineOutcome<T>): T {
  if (!outcome.ok) throw new Error(`Expected engine success, got: ${JSON.stringify(outcome)}`)
  return outcome.value
}

function assertError<T>(outcome: EngineOutcome<T>): { code: string; message: string; field?: string | undefined } {
  if (outcome.ok) throw new Error('Expected an engine error outcome')
  if (!('error' in outcome)) throw new Error('Expected an engine error outcome')
  return outcome.error
}

/** Wraps an Imaging backend with decode/hash counters for cache-reuse assertions. */
function countDecodes() {
  let decodeCalls = 0
  const wrapped: Imaging = {
    ...nodeImaging,
    decodePng: (file) => {
      decodeCalls++
      return nodeImaging.decodePng(file)
    },
    sha256Hex: (input) => nodeImaging.sha256Hex(input),
  }
  return {
    imaging: wrapped,
    get decodeCalls() {
      return decodeCalls
    },
  }
}

/** Hashes a Blob's bytes with the Node backend, so Blob payloads can be pinned to report hashes. */
async function sessionDigest(blob: Blob): Promise<string> {
  return nodeImaging.sha256Hex(new Uint8Array(await blob.arrayBuffer()))
}

describe('engine pipeline: artifact parity with the former server orchestration', () => {
  it('preserves the poster bytes and exports a transparent QR with logical input names', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    const result = assertOk(
      await session.assemble({ posterBytes, content, placement: prepared.placement, ...settings }, 1),
    )
    // The 0° poster remains pinned to its pre-rotated-fill baseline; the standalone QR is now
    // transparent, while assembly continues to use the opaque normalized QR for its plate.
    expect(result.report.artifacts.posterSha256).toBe(
      '5a76e5608b37cce8f319ae821265fc06866117d4caba47972947dcf117f056f7',
    )
    expect(result.report.artifacts.qrSha256).toBe(await sessionDigest(result.artifacts['qr.png']!))
    const preparedQr = await nodeImaging.decodePng(new Uint8Array(await prepared.qr.arrayBuffer()))
    const exportedQr = await nodeImaging.decodePng(new Uint8Array(await result.artifacts['qr.png']!.arrayBuffer()))
    expect(preparedQr.data[3]).toBe(0)
    expect(exportedQr.data[3]).toBe(0)
    expect(exportedQr.data.some((_, index) => index % 4 === 3 && exportedQr.data[index] === 255)).toBe(true)
    // The cut artifacts pin the original pre-refactor values.
    expect(result.report.artifacts.patternCutPngSha256).toBe(
      'b12c1d01da2b7a308b693aef06532c8c65c8bb2b9810777cef082d2ca685734a',
    )
    expect(result.report.artifacts.patternCutSvgSha256).toBe(
      '315d8de182da76e78c511845e5f134b3fd633c0fb6141ac49e443644db27f1b5',
    )
    expect(result.report.inputs.poster.path).toBe('poster.png')
    expect(result.report.verification.checks.every((c) => c.passed)).toBe(true)
    expect(result.report.schemaVersion).toBe(8)
  })

  it('carries preview/result images as Blobs with the artifact-implied mime types', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    expect(prepared.mask.type).toBe('image/png')
    expect(prepared.overlay.type).toBe('image/png')
    expect(prepared.qr.type).toBe('image/png')
    expect(prepared.mask.size).toBeGreaterThan(0)
    const result = assertOk(
      await session.assemble({ posterBytes, content, placement: prepared.placement, ...settings }, 1),
    )
    expect(result.artifacts['poster.png']!.type).toBe('image/png')
    expect(result.artifacts['pattern-cut.png']!.type).toBe('image/png')
    expect(result.artifacts['pattern-cut.svg']!.type).toBe('image/svg+xml')
    expect(result.artifacts['report.json']!.type).toBe('application/json')
    // The artifact Blobs must encode the exact same bytes the report hashes describe.
    const posterSha = await sessionDigest(result.artifacts['poster.png']!)
    expect(posterSha).toBe(result.report.artifacts.posterSha256!)
  })

  it('preserves whitespace and refuses to move an invalid manual placement', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content: '  hello  ' }, 1))
    const result = assertOk(
      await session.assemble({ posterBytes, content: '  hello  ', placement: prepared.placement, ...settings }, 1),
    )
    expect(result.report.verification.expectedText).toBe('  hello  ')
    const rejected = await session.assemble(
      { posterBytes, content, placement: { x: 0, y: 0, size: 145 }, ...settings },
      1,
    )
    expect(rejected.ok).toBe(false)
    expect(assertError(rejected)).toMatchObject({ code: 'QR_LAYOUT_INVALID', field: 'placement' })
  })

  it('verifies both corner treatments with 1-module margin', async () => {
    for (const plateCorners of ['texture', 'light'] as const) {
      const session = await makeEngine()
      const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
      const r = assertOk(
        await session.assemble(
          {
            posterBytes,
            content,
            placement: prepared.placement,
            ...settings,
            qrMargin: 1,
            plateCorners,
          } as Parameters<EditorEngineApi['assemble']>[0],
          1,
        ),
      )
      expect(r.report.qualified).toBe(true)
      expect(r.report.qrPlate.marginModules).toBe(1)
      expect(r.report.phoneScan).toBe('untested')
      expect(r.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    }
  })

  it('paints a one-module light margin along the selected region without widening the QR plate', async () => {
    const session = await makeEngine()
    const prepared = assertOk(
      await session.prepare(
        {
          posterBytes,
          content,
          settings: { ...settings, regionMargin: true },
        },
        1,
      ),
    )
    const result = assertOk(
      await session.assemble(
        {
          posterBytes,
          content,
          placement: prepared.placement,
          ...settings,
          regionMargin: true,
        },
        1,
      ),
    )
    const pitch = result.report.cut.modulePixels
    expect(result.report.qualified).toBe(true)
    expect(result.report.qrPlate.band).toBe('markers')
    expect(result.report.cut.regionMarginModules).toBe(1)
    expect(result.report.shape.marginModules).toBeGreaterThan(0)
    expect(result.report.shape.rimModules).toBeGreaterThan(0)
    const source = await prepareSource(nodeImaging, posterBytes)
    const lattice = buildModuleLattice(source.poster.width, source.poster.height, pitch, result.report.placement)
    const safe = computeSafeArea(source.regionMask.data, source.poster.width, source.poster.height, lattice)
    const { margin, rim } = computeRegionBands(safe.safe, lattice, settings.rimModules, true)
    const poster = await nodeImaging.decodePng(new Uint8Array(await result.artifacts['poster.png']!.arrayBuffer()))
    let checked = 0
    for (let index = 0; index < margin.length; index++) {
      if (!margin[index]) continue
      const x = lattice.x + (index % lattice.columns) * pitch
      const y = lattice.y + Math.floor(index / lattice.columns) * pitch
      if (
        x >= prepared.placement.x &&
        x < prepared.placement.x + prepared.placement.size &&
        y >= prepared.placement.y &&
        y < prepared.placement.y + prepared.placement.size
      )
        continue
      expect(rim[index]).toBe(0)
      const offset = (y * poster.width + x) * 4
      expect(poster.data.slice(offset, offset + 4)).toEqual([255, 255, 255, 255])
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each([0, 1, 2, 3, 4, 5] as const)('verifies rim thickness %i with antialiasing off/on', async (rimModules) => {
    for (const rimRounded of [false, true] as const) {
      const session = await makeEngine()
      const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
      const r = assertOk(
        await session.assemble(
          {
            posterBytes,
            content,
            placement: prepared.placement,
            ...settings,
            rimModules,
            rimRounded,
          } as Parameters<EditorEngineApi['assemble']>[0],
          1,
        ),
      )
      expect(r.report.qualified).toBe(true)
      expect(r.report.cut.rim.modules).toBe(rimModules)
      expect(r.report.cut.edgeBlend).toBe(rimRounded ? 'antialiased' : 'cell-aligned-over-original')
    }
  })

  it('finds a smaller assembly-valid automatic placement on a small poster', async () => {
    const session = await makeEngine()
    const small = new Uint8Array(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: 'white' } })
        .png()
        .toBuffer(),
    )
    const mask = new Uint8Array(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: 'black' } })
        .composite([
          {
            input: await sharp({ create: { width: 220, height: 220, channels: 4, background: 'white' } })
              .png()
              .toBuffer(),
            left: 10,
            top: 10,
          },
        ])
        .png()
        .toBuffer(),
    )
    const prepared = assertOk(await session.prepare({ posterBytes: small, maskBytes: mask, content, settings }, 1))
    expect(prepared.placement.size).toBeLessThan(203)
    const r = assertOk(
      await session.assemble(
        { posterBytes: small, maskBytes: mask, content, placement: prepared.placement, ...settings },
        1,
      ),
    )
    expect(r.report.qualified).toBe(true)
  })

  it('revalidates longer content around the previous center and never exports an obsolete QR', async () => {
    const session = await makeEngine()
    const original = assertOk(await session.prepare({ posterBytes, content }, 1))
    const changed = assertOk(
      await session.prepare(
        {
          posterBytes,
          content: 'a'.repeat(140),
          placement: original.placement,
          previousTotalModules: original.qrMetadata.totalModules,
        },
        2,
      ),
    )
    expect(changed.qrMetadata.totalModules).toBeGreaterThan(original.qrMetadata.totalModules)
    expect(changed.placement.x + changed.placement.size / 2).toBeCloseTo(
      original.placement.x + original.placement.size / 2,
      0,
    )
    expect(changed.validation).not.toBeNull()
  })

  it('keeps an error-correction resize on the canvas so the editor can send it back', async () => {
    const session = await makeEngine()
    const blank = new Uint8Array(
      await sharp({ create: { width: 1000, height: 1000, channels: 4, background: 'white' } })
        .png()
        .toBuffer(),
    )
    const input = { posterBytes: blank, maskBytes: blank, content: 'https://example.com' }
    const medium = assertOk(await session.prepare({ ...input, settings: { ...settings, ecc: 'M' as const } }, 1))
    const high = assertOk(
      await session.prepare(
        {
          ...input,
          settings: { ...settings, ecc: 'H' as const },
          placement: medium.placement,
          previousTotalModules: medium.qrMetadata.totalModules,
        },
        2,
      ),
    )
    // H needs more modules than M; the resized box stays on the canvas instead of
    // rounding to a negative origin the request schema would reject as a 400.
    expect(high.qrMetadata.totalModules).toBeGreaterThan(medium.qrMetadata.totalModules)
    expect(high.placement.x).toBeGreaterThanOrEqual(0)
    expect(high.placement.y).toBeGreaterThanOrEqual(0)
    expect(
      requestSchema.safeParse({
        revision: 0,
        content: input.content,
        settings: { ...settings, ecc: 'H' },
        placement: high.placement,
      }).success,
    ).toBe(true)
    expect(high.validation).not.toBeNull()
    // Returning to M recovers a valid placement instead of leaving the editor stranded.
    const back = assertOk(
      await session.prepare(
        {
          ...input,
          settings: { ...settings, ecc: 'M' as const },
          placement: high.placement,
          previousTotalModules: high.qrMetadata.totalModules,
        },
        3,
      ),
    )
    expect(back.validation).toBeNull()
  })
})

describe('engine error mapping', () => {
  it('rejects invalid content with the content field', async () => {
    const session = await makeEngine()
    for (const value of ['', ' \t ', 'line\nline', 'x'.repeat(9000)]) {
      const outcome = await session.prepare({ posterBytes, content: value, settings }, 1)
      expect(assertError(outcome)).toMatchObject({ code: 'REQUEST_INVALID', field: 'content' })
    }
  })

  it('rejects corrupt PNG, wrong mask size, and missing region', async () => {
    const session = await makeEngine()
    const white = new Uint8Array(
      await sharp({ create: { width: 30, height: 30, channels: 4, background: 'white' } })
        .png()
        .toBuffer(),
    )
    const corrupt = await session.prepare({ posterBytes: new Uint8Array(Buffer.from('bad')), content, settings }, 1)
    expect(assertError(corrupt)).toMatchObject({ code: 'PNG_INVALID', field: 'poster' })
    // Mask larger than the poster: the source-level mask build rejects the mismatch.
    const maskSize = await session.prepare({ posterBytes, maskBytes: white, content, settings }, 1)
    expect(assertError(maskSize).code).not.toBe('')
    // No solid black region on a white poster: detection cannot fit any QR plate.
    const noRegion = await session.prepare({ posterBytes: white, content, settings }, 1)
    expect(assertError(noRegion).code).not.toBe('')
  })

  it('rejects pixel-limit and actual encoder capacity violations', async () => {
    const session = await makeEngine()
    const huge = new Uint8Array(
      await sharp({ create: { width: 2001, height: 2000, channels: 3, background: 'black' } })
        .png()
        .toBuffer(),
    )
    const limit = await session.prepare({ posterBytes: huge, content, settings }, 1)
    expect(assertError(limit).code).not.toBe('')
    const overflow = await session.prepare({ posterBytes, content: 'a'.repeat(4000), settings }, 1)
    expect(assertError(overflow)).toMatchObject({ field: 'content' })
  })
})

describe('engine session cache', () => {
  it('reuses decoded poster and region across edits that only move the placement', async () => {
    const counted = countDecodes()
    const session = await createEditorEngine(counted.imaging)
    const first = assertOk(await session.prepare({ posterBytes, content }, 1))
    const afterFirst = counted.decodeCalls
    expect(afterFirst).toBeGreaterThan(0)
    const nudge = { ...first.placement, x: first.placement.x + 12 }
    const second = assertOk(await session.prepare({ posterBytes, content, placement: nudge }, 2))
    expect(counted.decodeCalls).toBe(afterFirst) // placement edits do not re-decode
    expect(second.placement.x).toBe(first.placement.x + 12)
    const third = assertOk(await session.prepare({ posterBytes, content: 'changed text', settings }, 3))
    expect(counted.decodeCalls).toBe(afterFirst + 1) // exactly the new content's QR decode; no re-detected region
    expect(third.qrMetadata.version).toBeGreaterThan(0)
  })

  it('re-decodes when the poster file actually changes', async () => {
    const counted = countDecodes()
    const session = await createEditorEngine(counted.imaging)
    await session.prepare({ posterBytes, content }, 1)
    const afterFirst = counted.decodeCalls
    const blank = new Uint8Array(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: 'white' } })
        .png()
        .toBuffer(),
    )
    assertOk(await session.prepare({ posterBytes: blank, maskBytes: blank, content }, 2))
    expect(counted.decodeCalls).toBeGreaterThan(afterFirst)
  })
})

describe('engine pattern colors', () => {
  const palette = { pixel: '#0d47a1', marker: '#06305e', background: '#eef3fa' }
  const coloredSettings: Parameters<EditorEngineApi['assemble']>[0] = { ...settings, colors: palette }

  it('assembles a colored poster through every verification check and records the palette', async () => {
    const session = await makeEngine()
    const prepared = assertOk(
      await session.prepare({ posterBytes, content, settings: { ...settings, colors: palette } }, 1),
    )
    const result = assertOk(
      await session.assemble({ posterBytes, content, placement: prepared.placement, ...coloredSettings }, 1),
    )
    expect(result.report.verification.checks.every((c) => c.passed)).toBe(true)
    expect(result.report.pattern.colors).toEqual(palette)
    // The prepared transparent QR keeps its colored ink: a pixel with the ink RGB stays opaque.
    const qrPng = await nodeImaging.decodePng(new Uint8Array(await prepared.qr.arrayBuffer()))
    const [inkR, inkG, inkB] = [0x0d, 0x47, 0xa1]
    let inkPixels = 0
    for (let offset = 0; offset < qrPng.data.length; offset += 4) {
      if (
        qrPng.data[offset] === inkR &&
        qrPng.data[offset + 1] === inkG &&
        qrPng.data[offset + 2] === inkB &&
        qrPng.data[offset + 3] === 255
      )
        inkPixels++
    }
    expect(inkPixels).toBeGreaterThan(0)
  })

  it('reuses the QR bundle for equal colors and regenerates it when the colors change', async () => {
    const session = await makeEngine()
    const digest = async (blob: Blob): Promise<string> =>
      nodeImaging.sha256Hex(new Uint8Array(await blob.arrayBuffer()))
    const first = assertOk(
      await session.prepare({ posterBytes, content, settings: { ...settings, colors: palette } }, 1),
    )
    const second = assertOk(
      await session.prepare({ posterBytes, content, settings: { ...settings, colors: palette } }, 2),
    )
    expect(await digest(second.qr)).toBe(await digest(first.qr))
    const alt = { ...palette, pixel: '#101c2c', marker: '#06305e', background: '#f2f5f8' }
    const third = assertOk(await session.prepare({ posterBytes, content, settings: { ...settings, colors: alt } }, 3))
    expect(await digest(third.qr)).not.toBe(await digest(first.qr))
  })

  it('paints the region margin ring and rim cells in the palette colors', async () => {
    const session = await makeEngine()
    const prepared = assertOk(
      await session.prepare(
        { posterBytes, content, settings: { ...settings, colors: palette, regionMargin: true } },
        1,
      ),
    )
    const result = assertOk(
      await session.assemble(
        {
          posterBytes,
          content,
          placement: prepared.placement,
          ...coloredSettings,
          regionMargin: true,
        },
        1,
      ),
    )
    const pitch = result.report.cut.modulePixels
    expect(result.report.qualified).toBe(true)
    const source = await prepareSource(nodeImaging, posterBytes)
    const lattice = buildModuleLattice(source.poster.width, source.poster.height, pitch, result.report.placement)
    const safe = computeSafeArea(source.regionMask.data, source.poster.width, source.poster.height, lattice)
    const { margin, rim } = computeRegionBands(safe.safe, lattice, settings.rimModules, true)
    const poster = await nodeImaging.decodePng(new Uint8Array(await result.artifacts['poster.png']!.arrayBuffer()))
    let marginChecked = 0
    for (let index = 0; index < margin.length; index++) {
      if (!margin[index]) continue
      const x = lattice.x + (index % lattice.columns) * pitch
      const y = lattice.y + Math.floor(index / lattice.columns) * pitch
      if (
        x >= prepared.placement.x &&
        x < prepared.placement.x + prepared.placement.size &&
        y >= prepared.placement.y &&
        y < prepared.placement.y + prepared.placement.size
      )
        continue
      expect(rim[index]).toBe(0)
      const offset = (y * poster.width + x) * 4
      expect(Array.from(poster.data.slice(offset, offset + 4))).toEqual([0xee, 0xf3, 0xfa, 255])
      marginChecked++
    }
    expect(marginChecked).toBeGreaterThan(0)
    // Rim modules are forced dark: 'dot' geometry puts ink exactly at the module center.
    const rimCenter = (y: number, x: number): number =>
      ((y + Math.floor(pitch / 2)) * poster.width + x + Math.floor(pitch / 2)) * 4
    let rimChecked = 0
    for (let index = 0; index < rim.length; index++) {
      if (!rim[index]) continue
      const x = lattice.x + (index % lattice.columns) * pitch
      const y = lattice.y + Math.floor(index / lattice.columns) * pitch
      // Rim modules under the plate hole are never drawn; only painted rim cells are checked.
      if (
        x >= prepared.placement.x &&
        x < prepared.placement.x + prepared.placement.size &&
        y >= prepared.placement.y &&
        y < prepared.placement.y + prepared.placement.size
      )
        continue
      const offset = rimCenter(y, x)
      expect(poster.data.slice(offset, offset + 3).join()).toBe([0x0d, 0x47, 0xa1].join())
      rimChecked++
    }
    expect(rimChecked).toBeGreaterThan(0)
  })

  it('rejects an unscannable palette before generation with COLOR_INVALID on the colors field', async () => {
    const session = await makeEngine()
    const outcome = await session.prepare(
      {
        posterBytes,
        content,
        settings: { ...settings, colors: { pixel: '#c0c0c0', marker: '#000000', background: '#ffffff' } },
      },
      1,
    )
    expect(assertError(outcome)).toMatchObject({ code: 'COLOR_INVALID', field: 'colors' })
  })
})

describe('engine stale-revision suppression', () => {
  it('drops the settled result of an older revision when a newer one was requested', async () => {
    const session = await makeEngine()
    const old = session.prepare({ posterBytes, content }, 1)
    const fresh = session.prepare({ posterBytes, content: 'newer content' }, 2)
    expect((await old).ok).toBe(false)
    const oldSettled: EngineOutcome<unknown> = await old
    expect(oldSettled).toEqual({ ok: false, stale: true, revision: 1 })
    expect((await fresh).ok).toBe(true)
  })

  it('never lets a superseded result through when revisions arrive between calls', async () => {
    const session = await makeEngine()
    expect((await session.prepare({ posterBytes, content }, 7)).ok).toBe(true)
    const older = session.prepare({ posterBytes, content: 'earlier' }, 6)
    const newer = session.prepare({ posterBytes, content: 'later' }, 8)
    expect((await older).stale).toBe(true)
    expect((await newer).ok).toBe(true)
  })
})
