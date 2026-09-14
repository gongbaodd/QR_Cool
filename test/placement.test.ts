import { describe, expect, it } from 'vitest'
import { QrPosterError } from '../src/errors.js'
import { boxIsInsideMask, placeQr } from '../src/placement.js'
import type { RegionMask } from '../src/types.js'

describe('QR placement', () => {
  it('uses integer modules and keeps automatic padding inside M', () => {
    const mask = rectangularMask(260, 240, 15, 10, 230, 220)
    const placement = placeQr(mask, 41)
    expect(placement.size % 41).toBe(0)
    expect(placement.artPaddingModules).toBe(2)
    expect(boxIsInsideMask(mask, placement.x, placement.y, placement.size)).toBe(true)
    const padding = placement.artPaddingModules * placement.modulePixels
    expect(boxIsInsideMask(mask, placement.x - padding, placement.y - padding, placement.size + padding * 2)).toBe(true)
  })

  it('validates manual module dimensions and mask containment', () => {
    const mask = rectangularMask(220, 220, 10, 10, 200, 200)
    expect(() => placeQr(mask, 41, { x: 20, y: 20, size: 200 })).toThrowError(QrPosterError)
    expect(() => placeQr(mask, 41, { x: 0, y: 0, size: 164 })).toThrowError(QrPosterError)
    const placement = placeQr(mask, 41, { x: 20, y: 20, size: 164 })
    expect(placement).toMatchObject({ x: 20, y: 20, size: 164, modulePixels: 4, mode: 'manual' })
  })
})

function rectangularMask(width: number, height: number, x: number, y: number, boxWidth: number, boxHeight: number): RegionMask {
  const data = new Uint8Array(width * height)
  for (let row = y; row < y + boxHeight; row++) {
    for (let column = x; column < x + boxWidth; column++)
      data[row * width + column] = 255
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
