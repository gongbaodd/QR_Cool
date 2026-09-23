import sharp from 'sharp'
import { describe, it, expect } from 'vitest'
import { cropQrPattern } from '@/core/qr'

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
})
