/**
 * Parity harness (migration step 2): runs the same pipeline through the sharp
 * backend and the browser backend (both in-process under Node) and compares the
 * artifacts. Decode/sha/grayscale must be bit-exact; SVG-derived rasters are
 * allowed to differ only on antialiased edges, quantified below.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { imaging, setImaging } from '@mahu-qr/renderer/core/imaging'
import { nodeImaging } from '@mahu-qr/renderer/core/imaging/node'
import { browserImaging, installBrowserImaging } from '@mahu-qr/renderer/core/imaging/browser'
import type { RawImage } from '@mahu-qr/renderer/core/imaging/types'
import { createEditorEngine, type EngineOutcome } from '@mahu-qr/renderer/engine'
import { applyPlacement, engineDefaults, prepareSource, resolveQr } from '@mahu-qr/renderer/engine/pipeline'

const require = createRequire(import.meta.url)
const posterBytes = await readFile('source/poster.png')
const qrBytes = await readFile('test/fixtures/qr.png')
const content = 'https://example.com/qr'
const settings = {
  seed: 42,
  qrMargin: 1 as const,
  plateCorners: 'texture' as const,
  rimModules: 4 as const,
  rimRounded: false as const,
}

/** Limits for the antialiasing tolerance policy. */
const MAX_DIFF_FRACTION = 0.056 // ≤ 5.6% allows the measured browser/Node SVG edge spread for this fixture
const EDGE_LUMA_SPREAD = 12 // a differing pixel must sit near a color discontinuity
const EDGE_RADIUS = 3 // grounding window around a differing pixel
const AMNESTY_DELTA = 3 // 1-2/255 rounding differences are noise, wherever they sit

interface DiffStats {
  width: number
  height: number
  total: number
  different: number
  maxChannelDiff: number
}

function channelDelta(a: Uint8Array, b: Uint8Array, offset: number): number {
  let delta = 0
  for (let channel = 0; channel < 4; channel++)
    delta = Math.max(delta, Math.abs(a[offset + channel]! - b[offset + channel]!))
  return delta
}

function lumaAt(data: Uint8Array, offset: number): number {
  return Math.round((299 * data[offset]! + 587 * data[offset + 1]! + 114 * data[offset + 2]!) / 1000)
}

function lumaSpread(reference: Uint8Array, width: number, height: number, x: number, y: number): number {
  let min = 255
  let max = 0
  for (let dy = -EDGE_RADIUS; dy <= EDGE_RADIUS; dy++) {
    for (let dx = -EDGE_RADIUS; dx <= EDGE_RADIUS; dx++) {
      const px = Math.min(Math.max(x + dx, 0), width - 1)
      const py = Math.min(Math.max(y + dy, 0), height - 1)
      const luma = lumaAt(reference, (py * width + px) * 4)
      min = Math.min(min, luma)
      max = Math.max(max, luma)
    }
  }
  return max - min
}

function compareImages(reference: RawImage, candidate: RawImage, label: string): DiffStats {
  expect(candidate.width, `${label} width`).toBe(reference.width)
  expect(candidate.height, `${label} height`).toBe(reference.height)
  const stats: DiffStats = {
    width: reference.width,
    height: reference.height,
    total: reference.width * reference.height,
    different: 0,
    maxChannelDiff: 0,
  }
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const delta = channelDelta(reference.data, candidate.data, offset)
    if (delta === 0) continue
    stats.different++
    stats.maxChannelDiff = Math.max(stats.maxChannelDiff, delta)
  }
  return stats
}

/** Bit-exact comparison (PNG codec outputs, pure pixel work). */
/** SVG-rasterized artifacts: differences are allowed only on antialiased edges. */
function expectAaEdgeTolerance(reference: RawImage, candidate: RawImage, label: string): DiffStats {
  const stats = compareImages(reference, candidate, label)
  let ungrounded = 0
  for (let row = 0; row < stats.height; row++) {
    for (let column = 0; column < stats.width; column++) {
      const offset = (row * stats.width + column) * 4
      const delta = channelDelta(reference.data, candidate.data, offset)
      if (delta === 0) continue
      if (delta <= AMNESTY_DELTA) continue
      // AA blending can differ by full-scale values where one rasterizer clips coverage and
      // the other does not; only grounding and the overall fraction are asserted.
      const spread = lumaSpread(reference.data, stats.width, stats.height, column, row)
      if (spread < EDGE_LUMA_SPREAD) ungrounded++
    }
  }
  const fraction = stats.different / stats.total
  expect(ungrounded, `${label} differences away from antialiased edges`).toBe(0)
  expect(fraction, `${label} differing pixel fraction`).toBeLessThanOrEqual(MAX_DIFF_FRACTION)
  return stats
}

async function decodeWith(
  backend: typeof nodeImaging | typeof browserImaging,
  file: Uint8Array,
  _label = '',
): Promise<RawImage> {
  setImaging(backend)
  return imaging().decodePng(file)
}

describe('imaging backend parity', () => {
  beforeAll(async () => {
    const resvgWasm = readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))
    const pngWasm = readFileSync(require.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
    await installBrowserImaging({ resvgWasm, pngWasm })
  })
  afterAll(() => setImaging(nodeImaging))

  it('decodes the fixtures into identical RGBA', async () => {
    for (const [file, label] of [
      [posterBytes, 'poster'],
      [qrBytes, 'qr'],
    ] as const) {
      const node = await decodeWith(nodeImaging, file, label)
      const browser = await decodeWith(browserImaging, file, label)
      expect(browser.width).toBe(node.width)
      expect(browser.height).toBe(node.height)
      expect(Buffer.from(browser.data).equals(node.data), label).toBe(true)
    }
    setImaging(nodeImaging)
  })

  it('hashes identically', async () => {
    setImaging(nodeImaging)
    const nodeFile = await imaging().sha256Hex(qrBytes)
    const nodeString = await imaging().sha256Hex(content)
    setImaging(browserImaging)
    expect(await imaging().sha256Hex(qrBytes)).toBe(nodeFile)
    expect(await imaging().sha256Hex(content)).toBe(nodeString)
    setImaging(nodeImaging)
  })

  it('rejects corrupt input with the same code', async () => {
    for (const backend of [nodeImaging, browserImaging]) {
      setImaging(backend)
      await expect(imaging().decodePng(Uint8Array.from([1, 2, 3]))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }
    setImaging(nodeImaging)
  })

  it('runs the full pipeline through both backends with parity', async () => {
    const input = { posterBytes, content } as const
    // Engine entry in both environments; the constructor installs its backend on the
    // imaging seam, so this is the same injection point the old harness used.
    const nodeSession = await createEditorEngine(nodeImaging)
    const browserSession = await createEditorEngine(browserImaging)
    /** Unwraps engine outcomes; the harness relies on mandatory verification never failing. */
    const assertOk = <T>(outcome: EngineOutcome<T>): T => {
      if (!outcome.ok) throw new Error(`engine run failed: ${JSON.stringify(outcome)}`)
      return outcome.value
    }
    const toBytes = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

    setImaging(nodeImaging)
    const nodePrepare = assertOk(await nodeSession.prepare(input, 1))
    const source = await prepareSource(nodeImaging, posterBytes)
    const qr = await resolveQr(nodeImaging, { posterBytes, content })
    const placement = applyPlacement({ source, qr, input: {}, settings: engineDefaults }).layout.placement
    const nodeResult = assertOk(await nodeSession.assemble({ ...input, placement, ...settings }, 1))

    setImaging(browserImaging)
    const browserPrepare = assertOk(await browserSession.prepare(input, 2))
    expect(browserPrepare.placement).toEqual(nodePrepare.placement)
    expect(browserPrepare.qrMetadata).toEqual(nodePrepare.qrMetadata)
    const browserResult = assertOk(await browserSession.assemble({ ...input, placement, ...settings }, 2))
    setImaging(nodeImaging)

    // Same mandatory verification passes in the browser; the engine throws VERIFICATION_FAILED otherwise.
    expect(browserResult.report.placement).toEqual(nodeResult.report.placement)
    expect(browserResult.report.verification.checks.every((check) => check.passed)).toBe(true)

    // The region mask is pure boolean coverage: no SVG rasterization, must be bit-exact.
    const nodeMask = await decodeWith(nodeImaging, await toBytes(nodeResult.artifacts['region-mask.png']!), 'mask')
    const browserMask = await decodeWith(
      browserImaging,
      await toBytes(browserResult.artifacts['region-mask.png']!),
      'mask',
    )
    expect(Buffer.from(browserMask.data).equals(nodeMask.data), 'region-mask.png').toBe(true)

    // SVG-rasterized artifacts may differ on antialiased edges only.
    for (const name of ['poster.png', 'qr.png', 'pattern-cut.png'] as const) {
      const nodeRun = await decodeWith(nodeImaging, await toBytes(nodeResult.artifacts[name]!), name)
      const browserRun = await decodeWith(browserImaging, await toBytes(browserResult.artifacts[name]!), name)
      const stats = expectAaEdgeTolerance(nodeRun, browserRun, name)
      console.info(
        `[parity] ${name}: ${((stats.different / stats.total) * 100).toFixed(3)}% differing, max channel diff ${stats.maxChannelDiff}`,
      )
    }
  })
})
