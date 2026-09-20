import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { canonicalizeRotation, localPointInPlate, plateToPosterPoint, posterToPlatePoint, rotatedSquareCorners } from '../src/core/rotate'
import { QrPosterError } from '../src/core/errors'
import { canonicalPlacement, fitsMask, placementSchema } from '../src/lib/editor/schema'
import { boxIsInsideMask, placeQr } from '../src/core/placement'
import { createEditorEngine } from '../src/lib/editor/engine'
import type { EditorEngineApi, EngineOutcome } from '../src/lib/editor/engine'
import { nodeImaging } from '../src/core/imaging/node'
import type { RegionMask } from '../src/core/types'

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

function rectangularMask(
  width: number,
  height: number,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
): RegionMask {
  const data = new Uint8Array(width * height)
  for (let row = y; row < y + boxHeight; row++) {
    for (let column = x; column < x + boxWidth; column++) data[row * width + column] = 255
  }
  return {
    width,
    height,
    data,
    source: 'file',
    area: boxWidth * boxHeight,
    bounds: { x, y, width: boxWidth, height: boxHeight },
    centroid: { x: x + (boxWidth - 1) / 2, y: y + (boxHeight - 1) / 2 },
  }
}

describe('canonicalizeRotation', () => {
  it('canonicalizes angles into [0, 360) without snapping', () => {
    expect(canonicalizeRotation(undefined)).toBe(0)
    expect(canonicalizeRotation(0)).toBe(0)
    expect(canonicalizeRotation(-45)).toBe(315)
    expect(canonicalizeRotation(360)).toBe(0)
    expect(canonicalizeRotation(405)).toBe(45)
    expect(canonicalizeRotation(12.5)).toBe(12.5)
    expect(canonicalizeRotation(-0.25)).toBe(359.75)
    expect(canonicalizeRotation(Number.NaN)).toBe(0)
    expect(canonicalizeRotation(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('parses the placement schema with the rotation default', () => {
    expect(placementSchema.parse({ x: 1, y: 2, size: 41 })).toMatchObject({ rotation: 0 })
    expect(placementSchema.parse({ x: 1, y: 2, size: 41, rotation: -45 })).toMatchObject({ rotation: -45 })
    expect(placementSchema.safeParse({ x: 1, y: 2, size: 41, rotation: Number.NaN }).success).toBe(false)
  })
})

describe('canonicalPlacement', () => {
  it('preserves arbitrary rotation while snapping x/y/size', () => {
    const canonical = canonicalPlacement({ x: 10.4, y: -3.2, size: 123, rotation: -33.5 }, 41)
    expect(canonical.rotation).toBe(326.5)
    expect(canonical.size % 41).toBe(0)
    expect(canonical.x).toBeGreaterThanOrEqual(0)
    expect(canonical.y).toBe(0)
  })
})

describe('rotated square geometry', () => {
  it('keeps the corners around a fixed centre at the known fixtures', () => {
    const size = 100
    for (const rotation of [0, 30, 45, 90]) {
      const box = { x: 10, y: 20, size, rotation }
      const corners = rotatedSquareCorners(box)
      // The rotation pivots on the placement centre: opposite corners' midpoint stays fixed.
      const mid = {
        x: (corners[0]!.x + corners[2]!.x) / 2,
        y: (corners[0]!.y + corners[2]!.y) / 2,
      }
      expect(mid.x).toBeCloseTo(box.x + size / 2, 6)
      expect(mid.y).toBeCloseTo(box.y + size / 2, 6)
    }
    // 0°: corners in poster positions, consistent clockwise order.
    const upright = rotatedSquareCorners({ x: 10, y: 20, size, rotation: 0 })
    expect(upright).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
      { x: 10, y: 120 },
    ])
    // 45° is the geometry stress case: the AABB reaches size * sqrt(2).
    const diagonal = rotatedSquareCorners({ x: 10, y: 10, size, rotation: 45 })
    const minX = Math.min(...diagonal.map((corner) => corner.x))
    const maxX = Math.max(...diagonal.map((corner) => corner.x))
    expect(maxX - minX).toBeCloseTo(size * Math.SQRT2, 6)
    // Quarter turn maps the top-right plate corner onto the unrotated square's bottom-right corner.
    const quarter = rotatedSquareCorners({ x: 10, y: 10, size, rotation: 90 })
    const quarterBox = { x: 10, y: 10, size, rotation: 0 }
    expect(quarter[1]).toEqual(plateToPosterPoint(size, size, quarterBox))
  })

  it('round-trips poster/plate points through the inverse transform', () => {
    const box = { x: 12, y: 7, size: 84, rotation: 30 }
    for (const [localX, localY] of [
      [0, 0],
      [84, 0],
      [84, 84],
      [0, 84],
      [42, 42],
      [30.5, 61.25],
    ]) {
      const poster = plateToPosterPoint(localX, localY, box)
      const local = posterToPlatePoint(poster.x, poster.y, box)
      expect(local.x).toBeCloseTo(localX, 9)
      expect(local.y).toBeCloseTo(localY, 9)
    }
    // Outside/inside samples near the 45° edge boundary.
    const half = posterToPlatePoint(60, -1, { x: 20, y: 20, size: 80, rotation: 45 })
    expect(localPointInPlate(half.x, half.y, 80)).toBe(false)
  })
})

describe('fitsMask with a rotated footprint', () => {
  it('accepts a rotated square fully inside and rejects one crossing the mask edge', () => {
    // 20px margin of slack around a 100px square holds any angle up to 45°.
    const mask = rectangularMask(300, 300, 20, 20, 260, 260)
    const box = { x: 105, y: 105, size: 100 }
    expect(fitsMask(mask.data, mask.width, mask.height, { ...box, rotation: 0 })).toBe(true)
    expect(fitsMask(mask.data, mask.width, mask.height, { ...box, rotation: 30 })).toBe(true)
    const box45 = { x: 110, y: 110, size: 100 }
    expect(fitsMask(mask.data, mask.width, mask.height, { ...box45, rotation: 45 })).toBe(true)
    // Pushed to the border: upright fits, a rotated corner pokes out past the boundary.
    const tight = { x: 20, y: 20, size: 100 }
    expect(fitsMask(mask.data, mask.width, mask.height, tight)).toBe(true)
    expect(fitsMask(mask.data, mask.width, mask.height, { ...tight, rotation: 45 })).toBe(false)
  })

  it('is not fooled by an irregular mask whose holes the rotated square crosses', () => {
    // Rectangular mask with a hole in the middle: the AABB check passes, per-pixel fails.
    const mask = rectangularMask(300, 300, 0, 0, 300, 300)
    for (let y = 140; y < 160; y++) for (let x = 140; x < 160; x++) mask.data[y * mask.width + x] = 0
    const box = { x: 100, y: 100, size: 100 }
    expect(fitsMask(mask.data, mask.width, mask.height, box)).toBe(false)
    expect(fitsMask(mask.data, mask.width, mask.height, { ...box, rotation: 45 })).toBe(false)
    // Shifting so the rotated square avoids the hole validates the same rules.
    const shifted = { x: 180, y: 100, size: 100 }
    expect(fitsMask(mask.data, mask.width, mask.height, { ...shifted, rotation: 45 })).toBe(true)
  })
})

describe('placeQr rotation rules', () => {
  it('auto-place stays upright and emits rotation 0', () => {
    const mask = rectangularMask(300, 300, 10, 10, 280, 280)
    const placement = placeQr(mask, 41)
    expect(placement.rotation).toBe(0)
    expect(boxIsInsideMask(mask, placement.x, placement.y, placement.size)).toBe(true)
  })

  it('validates manual placements against the rotated footprint', () => {
    const mask = rectangularMask(320, 320, 10, 10, 300, 300)
    // 45° widens the AABB by sqrt(2): a 164px square pushed toward the border pokes out.
    expect(() => placeQr(mask, 41, { x: 120, y: 120, size: 164, rotation: 45 })).toThrowError(QrPosterError)
    const placement = placeQr(mask, 41, { x: 110, y: 110, size: 164, rotation: 15 })
    expect(placement).toMatchObject({ x: 110, y: 110, size: 164, rotation: 15, mode: 'manual' })
  })
})

describe('engine rotation end to end', () => {
  it('recentering a module-count change preserves rotation', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    expect(prepared.placement.rotation).toBe(0)
    const rotated = { ...prepared.placement, rotation: 30 }
    const reapply = assertOk(
      await session.prepare({ posterBytes, content, placement: rotated }, 2),
    )
    expect(reprepare(reapply).rotation).toBe(30)
  })

  function reprepare(outcome: { placement: { x: number; y: number; size: number; rotation: number } }) {
    return outcome.placement
  }

  it.each([30, 45, 90])('assembles qualified posters at %s° via the generic rotated path', async (rotation) => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    // Shrink around the auto placement centre until the rotated footprint fits the region.
    const modules = prepared.qrMetadata.totalModules
    const centreX = prepared.placement.x + prepared.placement.size / 2
    const centreY = prepared.placement.y + prepared.placement.size / 2
    let sizeFactor = rotation === 90 ? 1 : 0.7
    let placement = prepared.placement
    for (;;) {
      const size = Math.floor((prepared.placement.size * sizeFactor) / modules) * modules
      placement = {
        x: Math.max(0, Math.round(centreX - size / 2)),
        y: Math.max(0, Math.round(centreY - size / 2)),
        size,
        rotation,
      }
      const attempt = assertOk(await session.prepare({ posterBytes, content, placement }, 2))
      if (!attempt.validation) break
      sizeFactor -= 0.05
      if (sizeFactor <= 0.2) throw new Error('no rotated placement fits the fixture region')
    }
    const result = assertOk(await session.assemble({ posterBytes, content, placement, ...settings }, 3))
    expect(result.report.placement.rotation).toBe(rotation)
    expect(result.report.qualified).toBe(true)
    expect(result.report.verification.checks.every((check) => check.passed)).toBe(true)
    expect(result.report.schemaVersion).toBe(8)
  })

  it('flags an invalid rotated placement instead of moving it', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    const placement = { ...prepared.placement, rotation: 45 }
    const attempt = await session.prepare({ posterBytes, content, placement }, 2)
    const value = assertOk(attempt)
    if (!value.validation) {
      // The fixture's region happens to hold the full 45° footprint; force an invalid 89° swap.
      const swapped = { x: 0, y: 0, size: prepared.placement.size, rotation: 45 }
      const rejected = await session.assemble({ posterBytes, content, placement: swapped, ...settings }, 3)
      expect(rejected.ok).toBe(false)
      return
    }
    expect(value.validation).toMatch(/painted region/i)
  })

  it('reuses the cached QR bundle across rotation-only prepare calls', async () => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    const rotated = assertOk(
      await session.prepare({ posterBytes, content, placement: { ...prepared.placement, rotation: 30 } }, 2),
    )
    if (!rotated.validation) {
      const digest = await nodeImaging.sha256Hex(new Uint8Array(await prepared.qr.arrayBuffer()))
      expect(await nodeImaging.sha256Hex(new Uint8Array(await rotated.qr.arrayBuffer()))).toBe(digest)
    }
  })
})
