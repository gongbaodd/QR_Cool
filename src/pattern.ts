import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { QrCodeDataType, encode } from 'uqr'
import type { QrCodeGenerateResult } from 'uqr'
import { QrPosterError } from './errors.js'
import { loadPng } from './image.js'
import { buildManualRegionMask, detectRegionMask } from './mask.js'
import { placeQr } from './placement.js'
import { decodeQrRawDetailed, inspectAntfuQr } from './qr.js'
import type { PatternPreviewOptions, PatternPreviewResult, PatternReport } from './types.js'

/** qrcode.antfu.me defaults: ecc 'M', 2-module margin, rounded pixel style, auto mask. */
export const PATTERN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const PATTERN_ECC = 'M' as const
export const PATTERN_PIXEL_STYLE = 'rounded' as const

const QUIET_ZONE_MODULES = 2
const MAX_VERSION = 40
const REMOVED_TYPES = ['Position', 'Alignment'] as const
const ARTIFACT_NAMES = { pattern: 'pattern.png', report: 'report.json' } as const
const WEDGE_RADIUS_PADDING = 2

export interface PatternRenderWindow {
  left: number
  top: number
  width: number
  height: number
}

export interface PatternRenderOptions {
  /** Light modules drawn around the matrix; matches the toolkit's default margin of 2. */
  marginModules?: number
  /** Visible sub-rectangle of the full code canvas, in code pixels. */
  window?: PatternRenderWindow
}

/** Smallest QR version whose modules plus quiet zone cover the canvas at this pitch. */
export function selectPatternVersion(modulePixels: number, width: number, height: number): number {
  const required = Math.max(width, height)
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (totalModulesFor(version) * modulePixels >= required)
      return version
  }
  const maxModules = totalModulesFor(MAX_VERSION)
  throw new QrPosterError(
    'QR_LAYOUT_INVALID',
    `A ${modulePixels}px module pitch cannot cover the ${width}x${height} canvas: version ${MAX_VERSION} reaches only ${maxModules} modules (${maxModules * modulePixels}px including the ${QUIET_ZONE_MODULES}-module margin). Use --module-pixels ${Math.ceil(required / maxModules)} or larger.`,
  )
}

/** Random text long enough to fill the version's data capacity, so no repeating pad codewords appear. */
export function createPatternText(version: number, seed: number): string {
  let length = patternCapacity(version)
  while (length > 0) {
    const random = mulberry32(seed)
    let text = ''
    for (let index = 0; index < length; index++)
      text += PATTERN_ALPHABET[Math.floor(random() * PATTERN_ALPHABET.length)]
    if (fitsVersion(text, version))
      return text
    length--
  }
  throw new QrPosterError('QR_INVALID', `Random text could not fill a version ${version} QR code.`)
}

/** Finder patterns and alignment patterns are dropped so the pattern reads as an even cell field. */
export function stripMarkerModules(matrix: QrCodeGenerateResult): boolean[][] {
  return matrix.data.map((row, y) => row.map((dark, x) => {
    const type = matrix.types[y]?.[x] ?? QrCodeDataType.Data
    if (type === QrCodeDataType.Position || type === QrCodeDataType.Alignment)
      return false
    return dark
  }))
}

/**
 * Renders the toolkit's default rounded pixel style: one inscribed circle per dark module plus
 * corner wedges that bridge dark neighbours (and fill inner corners of light modules).
 */
export async function renderRoundedPattern(
  matrix: boolean[][],
  modulePixels: number,
  options: PatternRenderOptions = {},
): Promise<Buffer> {
  if (!Number.isInteger(modulePixels) || modulePixels < 1)
    throw new QrPosterError('INVALID_INPUT', 'modulePixels must be a positive integer.')
  if (matrix.length === 0 || matrix.some(row => row.length !== matrix.length))
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'Pattern matrix must be a non-empty square.', 3)

  const marginModules = options.marginModules ?? QUIET_ZONE_MODULES
  const modules = matrix.length
  const totalModules = modules + marginModules * 2
  const codeSize = totalModules * modulePixels
  const window = options.window ?? { left: 0, top: 0, width: codeSize, height: codeSize }
  if (window.left < 0 || window.top < 0 || window.width < 1 || window.height < 1
    || window.left + window.width > codeSize || window.top + window.height > codeSize) {
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The pattern render window must fit inside the code canvas.', 3)
  }

  const half = modulePixels / 2
  const radius = half + WEDGE_RADIUS_PADDING
  const dark = (x: number, y: number): boolean => {
    const column = x - marginModules
    const row = y - marginModules
    if (column < 0 || row < 0 || column >= modules || row >= modules)
      return false
    return matrix[row]![column]!
  }

  const circles: string[] = []
  const wedges: string[] = []
  const wedge = (key: 'tl' | 'tr' | 'bl' | 'br', ox: number, oy: number): void => {
    const right = ox + modulePixels
    const bottom = oy + modulePixels
    const paths = {
      tl: `M${ox},${oy} L${ox},${oy + half} A${radius},${radius} 0 0 1 ${ox + half},${oy} Z`,
      tr: `M${right},${oy} L${right},${oy + half} A${radius},${radius} 0 0 0 ${right - half},${oy} Z`,
      bl: `M${ox},${bottom} L${ox},${bottom - half} A${radius},${radius} 0 0 0 ${ox + half},${bottom} Z`,
      br: `M${right},${bottom} L${right},${bottom - half} A${radius},${radius} 0 0 1 ${right - half},${bottom} Z`,
    }
    wedges.push(paths[key])
  }

  for (let y = 0; y < totalModules; y++) {
    for (let x = 0; x < totalModules; x++) {
      const ox = x * modulePixels
      const oy = y * modulePixels
      const up = dark(x, y - 1)
      const down = dark(x, y + 1)
      const left = dark(x - 1, y)
      const right = dark(x + 1, y)
      if (dark(x, y)) {
        circles.push(`M${ox},${oy + half}a${half},${half} 0 1 0 ${modulePixels},0a${half},${half} 0 1 0 ${-modulePixels},0Z`)
        if (up || left)
          wedge('tl', ox, oy)
        if (up || right)
          wedge('tr', ox, oy)
        if (down || left)
          wedge('bl', ox, oy)
        if (down || right)
          wedge('br', ox, oy)
      }
      else {
        if (up && left && dark(x - 1, y - 1))
          wedge('tl', ox, oy)
        if (up && right && dark(x + 1, y - 1))
          wedge('tr', ox, oy)
        if (down && left && dark(x - 1, y + 1))
          wedge('bl', ox, oy)
        if (down && right && dark(x + 1, y + 1))
          wedge('br', ox, oy)
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${window.width}" height="${window.height}"`
    + ` viewBox="${window.left} ${window.top} ${window.width} ${window.height}">`
    + `<rect width="${codeSize}" height="${codeSize}" fill="#ffffff"/>`
    + `<path fill="#000000" d="${circles.join('')}"/>`
    + `<path fill="#000000" d="${wedges.join('')}"/>`
    + '</svg>'

  const png = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).png().toBuffer()
  const metadata = await sharp(png).metadata()
  if (metadata.width !== window.width || metadata.height !== window.height) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `Pattern rasterization produced ${metadata.width}x${metadata.height} instead of ${window.width}x${window.height}.`,
      3,
    )
  }
  return png
}

export async function generatePatternPreview(options: PatternPreviewOptions): Promise<PatternPreviewResult> {
  const startedAt = Date.now()
  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const poster = await loadPng(options.inputPath, 'poster input')
  const qrSource = await loadPng(options.qrPath, 'QR input')
  const manualMask = options.maskPath ? await loadPng(options.maskPath, 'region mask') : undefined
  const regionMask = manualMask
    ? buildManualRegionMask(manualMask, poster.width, poster.height)
    : detectRegionMask(poster)

  const decoded = decodeQrRawDetailed(qrSource.data, qrSource.width, qrSource.height)
  if (options.expectedText !== undefined && decoded.text !== options.expectedText) {
    throw new QrPosterError(
      'QR_TEXT_MISMATCH',
      `QR content does not match --text. Decoded ${JSON.stringify(decoded.text)}.`,
    )
  }
  const qrMetadata = inspectAntfuQr(qrSource, decoded.text, decoded.version)
  const placement = placeQr(regionMask, qrMetadata.totalModules, options.qrBox)

  const modulePixels = options.modulePixels ?? placement.modulePixels
  if (!Number.isInteger(modulePixels) || modulePixels < 1)
    throw new QrPosterError('INVALID_INPUT', '--module-pixels must be a positive integer.')

  const version = selectPatternVersion(modulePixels, poster.width, poster.height)
  const seed = options.seed ?? randomSeed()
  const text = createPatternText(version, seed)
  const encoded = encode(text, { ecc: PATTERN_ECC, minVersion: version, maxVersion: version, border: 0 })
  if (encoded.version !== version)
    throw new QrPosterError('QR_INVALID', `Encoder produced version ${encoded.version} instead of ${version}.`)

  const matrix = stripMarkerModules(encoded)
  const totalModules = encoded.size + QUIET_ZONE_MODULES * 2
  const codeSize = totalModules * modulePixels
  const crop = centeredCrop(codeSize, poster.width, poster.height, modulePixels)
  const pattern = await renderRoundedPattern(matrix, modulePixels, {
    window: { ...crop, width: poster.width, height: poster.height },
  })
  await writeFile(join(outputDir, ARTIFACT_NAMES.pattern), pattern)

  const warnings: string[] = []
  if (modulePixels < 6)
    warnings.push(`The pattern uses ${modulePixels}px modules; rounded cells below 6px are heavily antialiased.`)

  const report: PatternReport = {
    schemaVersion: 3,
    mode: 'pattern-preview',
    status: 'generated',
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      poster: {
        path: normalizedPath(options.inputPath),
        sha256: poster.sha256,
        width: poster.width,
        height: poster.height,
      },
      qr: {
        path: normalizedPath(options.qrPath),
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(manualMask ? { mask: { path: normalizedPath(options.maskPath!), sha256: manualMask.sha256 } } : {}),
    },
    region: {
      source: regionMask.source,
      area: regionMask.area,
      bounds: regionMask.bounds,
      centroid: regionMask.centroid,
      ...(regionMask.detection ? { detection: regionMask.detection } : {}),
    },
    placement,
    pitchSource: options.modulePixels === undefined ? 'placement' : 'override',
    pattern: {
      seed,
      alphabet: PATTERN_ALPHABET,
      textLength: text.length,
      textSha256: sha256(text),
      ecc: PATTERN_ECC,
      version,
      qrModules: encoded.size,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules,
      modulePixels,
      pixelStyle: PATTERN_PIXEL_STYLE,
      removedTypes: [...REMOVED_TYPES],
      codeSize,
      canvas: { width: poster.width, height: poster.height },
      crop,
    },
    artifacts: { pattern: ARTIFACT_NAMES.pattern, patternSha256: sha256(pattern) },
    warnings,
  }
  await writeFile(join(outputDir, ARTIFACT_NAMES.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, outputDir }
}

function totalModulesFor(version: number): number {
  return 21 + 4 * (version - 1) + QUIET_ZONE_MODULES * 2
}

function patternCapacity(version: number): number {
  let low = 0
  let high = 3072
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fitsVersion('a'.repeat(middle), version))
      low = middle
    else
      high = middle - 1
  }
  return low
}

function fitsVersion(text: string, version: number): boolean {
  try {
    encode(text, { ecc: PATTERN_ECC, minVersion: version, maxVersion: version, border: 0 })
    return true
  }
  catch {
    return false
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function centeredCrop(codeSize: number, width: number, height: number, modulePixels: number): { left: number, top: number } {
  const offset = (extent: number): number => {
    const raw = (codeSize - extent) / 2
    const aligned = Math.round(raw / modulePixels) * modulePixels
    if (aligned >= 0 && aligned + extent <= codeSize)
      return aligned
    return Math.floor(raw / modulePixels) * modulePixels
  }
  return { left: offset(width), top: offset(height) }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedPath(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
}

async function ensureOutputsAvailable(outputDir: string, force: boolean): Promise<void> {
  if (force)
    return
  const collisions: string[] = []
  for (const name of Object.values(ARTIFACT_NAMES)) {
    try {
      await access(join(outputDir, name))
      collisions.push(name)
    }
    catch {
      // Missing is the expected state.
    }
  }
  if (collisions.length > 0) {
    throw new QrPosterError(
      'OUTPUT_EXISTS',
      `Refusing to overwrite existing output files: ${collisions.join(', ')}. Use --force to replace them.`,
    )
  }
}
