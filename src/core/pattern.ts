import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { QrCodeDataType, encode } from 'uqr'
import type { QrCodeGenerateResult } from 'uqr'
import { QrPosterError } from './errors.js'
import type { PatternPreviewOptions, PatternPreviewResult, PatternReport } from './types.js'

/** qrcode.antfu.me defaults: ecc 'M', 2-module margin, rounded pixel style, auto mask. */
export const PATTERN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const PATTERN_ECC = 'M' as const
export const PATTERN_PIXEL_STYLE = 'rounded' as const
export const PATTERN_MARKER_REFILL = 'seeded-random' as const
/** Light modules the toolkit draws around the code; the texture's own quiet zone. */
export const PATTERN_QUIET_ZONE_MODULES = 2 as const

const QUIET_ZONE_MODULES = PATTERN_QUIET_ZONE_MODULES
const MAX_VERSION = 40
const REMOVED_TYPES = ['Position', 'Alignment'] as const
const REFILL_SEED_SALT = 0x9E3779B9
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
  /**
   * Draws only the modules this predicate accepts, addressed in code-module coordinates
   * (`0 .. totalModules - 1`, margin included). A rejected module renders nothing and counts as
   * light when wedge neighbours are resolved, so the drawn area stays a union of whole modules and
   * its edge closes on the silhouette. Without it every module is drawn on one white canvas,
   * exactly as `--pattern-preview` renders.
   */
  include?: (moduleX: number, moduleY: number) => boolean
  /** Suppresses black geometry for selected cells while retaining the white canvas beneath them. */
  skipInk?: (moduleX: number, moduleY: number) => boolean
}

export interface PosterPatternOptions {
  /** Poster canvas width in pixels. */
  width: number
  /** Poster canvas height in pixels. */
  height: number
  /** Module pitch in poster pixels. */
  modulePixels: number
  /** Seed for the random text line and the marker refill; defaults to a fresh random seed per run. */
  seed?: number
  /**
   * Poster-space origin of a module lattice to phase-lock the window to, typically the placed QR box.
   * The texture's module boundaries then land on the same lattice as the QR's, so the field
   * continues the code's rhythm. Without it the window stays centered as before.
   */
  alignTo?: { x: number, y: number }
}

export interface PosterPattern {
  png: Buffer
  seed: number
  version: number
  text: string
  /** Marker-free module matrix, marker cells refilled with seeded random bits. */
  matrix: boolean[][]
  qrModules: number
  totalModules: number
  codeSize: number
  marginModules: number
  crop: { left: number, top: number }
  refilledModules: number
}

/** The generated texture's lattice, its matrix, and how the window sits on it. */
export type PosterPatternLattice = Omit<PosterPattern, 'png'>

/**
 * Smallest QR version whose modules plus quiet zone cover the canvas at this pitch. A caller that
 * needs to phase-lock the window (see `alignTo`) asks for one module of headroom, so the code is
 * wider than the canvas and the window can still be shifted onto the requested lattice.
 */
export function selectPatternVersion(
  modulePixels: number,
  width: number,
  height: number,
  headroomPixels = 0,
): number {
  const required = Math.max(width, height) + headroomPixels
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

/**
 * Finder patterns and alignment patterns are dropped, then refilled with seeded random bits. Leaving
 * those cells light would punch a 9x9 (finder) or 5x5 (alignment) white hole into the texture; the
 * refill keeps the field even. The refill stream is derived from the run seed, so a seed reproduces
 * the whole pattern.
 */
export function stripMarkerModules(matrix: QrCodeGenerateResult, seed: number): boolean[][] {
  const random = mulberry32(markerRefillSeed(seed))
  return matrix.data.map((row, y) => row.map((dark, x) => {
    const type = matrix.types[y]?.[x] ?? QrCodeDataType.Data
    if (type === QrCodeDataType.Position || type === QrCodeDataType.Alignment)
      return random() < 0.5
    return dark
  }))
}

/** Cells the marker refill replaces: the three 9x9 finder areas plus every 5x5 alignment block. */
export function countMarkerModules(matrix: QrCodeGenerateResult): number {
  let count = 0
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      const type = matrix.types[y]?.[x] ?? QrCodeDataType.Data
      if (type === QrCodeDataType.Position || type === QrCodeDataType.Alignment)
        count++
    }
  }
  return count
}

/** Separate stream from the text line, so refill bits never reuse the text generator's state. */
function markerRefillSeed(seed: number): number {
  return (seed ^ REFILL_SEED_SALT) >>> 0
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
  const include = options.include
  const skipInk = options.skipInk
  const included = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= totalModules || y >= totalModules)
      return false
    return include === undefined || include(x, y)
  }
  // A module outside the drawn set is light for every purpose, so a dark neighbour the cut drops
  // cannot pull a wedge into the artwork around the silhouette.
  const dark = (x: number, y: number): boolean => {
    if (!included(x, y))
      return false
    if (skipInk?.(x, y))
      return false
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
      if (!included(x, y))
        continue
      if (skipInk?.(x, y))
        continue
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

  // Without an include mask the whole canvas is one white field, exactly as before. With one, only
  // the drawn modules carry the texture's white, so the artwork shows through the dropped ones.
  const background = include === undefined
    ? `<rect width="${codeSize}" height="${codeSize}" fill="#ffffff"/>`
    : `<path fill="#ffffff" d="${includedCells(include, totalModules, modulePixels)}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${window.width}" height="${window.height}"`
    + ` viewBox="${window.left} ${window.top} ${window.width} ${window.height}">`
    + background
    + `<path fill="#000000" d="${circles.join('')}"/>`
    + `<path fill="#000000" d="${wedges.join('')}"/>`
    + '</svg>'

  const raster = sharp(Buffer.from(svg))
  const png = await (include === undefined ? raster.flatten({ background: '#ffffff' }) : raster)
    .png()
    .toBuffer()
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

/**
 * Renders the poster-sized marker-free texture at a fixed module pitch. The version is the smallest
 * whose modules plus margin cover the canvas, the code is center-cropped at whole-module offsets,
 * and the same seed reproduces the same bytes.
 */
export async function buildPosterPattern(options: PosterPatternOptions): Promise<PosterPatternLattice> {
  const { width, height, modulePixels } = options
  if (!Number.isInteger(modulePixels) || modulePixels < 1)
    throw new QrPosterError('INVALID_INPUT', 'modulePixels must be a positive integer.')

  // Phase-locking needs one module of freedom in each direction, so an aligned texture asks for a
  // version wide enough to leave that gap. The centered preview keeps the tightest version.
  const version = selectPatternVersion(
    modulePixels,
    width,
    height,
    options.alignTo === undefined ? 0 : modulePixels,
  )
  const seed = options.seed ?? randomSeed()
  const text = createPatternText(version, seed)
  const encoded = encode(text, { ecc: PATTERN_ECC, minVersion: version, maxVersion: version, border: 0 })
  if (encoded.version !== version)
    throw new QrPosterError('QR_INVALID', `Encoder produced version ${encoded.version} instead of ${version}.`)

  const matrix = stripMarkerModules(encoded, seed)
  const totalModules = encoded.size + QUIET_ZONE_MODULES * 2
  const codeSize = totalModules * modulePixels
  const crop = centeredCrop(codeSize, width, height, modulePixels, options.alignTo)
  return {
    seed,
    version,
    text,
    matrix,
    qrModules: encoded.size,
    totalModules,
    codeSize,
    marginModules: QUIET_ZONE_MODULES,
    crop,
    refilledModules: countMarkerModules(encoded),
  }
}

/** Renders the poster pattern, or just its lattice, in one call. */
export async function renderPosterPattern(options: PosterPatternOptions): Promise<PosterPattern> {
  const lattice = await buildPosterPattern(options)
  const png = await renderRoundedPattern(lattice.matrix, options.modulePixels, {
    window: { ...lattice.crop, width: options.width, height: options.height },
  })
  return { ...lattice, png }
}

/** White cell rectangles of the modules the include mask accepts, as one path. */
function includedCells(
  include: (x: number, y: number) => boolean,
  totalModules: number,
  modulePixels: number,
): string {
  const parts: string[] = []
  for (let y = 0; y < totalModules; y++) {
    for (let x = 0; x < totalModules; x++) {
      if (!include(x, y))
        continue
      parts.push(`M${x * modulePixels},${y * modulePixels}h${modulePixels}v${modulePixels}h-${modulePixels}Z`)
    }
  }
  return parts.join('')
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

function centeredCrop(
  codeSize: number,
  width: number,
  height: number,
  modulePixels: number,
  alignTo?: { x: number, y: number },
): { left: number, top: number } {
  const offset = (extent: number, phase?: number): number => {
    const raw = (codeSize - extent) / 2
    let aligned = Math.round(raw / modulePixels) * modulePixels
    if (phase !== undefined) {
      // A module boundary sits at `k * modulePixels - offset`, so the window is phase-locked when
      // `offset + phase` is a whole number of modules: the boundaries then land on the lattice that
      // starts at `phase`. Prefer the nearest such offset to the centered one, under half a module
      // away, and fall back to the closest fitting one when that nudged window runs off the canvas.
      const target = ((-phase % modulePixels) + modulePixels) % modulePixels
      const current = ((aligned % modulePixels) + modulePixels) % modulePixels
      let delta = ((target - current) % modulePixels + modulePixels) % modulePixels
      if (delta > modulePixels / 2)
        delta -= modulePixels
      aligned += delta
      if (!fits(aligned, extent, codeSize))
        return fittingOffset(raw, extent, codeSize, modulePixels, target)
    }
    if (fits(aligned, extent, codeSize))
      return aligned
    return fittingOffset(raw, extent, codeSize, modulePixels)
  }
  return { left: offset(width, alignTo?.x), top: offset(height, alignTo?.y) }
}

function fits(offset: number, extent: number, codeSize: number): boolean {
  return offset >= 0 && offset + extent <= codeSize
}

/**
 * Closest offset to the centered position that fits the canvas. With a phase the search walks every
 * integer offset that puts a module boundary on the requested lattice — the crop itself does not
 * have to be a whole number of modules, only its phase does — and falls back to a whole-module
 * offset when the canvas is too tight for any of them.
 */
function fittingOffset(
  raw: number,
  extent: number,
  codeSize: number,
  modulePixels: number,
  phase?: number,
): number {
  const limit = codeSize - extent
  const base = Math.floor(raw / modulePixels) * modulePixels
  if (limit < 0)
    return base
  if (phase !== undefined) {
    let best = -1
    for (let candidate = phase; candidate <= limit; candidate += modulePixels) {
      if (best === -1 || Math.abs(candidate - raw) < Math.abs(best - raw))
        best = candidate
    }
    if (best !== -1)
      return best
  }
  let best = base
  for (const candidate of [base, base + modulePixels, base - modulePixels]) {
    if (!fits(candidate, extent, codeSize))
      continue
    if (Math.abs(candidate - raw) < Math.abs(best - raw))
      best = candidate
  }
  return best
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
