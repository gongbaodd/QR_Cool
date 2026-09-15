import zxing from '@zxing/library'
import jsQR from 'jsqr'
import type { QRCode as JsQrResult } from 'jsqr'
import sharp from 'sharp'
import { QrCodeDataType, encode } from 'uqr'
import { QrPosterError } from './errors.js'
import type { LoadedPng } from './image.js'
import { decodePng, luma, rgbaToPng } from './image.js'
import type { QrMetadata, QrSourceTrim, VerificationCheck } from './types.js'

const {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} = zxing

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

/** Builds the same rounded, two-module-margin QR profile accepted from legacy PNG inputs. */
export async function generateQrFromContent(content: string): Promise<GeneratedQr> {
  if (content.trim().length === 0)
    throw new QrPosterError('INVALID_INPUT', '--content must not be empty or whitespace-only.')
  if (/\r|\n/.test(content))
    throw new QrPosterError('INVALID_INPUT', '--content must contain exactly one line.')

  let encoded
  try {
    encoded = encode(content, { ecc: 'M', maskPattern: -1, border: 0 })
  }
  catch (error) {
    throw new QrPosterError(
      'QR_INVALID',
      'Could not encode --content as a QR code. The content may exceed the QR capacity.',
      2,
      { cause: error },
    )
  }

  // Keep pattern.ts as the single source of truth for the qrcode.antfu.me rounded cell geometry.
  // The dynamic import avoids a static layout -> qr -> pattern -> layout module cycle.
  const { renderRoundedPattern } = await import('./pattern.js')
  const marginModules = QUIET_ZONE_MODULES
  const rounded = await renderRoundedPattern(encoded.data, GENERATED_QR_MODULE_PIXELS, {
    skipInk: (moduleX, moduleY) => {
      const x = moduleX - marginModules
      const y = moduleY - marginModules
      return encoded.types[y]?.[x] === QrCodeDataType.Position
    },
  })
  const file = await sharp(rounded)
    .composite([{ input: Buffer.from(finderMarkerSvg(encoded.size, GENERATED_QR_MODULE_PIXELS, marginModules)) }])
    .png()
    .toBuffer()
  return {
    image: await decodePng(file, GENERATED_QR_PATH, 'generated QR'),
    version: encoded.version,
  }
}

/** Circular qrcode.antfu.me finder markers over the cleared Position cells. */
function finderMarkerSvg(modules: number, pitch: number, marginModules: number): string {
  const size = (modules + marginModules * 2) * pitch
  const origins = [[0, 0], [modules - 7, 0], [0, modules - 7]] as const
  const markers = origins.map(([x, y]) => {
    const cx = (marginModules + x + 3.5) * pitch
    const cy = (marginModules + y + 3.5) * pitch
    return `<circle cx="${cx}" cy="${cy}" r="${3.5 * pitch}" fill="#000"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${2.5 * pitch}" fill="#fff"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${1.5 * pitch}" fill="#000"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${markers}</svg>`
}

export async function decodeQrBuffer(buffer: Buffer): Promise<string> {
  return (await decodeQrBufferDetailed(buffer)).text
}

export interface DecodedQr {
  text: string
  decoder: 'zxing' | 'jsqr'
  version?: number
}

async function decodeQrBufferDetailed(buffer: Buffer): Promise<DecodedQr> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return decodeQrRawDetailed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height)
}

export function decodeQrRaw(data: Uint8Array, width: number, height: number): string {
  return decodeQrRawDetailed(data, width, height).text
}

export function decodeQrRawDetailed(data: Uint8Array, width: number, height: number): DecodedQr {
  const pixels = Uint8ClampedArray.from(data)
  try {
    const source = new RGBLuminanceSource(pixels, width, height)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const hints = new Map<number, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [DecodeHintType.CHARACTER_SET, 'UTF-8'],
    ])
    return { text: new QRCodeReader().decode(bitmap, hints).getText(), decoder: 'zxing' }
  }
  catch (zxingError) {
    const fallback = (jsQR as unknown as (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      options: { inversionAttempts: 'attemptBoth' },
    ) => JsQrResult | null)(pixels, width, height, { inversionAttempts: 'attemptBoth' })
    if (fallback)
      return { text: fallback.data, decoder: 'jsqr', version: fallback.version }
    throw new QrPosterError('QR_INVALID', 'The QR code could not be decoded by ZXing or jsQR.', 2, { cause: zxingError })
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
    if (image.width % totalModules !== 0)
      continue
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
  const candidates = source.width === source.height
    ? quietZoneProfileCandidates(source, detectedVersion)
    : []
  if (candidates.length === 1)
    return { source, image: source, quietZoneSource: 'source' }

  const grid = detectCodeGrid(source, detectedVersion)
  if (!grid) {
    const reason = source.width === source.height
      ? `found ${candidates.length} matching two-module quiet-zone profiles`
      : `the image is ${source.width}x${source.height}, not square`
    throw new QrPosterError(
      'QR_INVALID',
      `QR input does not match the qrcode.antfu.me profile (${reason}) and no integer-scaled code grid`
      + ` could be recovered from its pixels. Supply a square QR PNG with a two-module light margin,`
      + ` or a code-only crop whose modules are an integer number of pixels.`,
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
      if (data[offset + 3]! < INK_ALPHA_THRESHOLD)
        continue
      if (luma(data[offset]!, data[offset + 1]!, data[offset + 2]!) >= INK_LUMA_THRESHOLD)
        continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0)
    return undefined

  const inkWidth = maxX - minX + 1
  const inkHeight = maxY - minY + 1
  const sums = buildLumaIntegrals(image)
  const candidates: CodeGrid[] = []
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const qrModules = 21 + 4 * (version - 1)
    const modulePixels = Math.round((inkWidth + inkHeight) / (2 * qrModules))
    if (modulePixels < 1)
      continue
    const codeSize = qrModules * modulePixels
    if (Math.abs(codeSize - inkWidth) > GRID_SIZE_TOLERANCE || Math.abs(codeSize - inkHeight) > GRID_SIZE_TOLERANCE)
      continue
    if (codeSize > width || codeSize > height)
      continue

    let best: { left: number, top: number, variance: number } | undefined
    const leftMin = Math.max(0, minX - GRID_ORIGIN_SEARCH)
    const leftMax = Math.min(width - codeSize, minX + GRID_ORIGIN_SEARCH)
    const topMin = Math.max(0, minY - GRID_ORIGIN_SEARCH)
    const topMax = Math.min(height - codeSize, minY + GRID_ORIGIN_SEARCH)
    for (let left = leftMin; left <= leftMax; left++) {
      for (let top = topMin; top <= topMax; top++) {
        // The window must contain every ink pixel, so only the grid phase is being searched.
        if (left > minX || top > minY || left + codeSize < maxX + 1 || top + codeSize < maxY + 1)
          continue
        const variance = moduleGridVariance(sums, width, left, top, qrModules, modulePixels)
        if (!best || variance < best.variance)
          best = { left, top, variance }
      }
    }
    if (best)
      candidates.push({ version, qrModules, modulePixels, ...best })
  }
  if (candidates.length === 0)
    return undefined

  // The decoded version is authoritative when a grid of that size fits the ink box.
  const decoded = candidates.find(candidate => candidate.version === detectedVersion)
  if (decoded)
    return decoded
  return candidates.sort((left, right) => left.variance - right.variance)[0]
}

function buildLumaIntegrals(image: LoadedPng): { sums: Float64Array, squares: Float64Array } {
  const { data, width, height } = image
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  const squares = new Float64Array(stride * (height + 1))
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const offset = ((y - 1) * width + x - 1) * 4
      const value = luma(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      sums[y * stride + x] = sums[(y - 1) * stride + x]! + sums[y * stride + x - 1]! - sums[(y - 1) * stride + x - 1]! + value
      squares[y * stride + x] = squares[(y - 1) * stride + x]! + squares[y * stride + x - 1]! - squares[(y - 1) * stride + x - 1]! + value * value
    }
  }
  return { sums, squares }
}

function moduleGridVariance(
  integrals: { sums: Float64Array, squares: Float64Array },
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
  return integral[y1 * stride + x1]! - integral[y0 * stride + x1]! - integral[y1 * stride + x0]! + integral[y0 * stride + x0]!
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

export async function normalizeQr(image: LoadedPng, targetSize: number): Promise<Buffer> {
  return sharp(image.file)
    .flatten({ background: '#ffffff' })
    .resize(targetSize, targetSize, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
}

export async function verifyQrVariant(name: VerificationCheck['name'], buffer: Buffer, expectedText: string): Promise<VerificationCheck> {
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
  }
  catch (error) {
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
      if (x >= marginPixels && x < width - marginPixels && y >= marginPixels && y < height - marginPixels)
        continue
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]!
      const brightness = luma(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      if (alpha < 16 || brightness >= 200)
        light++
      total++
    }
  }
  return total === 0 ? 0 : light / total
}
