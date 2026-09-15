import { QrPosterError } from './errors.js'
import type { QrBoxInput, QrPlacement, RegionMask } from './types.js'

const MINIMUM_MODULE_PIXELS = 4

export function placeQr(mask: RegionMask, totalModules: number, requested?: QrBoxInput): QrPlacement {
  if (requested)
    return validateManualPlacement(mask, totalModules, requested)

  const largestSquare = findLargestSquareSize(mask.data, mask.width, mask.height)
  const modulePixels = Math.floor(largestSquare / totalModules)
  if (modulePixels < MINIMUM_MODULE_PIXELS) {
    throw new QrPosterError(
      'QR_LAYOUT_INVALID',
      `The painted region cannot fit the QR code at the minimum ${MINIMUM_MODULE_PIXELS}px module size. Supply a larger region or --qr-box.`,
    )
  }

  const size = totalModules * modulePixels
  const topLeft = findClosestSquare(mask, size)
  return {
    x: topLeft.x,
    y: topLeft.y,
    size,
    modulePixels,
    totalModules,
    mode: 'auto',
    artPaddingModules: 0,
  }
}

export function boxIsInsideMask(mask: RegionMask, x: number, y: number, size: number): boolean {
  if (x < 0 || y < 0 || size <= 0 || x + size > mask.width || y + size > mask.height)
    return false
  for (let row = y; row < y + size; row++) {
    for (let column = x; column < x + size; column++) {
      if (!mask.data[row * mask.width + column])
        return false
    }
  }
  return true
}

function validateManualPlacement(mask: RegionMask, totalModules: number, box: QrBoxInput): QrPlacement {
  const { x, y, size } = box
  if (![x, y, size].every(Number.isInteger) || x < 0 || y < 0 || size <= 0)
    throw new QrPosterError('QR_LAYOUT_INVALID', '--qr-box must contain non-negative integer x,y coordinates and a positive integer size.')
  if (size % totalModules !== 0)
    throw new QrPosterError('QR_LAYOUT_INVALID', `Manual QR size ${size} must be divisible by ${totalModules} total modules.`)
  const modulePixels = size / totalModules
  if (modulePixels < MINIMUM_MODULE_PIXELS)
    throw new QrPosterError('QR_LAYOUT_INVALID', `Manual QR module size must be at least ${MINIMUM_MODULE_PIXELS}px.`)
  if (!boxIsInsideMask(mask, x, y, size))
    throw new QrPosterError('QR_LAYOUT_INVALID', 'The requested --qr-box is not completely inside the painted region.')
  return { x, y, size, modulePixels, totalModules, mode: 'manual', artPaddingModules: 0 }
}

function findLargestSquareSize(data: Uint8Array, width: number, height: number): number {
  let previous = new Uint32Array(width + 1)
  let maximum = 0
  for (let y = 1; y <= height; y++) {
    const current = new Uint32Array(width + 1)
    for (let x = 1; x <= width; x++) {
      if (!data[(y - 1) * width + x - 1])
        continue
      current[x] = 1 + Math.min(previous[x]!, current[x - 1]!, previous[x - 1]!)
      maximum = Math.max(maximum, current[x]!)
    }
    previous = current
  }
  return maximum
}

function findClosestSquare(mask: RegionMask, size: number): { x: number; y: number } {
  let previous = new Uint32Array(mask.width + 1)
  let best: { x: number; y: number; distance: number } | undefined
  for (let y = 1; y <= mask.height; y++) {
    const current = new Uint32Array(mask.width + 1)
    for (let x = 1; x <= mask.width; x++) {
      if (!mask.data[(y - 1) * mask.width + x - 1])
        continue
      current[x] = 1 + Math.min(previous[x]!, current[x - 1]!, previous[x - 1]!)
      if (current[x]! < size)
        continue
      const left = x - size
      const top = y - size
      const distance = Math.hypot(left + size / 2 - mask.centroid.x, top + size / 2 - mask.centroid.y)
      if (!best || distance < best.distance)
        best = { x: left, y: top, distance }
    }
    previous = current
  }
  if (!best)
    throw new QrPosterError('QR_LAYOUT_INVALID', 'Could not place the QR code inside the painted region.')
  return { x: best.x, y: best.y }
}
