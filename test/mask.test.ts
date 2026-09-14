import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { QrPosterError } from '../src/errors.js'
import { buildManualRegionMask, detectRegionMask } from '../src/mask.js'
import type { LoadedPng } from '../src/image.js'

describe('region mask detection', () => {
  it('keeps a dense central shape and does not follow a long attached line', async () => {
    const image = await fixture(240, 180, `
      <rect width="240" height="180" fill="white"/>
      <path d="M55 35 H180 V75 H155 V150 H55 Z" fill="black"/>
      <rect x="80" y="75" width="18" height="18" fill="white"/>
      <path d="M180 60 H232" stroke="black" stroke-width="2"/>
    `)
    const mask = detectRegionMask(image)
    expect(mask.data[60 * 240 + 80]).toBe(255)
    expect(mask.data[82 * 240 + 88]).toBe(0)
    expect(mask.data[60 * 240 + 225]).toBe(0)
    expect(mask.bounds.x).toBeGreaterThanOrEqual(52)
    expect(mask.bounds.x + mask.bounds.width).toBeLessThan(190)
  })

  it('rejects similarly sized central candidates', async () => {
    const image = await fixture(240, 180, `
      <rect width="240" height="180" fill="white"/>
      <rect x="35" y="45" width="72" height="90" fill="black"/>
      <rect x="133" y="45" width="72" height="90" fill="black"/>
    `)
    expect(() => detectRegionMask(image)).toThrowError(QrPosterError)
    try {
      detectRegionMask(image)
    }
    catch (error) {
      expect((error as QrPosterError).code).toBe('MASK_AMBIGUOUS')
    }
  })

  it('uses white and opaque pixels from a manual mask', async () => {
    const maskImage = await fixture(20, 10, `
      <rect width="20" height="10" fill="black"/>
      <rect x="3" y="2" width="8" height="5" fill="white"/>
    `)
    const mask = buildManualRegionMask(maskImage, 20, 10)
    expect(mask.area).toBe(40)
    expect(mask.bounds).toEqual({ x: 3, y: 2, width: 8, height: 5 })
  })
})

async function fixture(width: number, height: number, content: string): Promise<LoadedPng> {
  const file = await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`))
    .png()
    .toBuffer()
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    path: 'fixture.png',
    file,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    sha256: 'fixture',
  }
}
