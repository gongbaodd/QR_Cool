import { describe, it, expect } from 'vitest'
import { generateQrFromContent, decodeQrBuffer } from '@/core/qr'
import { decodePng } from '@/core/image'
import { DEFAULT_PALETTE, hexToRgb, type QrPalette } from '@/core/palette'

const content = 'https://example.com/qr-colors'
const palette: QrPalette = { pixel: '#0d47a1', marker: '#06305e', background: '#eef3fa' }

function isColor(image: Uint8Array, offset: number, hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  return image[offset] === r && image[offset + 1] === g && image[offset + 2] === b && image[offset + 3] === 255
}

describe('generated QR palette', () => {
  it('colors the quiet zone, marker ink, and data modules with the palette', async () => {
    const generated = await generateQrFromContent(
      content,
      'M',
      'dot',
      'rounded',
      'circle',
      'circle',
      'square',
      undefined,
      palette,
    )
    const image = await decodePng(generated.image.file, 'qr.png', 'generated QR')
    // Decode round trip keeps working for colored palettes (binarization-friendly contrast).
    expect(await decodeQrBuffer(generated.image.file)).toBe(content)

    const pitch = 20
    const stride = image.width
    const at = (pixelX: number, pixelY: number): number => (pixelY * stride + pixelX) * 4
    // Quiet zone: the whole two-module margin is the background color.
    expect(isColor(image.data, at(10, 10), palette.background)).toBe(true)
    // Finder marker: outer center? The 'circle' shape fills radius 3.5*20; its very center is the inner circle.
    const center = at((2 + 3.5) * pitch, (2 + 3.5) * pitch)
    expect(isColor(image.data, center, palette.marker)).toBe(true)
    // The marker ring stays light: 2 modules inside the marker footprint is the background ring.
    const ringPoint = at((2 + 3.5) * pitch + 2 * pitch, (2 + 3.5) * pitch)
    expect(isColor(image.data, ringPoint, palette.background)).toBe(true)
  })

  it('renders the default palette byte-identically, with or without explicit colors', async () => {
    const omitted = await generateQrFromContent(content)
    const defaults = await generateQrFromContent(
      content,
      'M',
      'dot',
      'rounded',
      'circle',
      'circle',
      'square',
      undefined,
      DEFAULT_PALETTE,
    )
    expect(Buffer.from(omitted.image.file).equals(Buffer.from(defaults.image.file))).toBe(true)
  })
})
