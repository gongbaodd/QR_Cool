import { describe, expect, it } from 'vitest'
import { QrPosterError } from '../src/core/errors'
import { boxIsInsideMask, placeQr } from '../src/core/placement'
import type { RegionMask } from '../src/core/types'

describe('QR placement', () => {
  it('uses the largest integer module pitch that fits inside M', () => {
    const mask = rectangularMask(260, 240, 15, 10, 230, 220)
    const placement = placeQr(mask, 41)
    expect(placement).toMatchObject({ size: 205, modulePixels: 5, artPaddingModules: 0 })
    expect(boxIsInsideMask(mask, placement.x, placement.y, placement.size)).toBe(true)
    expect(placement.modulePixels).toBe(Math.floor(220 / 41))
  })

  it('chooses the centroid-nearest maximum square deterministically in an irregular mask', () => {
    const mask = rectangularMask(200, 100, 5, 8, 84, 84)
    for (let y = 8; y < 92; y++) {
      for (let x = 111; x < 195; x++) mask.data[y * mask.width + x] = 255
    }
    for (let y = 46; y < 54; y++) {
      for (let x = 89; x < 111; x++) mask.data[y * mask.width + x] = 255
    }
    mask.area = 84 * 84 * 2 + 22 * 8
    mask.bounds = { x: 5, y: 8, width: 190, height: 84 }
    mask.centroid = { x: 99.5, y: 49.5 }

    // Both lobes hold one maximum 84px square at equal distance from the centroid. The left one wins
    // the stable scan-order tie.
    const placement = placeQr(mask, 21)

    expect(placement).toMatchObject({ x: 5, y: 8, size: 84, modulePixels: 4, artPaddingModules: 0 })
    expect(boxIsInsideMask(mask, placement.x, placement.y, placement.size)).toBe(true)
  })

  it('validates manual module dimensions and mask containment', () => {
    const mask = rectangularMask(220, 220, 10, 10, 200, 200)
    expect(() => placeQr(mask, 41, { x: 20, y: 20, size: 200 })).toThrowError(QrPosterError)
    expect(() => placeQr(mask, 41, { x: 0, y: 0, size: 164 })).toThrowError(QrPosterError)
    const placement = placeQr(mask, 41, { x: 20, y: 20, size: 164 })
    expect(placement).toMatchObject({ x: 20, y: 20, size: 164, modulePixels: 4, mode: 'manual' })
  })
})

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
