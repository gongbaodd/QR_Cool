import type { LoadedPng } from './image'
import { luma } from './image'
import { QrPosterError } from './errors'
import type { BoundingBox, Point, RegionMask } from './types'

const STRONG_BLACK_THRESHOLD = 32
const TOLERANT_LUMA_THRESHOLD = 96
const DENSITY_THRESHOLD = 0.8
const MIN_COMPONENT_FRACTION = 0.01

interface Component {
  label: number
  area: number
  sumX: number
  sumY: number
  intersectsCenter: boolean
  touchesOuterBand: boolean
}

export function buildManualRegionMask(mask: LoadedPng, width: number, height: number): RegionMask {
  if (mask.width !== width || mask.height !== height) {
    throw new QrPosterError(
      'MASK_INVALID',
      `Mask dimensions ${mask.width}x${mask.height} do not match poster dimensions ${width}x${height}.`,
    )
  }

  const selected = new Uint8Array(width * height)
  for (let index = 0; index < selected.length; index++) {
    const offset = index * 4
    const alpha = mask.data[offset + 3]!
    const brightness = luma(mask.data[offset]!, mask.data[offset + 1]!, mask.data[offset + 2]!)
    selected[index] = alpha >= 128 && brightness >= 128 ? 255 : 0
  }

  const stats = calculateMaskStats(selected, width, height)
  if (stats.area === 0)
    throw new QrPosterError('MASK_INVALID', 'The supplied mask does not contain any selected white pixels.')

  return { data: selected, width, height, source: 'file', ...stats }
}

export function detectRegionMask(image: LoadedPng): RegionMask {
  const { data, width, height } = image
  const pixelCount = width * height
  const radius = clamp(Math.round(Math.min(width, height) / 120), 2, 16)
  const strong = new Uint8Array(pixelCount)
  const tolerant = new Uint8Array(pixelCount)

  for (let index = 0; index < pixelCount; index++) {
    const offset = index * 4
    const r = data[offset]!
    const g = data[offset + 1]!
    const b = data[offset + 2]!
    const alpha = data[offset + 3]!
    if (alpha >= 128 && r <= STRONG_BLACK_THRESHOLD && g <= STRONG_BLACK_THRESHOLD && b <= STRONG_BLACK_THRESHOLD)
      strong[index] = 1
    if (alpha >= 128 && luma(r, g, b) <= TOLERANT_LUMA_THRESHOLD) tolerant[index] = 1
  }

  const integral = buildIntegral(strong, width, height)
  const core = new Uint8Array(pixelCount)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (!strong[index]) continue
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const blackCount = integralSum(integral, width + 1, x0, y0, x1 + 1, y1 + 1)
      const windowArea = (x1 - x0 + 1) * (y1 - y0 + 1)
      if (blackCount / windowArea >= DENSITY_THRESHOLD) core[index] = 1
    }
  }

  const { labels, components } = labelComponents(core, width, height)
  const minimumArea = Math.ceil(pixelCount * MIN_COMPONENT_FRACTION)
  const candidates = components
    .filter((component) => component.intersectsCenter && component.area >= minimumArea)
    .sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area
      return centerDistance(a, width, height) - centerDistance(b, width, height)
    })

  if (candidates.length === 0) {
    throw new QrPosterError(
      'MASK_AMBIGUOUS',
      'Could not confidently find a dense painted region near the poster center. Supply --mask with a white selected region.',
    )
  }

  const winner = candidates[0]!
  const runnerUp = candidates[1]
  const dominanceRatio = runnerUp ? winner.area / runnerUp.area : null
  if (runnerUp && runnerUp.area >= winner.area * 0.25) {
    throw new QrPosterError(
      'MASK_AMBIGUOUS',
      `Two central painted-region candidates are too similar (${winner.area} and ${runnerUp.area} pixels). Supply --mask.`,
    )
  }
  if (winner.touchesOuterBand) {
    throw new QrPosterError(
      'MASK_AMBIGUOUS',
      'The detected painted region reaches the outer 2% of the image. Supply --mask to avoid consuming the poster background.',
    )
  }

  let grown = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index++) {
    if (labels[index] === winner.label) grown[index] = 1
  }

  for (let step = 0; step < radius + 1; step++) {
    const next = grown.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        if (grown[index] || !tolerant[index]) continue
        if (hasSelectedNeighbour(grown, width, height, x, y)) next[index] = 1
      }
    }
    grown = next
  }

  const selected = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index++) selected[index] = grown[index] ? 255 : 0

  const stats = calculateMaskStats(selected, width, height)
  return {
    data: selected,
    width,
    height,
    source: 'auto',
    ...stats,
    detection: {
      strongBlackThreshold: STRONG_BLACK_THRESHOLD,
      tolerantLumaThreshold: TOLERANT_LUMA_THRESHOLD,
      separationRadius: radius,
      densityThreshold: DENSITY_THRESHOLD,
      candidateAreas: candidates.map((candidate) => candidate.area),
      dominanceRatio,
    },
  }
}

export function calculateMaskStats(
  data: Uint8Array,
  width: number,
  height: number,
): {
  area: number
  bounds: BoundingBox
  centroid: Point
} {
  let area = 0
  let sumX = 0
  let sumY = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue
      area++
      sumX += x
      sumY += y
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (area === 0) throw new QrPosterError('MASK_INVALID', 'The region mask is empty.')
  return {
    area,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    centroid: { x: sumX / area, y: sumY / area },
  }
}

function buildIntegral(data: Uint8Array, width: number, height: number): Uint32Array {
  const stride = width + 1
  const integral = new Uint32Array(stride * (height + 1))
  for (let y = 1; y <= height; y++) {
    let rowSum = 0
    for (let x = 1; x <= width; x++) {
      rowSum += data[(y - 1) * width + x - 1]!
      integral[y * stride + x] = integral[(y - 1) * stride + x]! + rowSum
    }
  }
  return integral
}

function integralSum(data: Uint32Array, stride: number, x0: number, y0: number, x1: number, y1: number): number {
  return data[y1 * stride + x1]! - data[y0 * stride + x1]! - data[y1 * stride + x0]! + data[y0 * stride + x0]!
}

function labelComponents(
  core: Uint8Array,
  width: number,
  height: number,
): {
  labels: Int32Array
  components: Component[]
} {
  const labels = new Int32Array(core.length)
  const queue = new Int32Array(core.length)
  const components: Component[] = []
  const centerMinX = width * 0.15
  const centerMaxX = width * 0.85
  const centerMinY = height * 0.15
  const centerMaxY = height * 0.85
  const outerX = width * 0.02
  const outerY = height * 0.02
  let label = 0

  for (let start = 0; start < core.length; start++) {
    if (!core[start] || labels[start]) continue
    label++
    let head = 0
    let tail = 1
    queue[0] = start
    labels[start] = label
    const component: Component = {
      label,
      area: 0,
      sumX: 0,
      sumY: 0,
      intersectsCenter: false,
      touchesOuterBand: false,
    }
    while (head < tail) {
      const index = queue[head++]!
      const x = index % width
      const y = Math.floor(index / width)
      component.area++
      component.sumX += x
      component.sumY += y
      if (x >= centerMinX && x <= centerMaxX && y >= centerMinY && y <= centerMaxY) component.intersectsCenter = true
      if (x < outerX || x >= width - outerX || y < outerY || y >= height - outerY) component.touchesOuterBand = true

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const neighbour = ny * width + nx
          if (core[neighbour] && !labels[neighbour]) {
            labels[neighbour] = label
            queue[tail++] = neighbour
          }
        }
      }
    }
    components.push(component)
  }
  return { labels, components }
}

function hasSelectedNeighbour(data: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy
    if (ny < 0 || ny >= height) continue
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      if (nx >= 0 && nx < width && data[ny * width + nx]) return true
    }
  }
  return false
}

function centerDistance(component: Component, width: number, height: number): number {
  const x = component.sumX / component.area
  const y = component.sumY / component.area
  return Math.hypot(x - width / 2, y - height / 2)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
