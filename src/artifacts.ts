import sharp from 'sharp'
import type { LoadedPng } from './image.js'
import { grayscaleToPng, rgbaToPng } from './image.js'
import type { QrPlacement, RegionMask } from './types.js'

export function renderRegionMask(mask: RegionMask): Promise<Buffer> {
  return grayscaleToPng(mask.data, mask.width, mask.height)
}

export async function renderBeforeAi(poster: LoadedPng, qr: Buffer, placement: QrPlacement): Promise<Buffer> {
  return sharp(poster.file)
    .composite([{ input: qr, left: placement.x, top: placement.y }])
    .png()
    .toBuffer()
}

export function renderEditMask(mask: RegionMask, placement: QrPlacement): Promise<Buffer> {
  const rgba = new Uint8Array(mask.width * mask.height * 4)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const index = y * mask.width + x
      const offset = index * 4
      const insideQr = x >= placement.x && x < placement.x + placement.size
        && y >= placement.y && y < placement.y + placement.size
      rgba[offset] = 255
      rgba[offset + 1] = 255
      rgba[offset + 2] = 255
      rgba[offset + 3] = mask.data[index] && !insideQr ? 0 : 255
    }
  }
  return rgbaToPng(rgba, mask.width, mask.height)
}

export async function renderLayoutPreview(poster: LoadedPng, mask: RegionMask, placement: QrPlacement): Promise<Buffer> {
  const overlay = new Uint8Array(mask.width * mask.height * 4)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const index = y * mask.width + x
      if (!mask.data[index])
        continue
      const boundary = isBoundary(mask, x, y)
      const offset = index * 4
      overlay[offset] = boundary ? 255 : 0
      overlay[offset + 1] = boundary ? 145 : 190
      overlay[offset + 2] = boundary ? 0 : 255
      overlay[offset + 3] = boundary ? 255 : 46
    }
  }
  const overlayPng = await rgbaToPng(overlay, mask.width, mask.height)
  const labelY = Math.max(16, placement.y - 8)
  const annotation = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${mask.width}" height="${mask.height}">
      <rect x="${placement.x + 0.5}" y="${placement.y + 0.5}" width="${placement.size - 1}" height="${placement.size - 1}"
        fill="none" stroke="#ff1744" stroke-width="3"/>
      <text x="${placement.x}" y="${labelY}" fill="#ff1744" stroke="white" stroke-width="3" paint-order="stroke"
        font-family="sans-serif" font-size="14" font-weight="700">Q ${placement.size}px · ${placement.modulePixels}px/module</text>
    </svg>
  `)
  return sharp(poster.file)
    .composite([{ input: overlayPng }, { input: annotation }])
    .png()
    .toBuffer()
}

function isBoundary(mask: RegionMask, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      if (nx < 0 || nx >= mask.width || ny < 0 || ny >= mask.height)
        return true
      if (!mask.data[ny * mask.width + nx])
        return true
    }
  }
  return false
}
