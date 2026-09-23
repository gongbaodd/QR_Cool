import sharp from 'sharp'
import { describe, it, expect } from 'vitest'
import { cropQrPattern } from '@/core/qr'
import { renderPattern } from '@/core/pattern'
import { decodePng } from '@/core/image'

describe('QR center pattern', () => {
  it.each([21, 25, 37, 177])('excludes all corner finder regions for %s QR modules', async (qrModules) => {
    const total = qrModules + 4,
      pitch = 5,
      size = total * pitch
    const data = Buffer.alloc(size * size, 255)
    // Mark each 7x7 finder and its separator; white center must contain none.
    for (const [x, y] of [
      [1, 1],
      [total - 10, 1],
      [1, total - 10],
    ]) {
      for (let row = y! * pitch; row < (y! + 9) * pitch; row++)
        for (let col = x! * pitch; col < (x! + 9) * pitch; col++) data[row * size + col] = 0
    }
    const image = await sharp(data, { raw: { width: size, height: size, channels: 1 } })
      .png()
      .toBuffer()
    const cropped = await cropQrPattern(image, total, pitch)
    expect((await sharp(cropped).raw().toBuffer()).every((value) => value === 255)).toBe(true)
    expect((await sharp(cropped).metadata()).width).toBe(Math.min(Math.floor(total / 3), total - 20) * pitch)
  })

  it.each(['square', 'rounded', 'dot'] as const)(
    'keeps light cells transparent for the %s pixel style when requested',
    async (pixelStyle) => {
      const png = await renderPattern(
        [
          [true, false],
          [false, true],
        ],
        6,
        pixelStyle,
        { marginModules: 0, background: 'transparent' },
      )
      const image = await decodePng(png, 'transparent-pattern.png', 'transparent pattern')
      let transparent = 0
      let ink = 0
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] === 0) transparent++
        if (image.data[offset + 3]! > 0 && image.data[offset]! < 128) ink++
      }
      expect(transparent).toBeGreaterThan(0)
      expect(ink).toBeGreaterThan(0)
    },
  )
})
