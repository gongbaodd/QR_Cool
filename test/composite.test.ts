import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { compositePoster } from '../src/composite.js'
import type { QrPlacement, RegionMask } from '../src/types.js'

describe('compositePoster', () => {
  it('takes generated pixels only from E and places the exact QR over Q', async () => {
    const width = 12
    const height = 10
    const original = await solid(width, height, [255, 255, 255, 255])
    const generated = await solid(width, height, [0, 200, 0, 255])
    const qr = await solid(4, 4, [0, 0, 0, 255])
    const data = new Uint8Array(width * height)
    for (let y = 2; y < 9; y++) {
      for (let x = 2; x < 11; x++)
        data[y * width + x] = 255
    }
    const mask: RegionMask = {
      width,
      height,
      data,
      source: 'file',
      area: 63,
      bounds: { x: 2, y: 2, width: 9, height: 7 },
      centroid: { x: 6, y: 5 },
    }
    const placement: QrPlacement = {
      x: 4,
      y: 3,
      size: 4,
      modulePixels: 1,
      totalModules: 4,
      mode: 'manual',
      artPaddingModules: 0,
    }
    const output = await compositePoster({ original, generated, regionMask: mask, qr, placement })
    const raw = await sharp(output).ensureAlpha().raw().toBuffer()
    expect(pixel(raw, width, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(raw, width, 2, 2)).toEqual([0, 200, 0, 255])
    expect(pixel(raw, width, 4, 3)).toEqual([0, 0, 0, 255])
    expect(pixel(raw, width, 8, 5)).toEqual([0, 200, 0, 255])
  })
})

function solid(width: number, height: number, background: { r: number; g: number; b: number; alpha: number } | [number, number, number, number]): Promise<Buffer> {
  const [r, g, b, alpha] = Array.isArray(background)
    ? background
    : [background.r, background.g, background.b, background.alpha]
  return sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer()
}

function pixel(data: Buffer, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4
  return [...data.subarray(offset, offset + 4)]
}
