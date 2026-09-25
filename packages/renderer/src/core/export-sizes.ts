import { QrPosterError } from './errors'
import type { RawImage } from './imaging/types'
import type { RegionMask } from './types'

export const RASTER_EXPORT_TARGETS = [320, 640, 1280] as const

export interface RasterExportChoice {
  key: string
  targetPitch: number
  width: number
  height: number
}

export function dimensionsAtPitch(
  width: number,
  height: number,
  originalPitch: number,
  targetPitch: number,
): { width: number; height: number } {
  const scale = targetPitch / originalPitch
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Build distinct smaller choices while keeping every export on an integer QR-module pitch. */
export function rasterExportChoices(width: number, height: number, originalPitch: number): RasterExportChoice[] {
  if (!Number.isInteger(originalPitch) || originalPitch <= 4) return []
  const byPitch = new Map<number, RasterExportChoice>()
  const minimumDimensions = dimensionsAtPitch(width, height, originalPitch, 4)
  byPitch.set(4, {
    key: 'minimum',
    targetPitch: 4,
    ...minimumDimensions,
  })

  for (const target of RASTER_EXPORT_TARGETS) {
    if (target >= Math.max(width, height)) continue
    let targetPitch = 4
    while (
      targetPitch < originalPitch &&
      Math.max(
        dimensionsAtPitch(width, height, originalPitch, targetPitch).width,
        dimensionsAtPitch(width, height, originalPitch, targetPitch).height,
      ) < target
    )
      targetPitch++
    if (targetPitch >= originalPitch) continue
    if (byPitch.has(targetPitch)) continue
    byPitch.set(targetPitch, {
      key: `target-${target}`,
      targetPitch,
      ...dimensionsAtPitch(width, height, originalPitch, targetPitch),
    })
  }

  return [...byPitch.values()].sort((left, right) => left.targetPitch - right.targetPitch)
}

/** Area-weighted RGBA shrink in premultiplied-alpha space. */
export function resizeAreaPremultiplied(source: RawImage, width: number, height: number): Uint8Array {
  if (width > source.width || height > source.height)
    throw new QrPosterError('INVALID_INPUT', 'Raster export sizes cannot exceed the assembled poster.')
  if (width === source.width && height === source.height) return Uint8Array.from(source.data)
  const output = new Uint8Array(width * height * 4)
  const scaleX = source.width / width
  const scaleY = source.height / height

  for (let targetY = 0; targetY < height; targetY++) {
    const sourceTop = targetY * scaleY
    const sourceBottom = (targetY + 1) * scaleY
    const firstY = Math.floor(sourceTop)
    const lastY = Math.min(source.height - 1, Math.ceil(sourceBottom) - 1)
    for (let targetX = 0; targetX < width; targetX++) {
      const sourceLeft = targetX * scaleX
      const sourceRight = (targetX + 1) * scaleX
      const firstX = Math.floor(sourceLeft)
      const lastX = Math.min(source.width - 1, Math.ceil(sourceRight) - 1)
      let totalWeight = 0
      let alphaWeight = 0
      let red = 0
      let green = 0
      let blue = 0
      for (let sourceY = firstY; sourceY <= lastY; sourceY++) {
        const vertical = Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY)
        for (let sourceX = firstX; sourceX <= lastX; sourceX++) {
          const horizontal = Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX)
          const weight = horizontal * vertical
          const offset = (sourceY * source.width + sourceX) * 4
          const alpha = source.data[offset + 3]! / 255
          totalWeight += weight
          alphaWeight += weight * alpha
          red += weight * alpha * source.data[offset]!
          green += weight * alpha * source.data[offset + 1]!
          blue += weight * alpha * source.data[offset + 2]!
        }
      }
      const target = (targetY * width + targetX) * 4
      output[target + 3] = totalWeight > 0 ? Math.round((alphaWeight / totalWeight) * 255) : 0
      if (alphaWeight > 0) {
        output[target] = Math.round(red / alphaWeight)
        output[target + 1] = Math.round(green / alphaWeight)
        output[target + 2] = Math.round(blue / alphaWeight)
      }
    }
  }
  return output
}

/** A target mask pixel is selected only when every source pixel in its footprint is selected. */
export function resizeRegionMaskConservative(source: RegionMask, width: number, height: number): RegionMask {
  const integralWidth = source.width + 1
  const integral = new Uint32Array(integralWidth * (source.height + 1))
  for (let y = 0; y < source.height; y++) {
    let row = 0
    for (let x = 0; x < source.width; x++) {
      if (source.data[y * source.width + x]) row++
      integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1]! + row
    }
  }

  const data = new Uint8Array(width * height)
  let area = 0
  let sumX = 0
  let sumY = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * source.height) / height)
    const bottom = Math.min(source.height, Math.ceil(((y + 1) * source.height) / height))
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * source.width) / width)
      const right = Math.min(source.width, Math.ceil(((x + 1) * source.width) / width))
      const selected =
        integral[bottom * integralWidth + right]! -
        integral[top * integralWidth + right]! -
        integral[bottom * integralWidth + left]! +
        integral[top * integralWidth + left]!
      if (selected !== (right - left) * (bottom - top)) continue
      data[y * width + x] = 255
      area++
      sumX += x
      sumY += y
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (area === 0) throw new QrPosterError('MASK_INVALID', 'The selected region disappears at this export size.')
  return {
    data,
    width,
    height,
    source: source.source,
    area,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    centroid: { x: sumX / area, y: sumY / area },
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

/** A self-contained full-poster SVG backed by the exact verified assembled PNG. */
export function buildPosterSvg(png: Uint8Array, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${bytesToBase64(png)}"/>\n` +
    '</svg>\n'
  )
}
