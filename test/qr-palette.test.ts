import { describe, it, expect } from 'vitest'
import { generateQrFromContent, decodeQrBuffer } from '@/core/qr'
import { decodePng, rgbaToPng } from '@/core/image'
import { resizeNearest } from '@/core/imaging/pixels'
import { DEFAULT_PALETTE, TIGER_PRESET, hexToRgb, paletteGuard, type QrPalette } from '@/core/palette'

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

  it('accepts the brand Tiger preset through the palette guard', () => {
    expect(paletteGuard(TIGER_PRESET)).toEqual({ ok: true, issues: [] })
  })

  it('generates and decodes a QR with the Tiger preset', async () => {
    const generated = await generateQrFromContent(
      content,
      'M',
      'dot',
      'rounded',
      'circle',
      'circle',
      'square',
      undefined,
      TIGER_PRESET,
    )
    expect(await decodeQrBuffer(generated.image.file)).toBe(content)
  })

  it('renders and decodes squircle outer and inner marker combinations', async () => {
    const outerShapes = ['square', 'circle', 'octagon', 'squircle'] as const
    const innerShapes = ['square', 'circle', 'plus', 'diamond', 'squircle'] as const
    const configurations = [
      ...innerShapes.map((inner) => ({ shape: 'squircle' as const, inner })),
      ...outerShapes.map((shape) => ({ shape, inner: 'squircle' as const })),
    ]
    const pitch = 20
    const centerX = (2 + 3.5) * pitch
    const centerY = (2 + 3.5) * pitch

    for (const marker of configurations) {
      const generated = await generateQrFromContent(
        content,
        'M',
        'dot',
        'rounded',
        'circle',
        'circle',
        'square',
        {
          tl: { style: 'rounded', ...marker },
          tr: { style: 'rounded', shape: 'circle', inner: 'circle' },
          bl: { style: 'rounded', shape: 'circle', inner: 'circle' },
        },
        palette,
      )
      const image = await decodePng(generated.image.file, 'squircle-qr.png', 'generated QR')
      expect(await decodeQrBuffer(generated.image.file)).toBe(content)

      if (marker.shape === 'squircle' && marker.inner === 'circle') {
        const halfWidth = Math.floor(image.width / 2)
        const halfHeight = Math.floor(image.height / 2)
        const reducedPixels = resizeNearest(
          { data: image.data, width: image.width, height: image.height },
          halfWidth,
          halfHeight,
        )
        expect(await decodeQrBuffer(await rgbaToPng(reducedPixels, halfWidth, halfHeight))).toBe(content)
      }

      if (marker.shape === 'squircle') {
        const diagonal = (centerY + 2.7 * pitch) * image.width * 4 + (centerX + 2.7 * pitch) * 4
        expect(isColor(image.data, diagonal, palette.marker)).toBe(true)
      }
      if (marker.inner === 'squircle') {
        const innerEdge = (centerY * image.width + centerX + 1.4 * pitch) * 4
        expect(isColor(image.data, innerEdge, palette.marker)).toBe(true)
      }
    }
  })
})
