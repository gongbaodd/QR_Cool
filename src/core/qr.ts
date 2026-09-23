import * as zxing from '@zxing/library'
import jsQR from 'jsqr'
import type { QRCode as JsQrResult } from 'jsqr'
import { QrCodeDataType, encode } from 'uqr'
import { imaging } from './imaging'
import { cropRgba } from './imaging/pixels'
import { PATTERN_PIXEL_STYLE, renderPattern } from './pattern'
import type { PixelStyle } from './pattern'
import { QrPosterError } from './errors'
import type { LoadedPng } from './image'
import { decodePng, luma, rgbaToPng } from './image'
import type { QrMetadata, QrSourceTrim, VerificationCheck } from './types'

const { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } =
  (zxing as unknown as { default?: typeof zxing }).default ?? zxing

const QUIET_ZONE_MODULES = 2 as const
const INK_LUMA_THRESHOLD = 128
const INK_ALPHA_THRESHOLD = 16
/** An ink bounding box may be off by a couple of antialiased pixels from the module grid. */
const GRID_SIZE_TOLERANCE = 2
/** How far the module grid origin may sit from the ink bounding box corner. */
const GRID_ORIGIN_SEARCH = 2
const MIN_VERSION = 1
const MAX_VERSION = 40
const GENERATED_QR_MODULE_PIXELS = 20
export const GENERATED_QR_PATH = '<generated>'

export interface GeneratedQr {
  image: LoadedPng
  version: number
}

export type MarkerStyle = 'square' | 'rounded'
export type MarkerShape = 'square' | 'circle' | 'octagon'
export type MarkerInner = 'square' | 'circle' | 'plus' | 'diamond'
export type MarkerSub = 'square' | 'circle'

/** Builds the same two-module-margin QR profile accepted from legacy PNG inputs. */
export async function generateQrFromContent(
  content: string,
  ecc: 'L' | 'M' | 'Q' | 'H' = 'M',
  pixelStyle: PixelStyle = PATTERN_PIXEL_STYLE,
  markerStyle: MarkerStyle = 'rounded',
  markerShape: MarkerShape = 'circle',
  markerInner: MarkerInner = 'circle',
  markerSub: MarkerSub = 'square',
): Promise<GeneratedQr> {
  if (content.trim().length === 0)
    throw new QrPosterError('INVALID_INPUT', '--content must not be empty or whitespace-only.')
  if (/\r|\n/.test(content)) throw new QrPosterError('INVALID_INPUT', '--content must contain exactly one line.')

  let encoded
  try {
    encoded = encode(content, { ecc, maskPattern: -1, border: 0 })
  } catch (error) {
    throw new QrPosterError(
      'QR_INVALID',
      'Could not encode --content as a QR code. The content may exceed the QR capacity.',
      2,
      { cause: error },
    )
  }

  const marginModules = QUIET_ZONE_MODULES
  const pitch = GENERATED_QR_MODULE_PIXELS
  const size = encoded.size

  // Base layer: all modules except finder cells and, for circular sub markers, alignment cells.
  const basePng = await renderPattern(encoded.data, pitch, pixelStyle, {
    skipInk: (moduleX, moduleY) => {
      const x = moduleX - marginModules
      const y = moduleY - marginModules
      if (x < 0 || y < 0 || x >= size || y >= size) return false
      const t = encoded.types[y]?.[x]
      if (t === QrCodeDataType.Position) return true
      if (t === QrCodeDataType.Alignment && markerSub === 'circle') return true
      return false
    },
  })

  const overlays: string[] = []
  const finderSvg = buildFinderSvg(size, pitch, marginModules, markerShape, markerInner, markerStyle)
  if (finderSvg) overlays.push(finderSvg)
  if (markerSub === 'circle') {
    const alignmentSvg = buildAlignmentSvg(encoded, pitch, marginModules)
    if (alignmentSvg) overlays.push(alignmentSvg)
  }

  const file = await imaging().composeQrPng(basePng, overlays)
  return {
    image: await decodePng(file, GENERATED_QR_PATH, 'generated QR'),
    version: encoded.version,
  }
}

function buildFinderSvg(
  modules: number,
  pitch: number,
  marginModules: number,
  shape: MarkerShape,
  inner: MarkerInner,
  markerStyle: MarkerStyle,
): string {
  const size = (modules + marginModules * 2) * pitch
  const origins = [
    [0, 0],
    [modules - 7, 0],
    [0, modules - 7],
  ] as const
  const rounded = markerStyle === 'rounded'
  const parts: string[] = []
  for (const [x, y] of origins) {
    const ox = (marginModules + x) * pitch
    const oy = (marginModules + y) * pitch
    const cx = ox + 3.5 * pitch
    const cy = oy + 3.5 * pitch
    if (shape === 'square') {
      const rx = rounded ? pitch * 0.35 : 0
      // outer 7x7 dark
      parts.push(
        `<rect x="${ox}" y="${oy}" width="${7 * pitch}" height="${7 * pitch}" fill="#000" rx="${rx}" ry="${rx}"/>`,
      )
      // white 5x5
      parts.push(
        `<rect x="${ox + pitch}" y="${oy + pitch}" width="${5 * pitch}" height="${5 * pitch}" fill="#fff" rx="${rx * 0.6}" ry="${rx * 0.6}"/>`,
      )
      // inner shape
      if (inner === 'square') {
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 1.5 * pitch}" width="${3 * pitch}" height="${3 * pitch}" fill="#000" rx="${rx * 0.5}" ry="${rx * 0.5}"/>`,
        )
      } else if (inner === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${1.5 * pitch}" fill="#000"/>`)
      } else if (inner === 'plus') {
        // plus = cross of 3 modules
        parts.push(
          `<rect x="${cx - 0.5 * pitch}" y="${cy - 1.5 * pitch}" width="${pitch}" height="${3 * pitch}" fill="#000"/>`,
        )
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 0.5 * pitch}" width="${3 * pitch}" height="${pitch}" fill="#000"/>`,
        )
      } else if (inner === 'diamond') {
        parts.push(
          `<polygon points="${cx},${cy - 1.5 * pitch} ${cx + 1.5 * pitch},${cy} ${cx},${cy + 1.5 * pitch} ${cx - 1.5 * pitch},${cy}" fill="#000"/>`,
        )
      }
    } else if (shape === 'circle') {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${3.5 * pitch}" fill="#000"/>`)
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${2.5 * pitch}" fill="#fff"/>`)
      if (inner === 'square') {
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 1.5 * pitch}" width="${3 * pitch}" height="${3 * pitch}" fill="#000"/>`,
        )
      } else if (inner === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${1.5 * pitch}" fill="#000"/>`)
      } else if (inner === 'plus') {
        parts.push(
          `<rect x="${cx - 0.5 * pitch}" y="${cy - 1.5 * pitch}" width="${pitch}" height="${3 * pitch}" fill="#000"/>`,
        )
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 0.5 * pitch}" width="${3 * pitch}" height="${pitch}" fill="#000"/>`,
        )
      } else if (inner === 'diamond') {
        parts.push(
          `<polygon points="${cx},${cy - 1.5 * pitch} ${cx + 1.5 * pitch},${cy} ${cx},${cy + 1.5 * pitch} ${cx - 1.5 * pitch},${cy}" fill="#000"/>`,
        )
      }
    } else if (shape === 'octagon') {
      const outer = octagonPoints(cx, cy, 3.5 * pitch)
      const innerWhite = octagonPoints(cx, cy, 2.5 * pitch)
      parts.push(`<polygon points="${outer}" fill="#000"/>`)
      parts.push(`<polygon points="${innerWhite}" fill="#fff"/>`)
      if (inner === 'square') {
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 1.5 * pitch}" width="${3 * pitch}" height="${3 * pitch}" fill="#000"/>`,
        )
      } else if (inner === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${1.5 * pitch}" fill="#000"/>`)
      } else if (inner === 'plus') {
        parts.push(
          `<rect x="${cx - 0.5 * pitch}" y="${cy - 1.5 * pitch}" width="${pitch}" height="${3 * pitch}" fill="#000"/>`,
        )
        parts.push(
          `<rect x="${cx - 1.5 * pitch}" y="${cy - 0.5 * pitch}" width="${3 * pitch}" height="${pitch}" fill="#000"/>`,
        )
      } else if (inner === 'diamond') {
        parts.push(
          `<polygon points="${cx},${cy - 1.5 * pitch} ${cx + 1.5 * pitch},${cy} ${cx},${cy + 1.5 * pitch} ${cx - 1.5 * pitch},${cy}" fill="#000"/>`,
        )
      }
    }
  }
  if (parts.length === 0) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${parts.join('')}</svg>`
}

function octagonPoints(cx: number, cy: number, size: number): string {
  const dx = (1.5 / 3.5) * size
  const dy = size
  const pts: [number, number][] = [
    [dx, dy],
    [-dx, dy],
    [-dy, dx],
    [-dy, -dx],
    [-dx, -dy],
    [dx, -dy],
    [dy, -dx],
    [dy, dx],
  ]
  return pts.map(([x, y]) => `${cx + x},${cy + y}`).join(' ')
}

function buildAlignmentSvg(encoded: ReturnType<typeof encode>, pitch: number, marginModules: number): string | null {
  const size = encoded.size
  const total = (size + marginModules * 2) * pitch
  const visited = new Set<string>()
  const blocks: { minX: number; minY: number }[] = []
  const isAlignment = (x: number, y: number) => encoded.types[y]?.[x] === QrCodeDataType.Alignment
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isAlignment(x, y) || visited.has(`${x},${y}`)) continue
      // BFS to collect block
      const queue: [number, number][] = [[x, y]]
      visited.add(`${x},${y}`)
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y
      let idx = 0
      while (idx < queue.length) {
        const [cx, cy] = queue[idx++]!
        const neighbours: [number, number][] = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          if (!isAlignment(nx, ny) || visited.has(`${nx},${ny}`)) continue
          visited.add(`${nx},${ny}`)
          queue.push([nx, ny])
          if (nx < minX) minX = nx
          if (nx > maxX) maxX = nx
          if (ny < minY) minY = ny
          if (ny > maxY) maxY = ny
        }
      }
      // expect 5x5
      if (maxX - minX === 4 && maxY - minY === 4) blocks.push({ minX, minY })
    }
  }
  if (blocks.length === 0) return null
  const parts: string[] = []
  for (const { minX, minY } of blocks) {
    const cx = (marginModules + minX + 2.5) * pitch
    const cy = (marginModules + minY + 2.5) * pitch
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${2.5 * pitch}" fill="#000"/>`)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${1.5 * pitch}" fill="#fff"/>`)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${0.5 * pitch}" fill="#000"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}">${parts.join('')}</svg>`
}

export async function decodeQrBuffer(buffer: Uint8Array): Promise<string> {
  return (await decodeQrBufferDetailed(buffer)).text
}

export interface DecodedQr {
  text: string
  decoder: 'zxing' | 'jsqr'
  version?: number
}

async function decodeQrBufferDetailed(buffer: Uint8Array): Promise<DecodedQr> {
  const { data, width, height } = await imaging().decodePng(buffer)
  return decodeQrRawDetailed(data, width, height)
}

export function decodeQrRaw(data: Uint8Array, width: number, height: number): string {
  return decodeQrRawDetailed(data, width, height).text
}

export function decodeQrRawDetailed(data: Uint8Array, width: number, height: number): DecodedQr {
  const pixels = Uint8ClampedArray.from(data)
  // jsQR also supplies the version, required to normalize tight input crops unambiguously.
  const decoded = (
    jsQR as unknown as (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      options: { inversionAttempts: 'attemptBoth' },
    ) => JsQrResult | null
  )(pixels, width, height, { inversionAttempts: 'attemptBoth' })
  if (decoded) return { text: decoded.data, decoder: 'jsqr', version: decoded.version }
  try {
    // ZXing expects one luminance byte per pixel, not interleaved RGBA.
    const luminances = new Uint8ClampedArray(width * height)
    for (let i = 0; i < luminances.length; i++)
      luminances[i] = luma(pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!)
    const source = new RGBLuminanceSource(luminances, width, height)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const hints = new Map<number, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [DecodeHintType.CHARACTER_SET, 'UTF-8'],
    ])
    return { text: new QRCodeReader().decode(bitmap, hints).getText(), decoder: 'zxing' }
  } catch (cause) {
    throw new QrPosterError('QR_INVALID', 'The QR code could not be decoded by ZXing or jsQR.', 2, { cause })
  }
}

export function inspectAntfuQr(image: LoadedPng, decodedText: string, detectedVersion?: number): QrMetadata {
  if (image.width !== image.height)
    throw new QrPosterError('QR_INVALID', `QR image must be square; received ${image.width}x${image.height}.`)

  const candidates = quietZoneProfileCandidates(image, detectedVersion)

  if (candidates.length !== 1) {
    throw new QrPosterError(
      'QR_INVALID',
      `QR dimensions do not uniquely match the qrcode.antfu.me two-module quiet-zone profile (found ${candidates.length} candidates).`,
    )
  }

  const candidate = candidates[0]!
  return {
    width: image.width,
    height: image.height,
    decodedText,
    version: candidate.version,
    qrModules: candidate.qrModules,
    quietZoneModules: QUIET_ZONE_MODULES,
    totalModules: candidate.totalModules,
    sourceModulePixels: candidate.cell,
    quietZoneLightRatio: candidate.lightRatio,
  }
}

interface QuietZoneProfileCandidate {
  version: number
  qrModules: number
  totalModules: number
  cell: number
  lightRatio: number
}

/** Square, integer-scaled inputs whose outer two modules are light; the documented profile. */
function quietZoneProfileCandidates(image: LoadedPng, detectedVersion?: number): QuietZoneProfileCandidate[] {
  const candidates: QuietZoneProfileCandidate[] = []
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const qrModules = 21 + 4 * (version - 1)
    const totalModules = qrModules + QUIET_ZONE_MODULES * 2
    if (image.width % totalModules !== 0) continue
    const cell = image.width / totalModules
    const lightRatio = quietZoneLightRatio(image.data, image.width, image.height, QUIET_ZONE_MODULES * cell)
    if (cell >= 1 && lightRatio >= 0.98 && (detectedVersion === undefined || version === detectedVersion))
      candidates.push({ version, qrModules, totalModules, cell, lightRatio })
  }
  return candidates
}

/** A code grid recovered from an image whose outer margin is missing or uneven. */
interface CodeGrid {
  version: number
  qrModules: number
  modulePixels: number
  left: number
  top: number
  /** Mean per-module luma variance; lower means the grid lines up better. */
  variance: number
}

export interface ResolvedQrSource {
  /** The file as supplied, kept for input reporting. */
  source: LoadedPng
  /** A square image with a two-module quiet zone, ready for metadata and normalization. */
  image: LoadedPng
  /** `added` when the input was a trimmed code grid and the margin was rebuilt locally. */
  quietZoneSource: 'source' | 'added'
  trim?: QrSourceTrim
}

/**
 * Resolves a QR input to a square image with a two-module quiet zone. The documented profile is
 * preferred; a bare code grid (no margin, or a margin that is not a whole module) is recovered by
 * locating the integer-scaled module grid and re-padding it with a fresh light margin, so a tight
 * crop such as `source/qr.png` is accepted without resampling a single code pixel.
 */
export async function resolveQrSource(source: LoadedPng, detectedVersion?: number): Promise<ResolvedQrSource> {
  const candidates = source.width === source.height ? quietZoneProfileCandidates(source, detectedVersion) : []
  if (candidates.length === 1) return { source, image: source, quietZoneSource: 'source' }

  const grid = detectCodeGrid(source, detectedVersion)
  if (!grid) {
    const reason =
      source.width === source.height
        ? `found ${candidates.length} matching two-module quiet-zone profiles`
        : `the image is ${source.width}x${source.height}, not square`
    throw new QrPosterError(
      'QR_INVALID',
      `QR input does not match the qrcode.antfu.me profile (${reason}) and no integer-scaled code grid` +
        ` could be recovered from its pixels. Supply a square QR PNG with a two-module light margin,` +
        ` or a code-only crop whose modules are an integer number of pixels.`,
    )
  }

  const codeSize = grid.qrModules * grid.modulePixels
  return {
    source,
    image: await rebuildQuietZone(source, grid),
    quietZoneSource: 'added',
    trim: {
      left: grid.left,
      top: grid.top,
      right: source.width - grid.left - codeSize,
      bottom: source.height - grid.top - codeSize,
      modulePixels: grid.modulePixels,
    },
  }
}

function detectCodeGrid(image: LoadedPng, detectedVersion?: number): CodeGrid | undefined {
  const { data, width, height } = image
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (data[offset + 3]! < INK_ALPHA_THRESHOLD) continue
      if (luma(data[offset]!, data[offset + 1]!, data[offset + 2]!) >= INK_LUMA_THRESHOLD) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return undefined

  const inkWidth = maxX - minX + 1
  const inkHeight = maxY - minY + 1
  const sums = buildLumaIntegrals(image)
  const candidates: CodeGrid[] = []
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const qrModules = 21 + 4 * (version - 1)
    const modulePixels = Math.round((inkWidth + inkHeight) / (2 * qrModules))
    if (modulePixels < 1) continue
    const codeSize = qrModules * modulePixels
    if (Math.abs(codeSize - inkWidth) > GRID_SIZE_TOLERANCE || Math.abs(codeSize - inkHeight) > GRID_SIZE_TOLERANCE)
      continue
    if (codeSize > width || codeSize > height) continue

    let best: { left: number; top: number; variance: number } | undefined
    const leftMin = Math.max(0, minX - GRID_ORIGIN_SEARCH)
    const leftMax = Math.min(width - codeSize, minX + GRID_ORIGIN_SEARCH)
    const topMin = Math.max(0, minY - GRID_ORIGIN_SEARCH)
    const topMax = Math.min(height - codeSize, minY + GRID_ORIGIN_SEARCH)
    for (let left = leftMin; left <= leftMax; left++) {
      for (let top = topMin; top <= topMax; top++) {
        // The window must contain every ink pixel, so only the grid phase is being searched.
        if (left > minX || top > minY || left + codeSize < maxX + 1 || top + codeSize < maxY + 1) continue
        const variance = moduleGridVariance(sums, width, left, top, qrModules, modulePixels)
        if (!best || variance < best.variance) best = { left, top, variance }
      }
    }
    if (best) candidates.push({ version, qrModules, modulePixels, ...best })
  }
  if (candidates.length === 0) return undefined

  // The decoded version is authoritative when a grid of that size fits the ink box.
  const decoded = candidates.find((candidate) => candidate.version === detectedVersion)
  if (decoded) return decoded
  return candidates.sort((left, right) => left.variance - right.variance)[0]
}

function buildLumaIntegrals(image: LoadedPng): { sums: Float64Array; squares: Float64Array } {
  const { data, width, height } = image
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  const squares = new Float64Array(stride * (height + 1))
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const offset = ((y - 1) * width + x - 1) * 4
      const value = luma(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      sums[y * stride + x] =
        sums[(y - 1) * stride + x]! + sums[y * stride + x - 1]! - sums[(y - 1) * stride + x - 1]! + value
      squares[y * stride + x] =
        squares[(y - 1) * stride + x]! +
        squares[y * stride + x - 1]! -
        squares[(y - 1) * stride + x - 1]! +
        value * value
    }
  }
  return { sums, squares }
}

function moduleGridVariance(
  integrals: { sums: Float64Array; squares: Float64Array },
  stride: number,
  left: number,
  top: number,
  modules: number,
  modulePixels: number,
): number {
  const area = modulePixels * modulePixels
  let total = 0
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      const x0 = left + column * modulePixels
      const y0 = top + row * modulePixels
      const x1 = x0 + modulePixels
      const y1 = y0 + modulePixels
      const sum = integralBox(integrals.sums, stride, x0, y0, x1, y1)
      const square = integralBox(integrals.squares, stride, x0, y0, x1, y1)
      total += square / area - (sum / area) ** 2
    }
  }
  return total / (modules * modules)
}

function integralBox(integral: Float64Array, stride: number, x0: number, y0: number, x1: number, y1: number): number {
  return (
    integral[y1 * stride + x1]! -
    integral[y0 * stride + x1]! -
    integral[y1 * stride + x0]! +
    integral[y0 * stride + x0]!
  )
}

/** Copies the code grid 1:1 onto a fresh light margin; the code pixels are flattened, not rescaled. */
async function rebuildQuietZone(image: LoadedPng, grid: CodeGrid): Promise<LoadedPng> {
  const margin = QUIET_ZONE_MODULES * grid.modulePixels
  const codeSize = grid.qrModules * grid.modulePixels
  const size = codeSize + margin * 2
  const output = new Uint8Array(size * size * 4)
  output.fill(255)
  for (let y = 0; y < codeSize; y++) {
    for (let x = 0; x < codeSize; x++) {
      const sourceOffset = ((grid.top + y) * image.width + grid.left + x) * 4
      const targetOffset = ((margin + y) * size + margin + x) * 4
      const alpha = image.data[sourceOffset + 3]! / 255
      for (let channel = 0; channel < 3; channel++) {
        const value = image.data[sourceOffset + channel]!
        output[targetOffset + channel] = Math.round(value * alpha + 255 * (1 - alpha))
      }
      output[targetOffset + 3] = 255
    }
  }
  return decodePng(await rgbaToPng(output, size, size), image.path, 'QR input')
}

export async function normalizeQr(image: LoadedPng, targetSize: number): Promise<Uint8Array> {
  return imaging().normalizeQrPng(image.file, targetSize)
}

/** Converts the normalized QR's white/light pixels to alpha for preview and standalone PNG export. */
export async function transparentQrBackground(png: Uint8Array): Promise<Uint8Array> {
  const image = await imaging().decodePng(png)
  const pixels = Uint8Array.from(image.data)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const luminance = Math.round((299 * pixels[offset]! + 587 * pixels[offset + 1]! + 114 * pixels[offset + 2]!) / 1000)
    pixels[offset] = 0
    pixels[offset + 1] = 0
    pixels[offset + 2] = 0
    pixels[offset + 3] = Math.min(pixels[offset + 3]!, 255 - luminance)
  }
  return imaging().encodePngRgba(pixels, image.width, image.height)
}

export async function verifyQrVariant(
  name: VerificationCheck['name'],
  buffer: Uint8Array,
  expectedText: string,
): Promise<VerificationCheck> {
  try {
    const decoded = await decodeQrBufferDetailed(buffer)
    if (decoded.text !== expectedText) {
      return {
        name,
        passed: false,
        decodedText: decoded.text,
        decoder: decoded.decoder,
        ...(decoded.version !== undefined ? { version: decoded.version } : {}),
        error: `Decoded content differs from the expected text.`,
      }
    }
    return {
      name,
      passed: true,
      decodedText: decoded.text,
      decoder: decoded.decoder,
      ...(decoded.version !== undefined ? { version: decoded.version } : {}),
    }
  } catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function quietZoneLightRatio(data: Uint8Array, width: number, height: number, marginPixels: number): number {
  let light = 0
  let total = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= marginPixels && x < width - marginPixels && y >= marginPixels && y < height - marginPixels) continue
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]!
      const brightness = luma(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      if (alpha < 16 || brightness >= 200) light++
      total++
    }
  }
  return total === 0 ? 0 : light / total
}

/** Crop whole modules from the central third, away from the corner finder markers. */
export async function cropQrPattern(qr: Uint8Array, totalModules: number, modulePixels: number): Promise<Uint8Array> {
  const modules = Math.min(Math.floor(totalModules / 3), totalModules - 20)
  const start = Math.floor((totalModules - modules) / 2) * modulePixels
  const raw = await imaging().decodePng(qr)
  const size = modules * modulePixels
  const cropped = cropRgba(raw, start, start, size, size)
  return imaging().encodePngRgba(cropped, size, size)
}
