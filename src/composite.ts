import sharp from 'sharp'
import { QrPosterError } from './errors.js'
import type { CompositePosterInputs } from './types.js'
import { rgbaToPng } from './image.js'

export async function compositePoster(inputs: CompositePosterInputs): Promise<Buffer> {
  const original = await sharp(inputs.original).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (original.info.width !== inputs.regionMask.width || original.info.height !== inputs.regionMask.height) {
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'Original image dimensions do not match the region mask.', 3)
  }

  const generatedMetadata = await sharp(inputs.generated).metadata()
  if (!generatedMetadata.width || !generatedMetadata.height)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'Generated image dimensions are unavailable.', 3)
  const originalRatio = original.info.width / original.info.height
  const generatedRatio = generatedMetadata.width / generatedMetadata.height
  if (Math.abs(generatedRatio / originalRatio - 1) > 0.01) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `Generated image aspect ratio differs from the original by more than 1%.`,
      3,
    )
  }

  const generated = await sharp(inputs.generated)
    .resize(original.info.width, original.info.height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const output = Uint8Array.from(original.data)
  const { x, y, size } = inputs.placement
  for (let row = 0; row < original.info.height; row++) {
    for (let column = 0; column < original.info.width; column++) {
      const index = row * original.info.width + column
      const insideQr = column >= x && column < x + size && row >= y && row < y + size
      if (!inputs.regionMask.data[index] || insideQr)
        continue
      const offset = index * 4
      output[offset] = generated[offset]!
      output[offset + 1] = generated[offset + 1]!
      output[offset + 2] = generated[offset + 2]!
      output[offset + 3] = generated[offset + 3]!
    }
  }

  const background = await rgbaToPng(output, original.info.width, original.info.height)
  const normalizedQr = await sharp(inputs.qr)
    .flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
  return sharp(background).composite([{ input: normalizedQr, left: x, top: y }]).png().toBuffer()
}
