/** The Node imaging backend. Every operation mirrors the exact sharp pipeline the call
 * site used before the seam, so Node-side output bytes stay bit-identical after extraction. */

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { QrPosterError } from '../errors'
import type { Imaging, RawImage, RenderedSvgPng, SvgRenderOptions } from './types'

export const nodeImaging: Imaging = {
  async decodePng(file: Uint8Array): Promise<RawImage> {
    try {
      const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
      const source = sharp(bytes, { failOn: 'error', limitInputPixels: 16_000_000 })
      const metadata = await source.metadata()
      if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error('not a decodable PNG')
      const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return {
        data,
        width: info.width,
        height: info.height,
      }
    } catch (error) {
      throw new QrPosterError('INVALID_INPUT', 'Could not decode the image as PNG.', 2, { cause: error })
    }
  },

  async encodePngRgba(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const png = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer()
    return png
  },

  async encodePngGrayscale(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const png = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer()
    return png
  },

  async rasterizeSvg(svg: string, width: number, height: number): Promise<RawImage> {
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== width || info.height !== height) {
      throw new QrPosterError(
        'IMAGE_PROCESSING_FAILED',
        `SVG rasterization produced ${info.width}x${info.height} instead of ${width}x${height}.`,
        3,
      )
    }
    return { data, width: info.width, height: info.height }
  },

  async renderSvgToPng(svg: string, options: SvgRenderOptions): Promise<RenderedSvgPng> {
    const raster = sharp(Buffer.from(svg))
    const { data, info } = await (options.flatten ? raster.flatten({ background: '#ffffff' }) : raster)
      .png()
      .toBuffer({ resolveWithObject: true })
    return {
      png: data,
      width: info.width,
      height: info.height,
    }
  },

  async composeQrPng(basePng: Uint8Array, overlaySvgs: string[]): Promise<Uint8Array> {
    const composites = overlaySvgs.filter((svg) => svg.length > 0).map((svg) => ({ input: Buffer.from(svg) }))
    const png =
      composites.length === 0
        ? await sharp(Buffer.from(basePng.buffer, basePng.byteOffset, basePng.byteLength))
            .png()
            .toBuffer()
        : await sharp(Buffer.from(basePng.buffer, basePng.byteOffset, basePng.byteLength))
            .composite(composites)
            .png()
            .toBuffer()
    return png
  },

  async normalizeQrPng(file: Uint8Array, targetSize: number): Promise<Uint8Array> {
    const png = await sharp(Buffer.from(file.buffer, file.byteOffset, file.byteLength))
      .flatten({ background: '#ffffff' })
      .resize(targetSize, targetSize, { fit: 'fill', kernel: sharp.kernel.nearest })
      .png()
      .toBuffer()
    return png
  },

  async sha256Hex(input: string | Uint8Array): Promise<string> {
    return createHash('sha256').update(input).digest('hex')
  },
}
