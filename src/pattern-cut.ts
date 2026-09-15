import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { QrPosterError } from './errors.js'
import { loadPng, luma, rgbaToPng } from './image.js'
import type { LoadedPng } from './image.js'
import type { BoundingBox, PatternCutOptions, PatternCutReport, PatternCutResult, Point } from './types.js'

/** Default corner fillet radius in poster pixels; matches the placed module pitch. */
export const CUT_RADIUS = 5
/** Default Douglas-Peucker tolerance in pixels for the traced outline. */
export const CUT_SMOOTH_TOLERANCE = 3
/** A mask pixel selects the cut shape when it is transparent or dark. */
export const CUT_KEEP_RULE = 'transparent-or-dark' as const

const ALPHA_THRESHOLD = 128
const DARK_THRESHOLD = 128
const ARTIFACT_NAMES = { svg: 'pattern-cut.svg', png: 'pattern-cut.png', report: 'report.json' } as const
const SVG_CLIP_ID = 'pattern-cut'
const STRAIGHT_ANGLE_EPSILON = 0.02
const MIN_LOOP_AREA = 4

export interface CutPathStats {
  loopsTraced: number
  loopsKept: number
  specksDropped: number
  verticesTraced: number
  verticesSimplified: number
  holes: number
  /** Area of the simplified cut polygon before corner rounding. */
  area: number
  /** True when the fillet had to shrink below the requested radius on a narrow feature. */
  radiusClamped: boolean
  bounds: BoundingBox
}

export interface CutPath {
  d: string
  stats: CutPathStats
}

export interface CutPathOptions {
  /** Corner fillet radius in pixels; defaults to {@link CUT_RADIUS}. */
  radius?: number
  /** Douglas-Peucker tolerance in pixels; defaults to {@link CUT_SMOOTH_TOLERANCE}. */
  smoothTolerance?: number
}

interface ContourEdge {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface FilletResult {
  commands: string[]
  clamped: boolean
}

/**
 * A mask pixel selects the cut shape when it is transparent or dark, which covers both artifact
 * conventions: `edit-mask.png` (opaque white outside, transparent inside) and `region-mask.png`
 * (white inside on black).
 */
export function buildShapeSelection(mask: LoadedPng): Uint8Array {
  const selected = new Uint8Array(mask.width * mask.height)
  for (let index = 0; index < selected.length; index++) {
    const offset = index * 4
    const alpha = mask.data[offset + 3]!
    const brightness = luma(mask.data[offset]!, mask.data[offset + 1]!, mask.data[offset + 2]!)
    selected[index] = alpha < ALPHA_THRESHOLD || brightness < DARK_THRESHOLD ? 1 : 0
  }
  return selected
}

/**
 * Traces the boundary of a binary selection as closed loops along pixel borders. The traversal keeps
 * the selected pixels on its right, so outer boundaries come out with negative shoelace area and
 * holes with positive area.
 */
export function traceMaskContours(selected: Uint8Array, width: number, height: number): Point[][] {
  if (selected.length !== width * height)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The cut selection does not match its dimensions.', 3)

  const isSelected = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && selected[y * width + x] === 1

  const outgoing = new Map<string, ContourEdge[]>()
  const addEdge = (startX: number, startY: number, endX: number, endY: number): void => {
    const key = `${startX},${startY}`
    const edges = outgoing.get(key)
    if (edges)
      edges.push({ startX, startY, endX, endY })
    else
      outgoing.set(key, [{ startX, startY, endX, endY }])
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isSelected(x, y))
        continue
      if (!isSelected(x - 1, y))
        addEdge(x, y, x, y + 1)
      if (!isSelected(x + 1, y))
        addEdge(x + 1, y + 1, x + 1, y)
      if (!isSelected(x, y - 1))
        addEdge(x + 1, y, x, y)
      if (!isSelected(x, y + 1))
        addEdge(x, y + 1, x + 1, y + 1)
    }
  }

  const edgeKey = (edge: ContourEdge): string => `${edge.startX},${edge.startY},${edge.endX},${edge.endY}`
  const visited = new Set<string>()
  const loops: Point[][] = []

  for (const edges of outgoing.values()) {
    for (const first of edges) {
      if (visited.has(edgeKey(first)))
        continue
      const loop: Point[] = []
      let current = first
      while (true) {
        visited.add(edgeKey(current))
        loop.push({ x: current.startX, y: current.startY })
        const candidates = outgoing.get(`${current.endX},${current.endY}`)
        if (!candidates)
          break
        const inX = current.endX - current.startX
        const inY = current.endY - current.startY
        let next: ContourEdge | undefined
        let bestTurn = Number.POSITIVE_INFINITY
        for (const candidate of candidates) {
          if (visited.has(edgeKey(candidate)))
            continue
          // Hug the selection: prefer the sharpest turn in the traversal sense. At a diagonal
          // pinch this keeps the two touching regions as separate loops instead of merging them.
          const turn = inX * (candidate.endY - candidate.startY) - inY * (candidate.endX - candidate.startX)
          if (next === undefined || turn < bestTurn) {
            next = candidate
            bestTurn = turn
          }
        }
        if (!next)
          break
        current = next
        if (current.startX === first.startX && current.startY === first.startY)
          break
      }
      if (loop.length >= 4)
        loops.push(loop)
    }
  }

  return loops
}

/** Drops the intermediate points of straight runs, leaving only genuine corners. */
export function collapseCollinearPoints(loop: Point[]): Point[] {
  const collapsed: Point[] = []
  for (let index = 0; index < loop.length; index++) {
    const previous = loop[(index - 1 + loop.length) % loop.length]!
    const current = loop[index]!
    const next = loop[(index + 1) % loop.length]!
    const inX = current.x - previous.x
    const inY = current.y - previous.y
    const outX = next.x - current.x
    const outY = next.y - current.y
    if (inX * outY - inY * outX === 0 && inX * outX + inY * outY > 0)
      continue
    collapsed.push(current)
  }
  return collapsed
}

/** Douglas-Peucker on an open polyline. */
function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length < 3)
    return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const pending: Array<[number, number]> = [[0, points.length - 1]]
  while (pending.length > 0) {
    const [start, end] = pending.pop()!
    const first = points[start]!
    const last = points[end]!
    const deltaX = last.x - first.x
    const deltaY = last.y - first.y
    const length = Math.hypot(deltaX, deltaY) || 1
    let farthest = -1
    let distance = 0
    for (let index = start + 1; index < end; index++) {
      const point = points[index]!
      const deviation = Math.abs(deltaY * point.x - deltaX * point.y + last.x * first.y - last.y * first.x) / length
      if (deviation > distance) {
        distance = deviation
        farthest = index
      }
    }
    if (farthest > 0 && distance > tolerance) {
      keep[farthest] = 1
      pending.push([start, farthest], [farthest, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

/**
 * Splits a closed loop at its farthest vertex before simplifying, so an open-run simplifier cannot
 * collapse the whole ring onto its duplicated start and end point.
 */
export function simplifyClosedLoop(loop: Point[], tolerance: number): Point[] {
  if (loop.length < 4)
    return loop.slice()
  if (tolerance <= 0)
    return loop.slice()
  const origin = loop[0]!
  let farthest = 1
  let distance = -1
  for (let index = 1; index < loop.length; index++) {
    const point = loop[index]!
    const span = Math.hypot(point.x - origin.x, point.y - origin.y)
    if (span > distance) {
      distance = span
      farthest = index
    }
  }
  const head = simplifyOpen(loop.slice(0, farthest + 1), tolerance)
  const tail = simplifyOpen([...loop.slice(farthest), origin], tolerance)
  return [...head.slice(0, -1), ...tail.slice(0, -1)]
}

export function polygonArea(loop: Point[]): number {
  let total = 0
  for (let index = 0; index < loop.length; index++) {
    const current = loop[index]!
    const next = loop[(index + 1) % loop.length]!
    total += current.x * next.y - next.x * current.y
  }
  return total / 2
}

function format(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded === 0 ? 0 : rounded)
}

/**
 * Rounds every corner with a fillet. The tangent distance is capped at half of each neighbouring
 * edge and the arc radius is recomputed from the capped tangent, so arcs on small features stay
 * inside the polygon instead of overlapping each other.
 */
export function filletLoop(loop: Point[], radius: number): FilletResult {
  const commands: string[] = []
  let clamped = false
  let started = false
  const count = loop.length
  for (let index = 0; index < count; index++) {
    const previous = loop[(index - 1 + count) % count]!
    const current = loop[index]!
    const next = loop[(index + 1) % count]!
    const inX = previous.x - current.x
    const inY = previous.y - current.y
    const outX = next.x - current.x
    const outY = next.y - current.y
    const inLength = Math.hypot(inX, inY)
    const outLength = Math.hypot(outX, outY)
    if (inLength < 1e-9 || outLength < 1e-9)
      continue
    const unitInX = inX / inLength
    const unitInY = inY / inLength
    const unitOutX = outX / outLength
    const unitOutY = outY / outLength
    const dot = Math.max(-1, Math.min(1, unitInX * unitOutX + unitInY * unitOutY))
    const angle = Math.acos(dot)
    const halfAngle = angle / 2
    const straight = angle > Math.PI - STRAIGHT_ANGLE_EPSILON || angle < STRAIGHT_ANGLE_EPSILON

    let tangent = straight || radius <= 0 ? 0 : radius / Math.tan(halfAngle)
    if (tangent > inLength / 2 || tangent > outLength / 2) {
      tangent = Math.min(tangent, inLength / 2, outLength / 2)
      clamped = true
    }
    const arcRadius = tangent * Math.tan(halfAngle)
    const startX = current.x + unitInX * tangent
    const startY = current.y + unitInY * tangent
    if (!started) {
      commands.push(`M${format(startX)},${format(startY)}`)
      started = true
    }
    else {
      commands.push(`L${format(startX)},${format(startY)}`)
    }
    // A straight corner keeps the vertex itself, so the line above already reached it.
    if (straight)
      continue
    const endX = current.x + unitOutX * tangent
    const endY = current.y + unitOutY * tangent
    const sweep = unitInX * unitOutY - unitInY * unitOutX < 0 ? 1 : 0
    commands.push(`A${format(arcRadius)},${format(arcRadius)} 0 0 ${sweep} ${format(endX)},${format(endY)}`)
  }
  return { commands, clamped }
}

/** Turns a binary selection into a rounded SVG path plus the statistics the report records. */
export function buildCutPath(
  selected: Uint8Array,
  width: number,
  height: number,
  options: CutPathOptions = {},
): CutPath {
  const radius = options.radius ?? CUT_RADIUS
  const smoothTolerance = options.smoothTolerance ?? CUT_SMOOTH_TOLERANCE
  const minLoopArea = Math.max(radius * radius, MIN_LOOP_AREA)

  const traced = traceMaskContours(selected, width, height)
  const verticesTraced = traced.reduce((total, loop) => total + loop.length, 0)
  const candidates = traced
    .map(loop => simplifyClosedLoop(collapseCollinearPoints(loop), smoothTolerance))
    .filter(loop => loop.length >= 3)
    .map(loop => ({ loop, area: polygonArea(loop) }))
    .sort((left, right) => Math.abs(right.area) - Math.abs(left.area))

  const kept = candidates.filter(candidate => Math.abs(candidate.area) >= minLoopArea)
  if (kept.length === 0) {
    throw new QrPosterError(
      'MASK_INVALID',
      `The supplied mask does not select any cut shape that survives a ${smoothTolerance}px smoothing tolerance`
      + ` and a speck threshold of ${minLoopArea}px². Lower --cut-smooth, lower --cut-radius, or check the mask.`,
    )
  }

  const subpaths: string[] = []
  let clampedAny = false
  for (const { loop } of kept) {
    const filled = filletLoop(loop, radius)
    clampedAny = clampedAny || filled.clamped
    subpaths.push(`${filled.commands.join('')}Z`)
  }

  const minX = Math.floor(Math.min(...kept.flatMap(({ loop }) => loop.map(point => point.x))))
  const minY = Math.floor(Math.min(...kept.flatMap(({ loop }) => loop.map(point => point.y))))
  const maxX = Math.ceil(Math.max(...kept.flatMap(({ loop }) => loop.map(point => point.x))))
  const maxY = Math.ceil(Math.max(...kept.flatMap(({ loop }) => loop.map(point => point.y))))
  const signedArea = kept.reduce((total, candidate) => total + candidate.area, 0)

  return {
    d: subpaths.join(''),
    stats: {
      loopsTraced: traced.length,
      loopsKept: kept.length,
      specksDropped: traced.length - kept.length,
      verticesTraced,
      verticesSimplified: kept.reduce((total, { loop }) => total + loop.length, 0),
      holes: kept.filter(({ area }) => area > 0).length,
      area: Math.round(Math.abs(signedArea) * 100) / 100,
      radiusClamped: clampedAny,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    },
  }
}

/** Self-contained SVG: the pattern rides along as a data URI and the cut edge stays vector. */
export function buildCutSvg(pathData: string, width: number, height: number, pattern: Buffer): string {
  const encoded = pattern.toString('base64')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
    + `  <defs><clipPath id="${SVG_CLIP_ID}"><path fill-rule="evenodd" clip-rule="evenodd" d="${pathData}"/></clipPath></defs>\n`
    + `  <image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" clip-path="url(#${SVG_CLIP_ID})" href="data:image/png;base64,${encoded}"/>\n`
    + '</svg>\n'
}

/**
 * Rasterizes only the path to an alpha mask and applies it to the untouched source pixels, so the
 * pattern is never resampled: everything inside the cut stays bit-exact and everything outside is
 * fully transparent.
 */
export async function renderCutPng(pattern: LoadedPng, pathData: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pattern.width}" height="${pattern.height}"`
    + ` viewBox="0 0 ${pattern.width} ${pattern.height}">`
    + `<path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="${pathData}"/></svg>`
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== pattern.width || info.height !== pattern.height) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `Cut rasterization produced ${info.width}x${info.height} instead of ${pattern.width}x${pattern.height}.`,
      3,
    )
  }

  const output = new Uint8Array(pattern.width * pattern.height * 4)
  for (let index = 0; index < pattern.width * pattern.height; index++) {
    const offset = index * 4
    const coverage = data[offset + 3]!
    output[offset] = pattern.data[offset]!
    output[offset + 1] = pattern.data[offset + 1]!
    output[offset + 2] = pattern.data[offset + 2]!
    output[offset + 3] = Math.round(pattern.data[offset + 3]! * coverage / 255)
  }
  return rgbaToPng(output, pattern.width, pattern.height)
}

export async function generatePatternCut(options: PatternCutOptions): Promise<PatternCutResult> {
  const startedAt = Date.now()
  const radius = options.radius ?? CUT_RADIUS
  const smoothTolerance = options.smoothTolerance ?? CUT_SMOOTH_TOLERANCE
  if (!Number.isFinite(radius) || radius < 0)
    throw new QrPosterError('INVALID_INPUT', '--cut-radius must be zero or a positive number.')
  if (!Number.isFinite(smoothTolerance) || smoothTolerance < 0)
    throw new QrPosterError('INVALID_INPUT', '--cut-smooth must be zero or a positive number.')

  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const pattern = await loadPng(options.inputPath, 'pattern input')
  const mask = await loadPng(options.maskPath, 'cut mask')
  if (mask.width !== pattern.width || mask.height !== pattern.height) {
    throw new QrPosterError(
      'MASK_INVALID',
      `Cut mask dimensions ${mask.width}x${mask.height} do not match the pattern dimensions ${pattern.width}x${pattern.height}.`,
    )
  }

  const selected = buildShapeSelection(mask)
  const cut = buildCutPath(selected, pattern.width, pattern.height, { radius, smoothTolerance })
  const svg = buildCutSvg(cut.d, pattern.width, pattern.height, pattern.file)
  const png = await renderCutPng(pattern, cut.d)

  await writeFile(join(outputDir, ARTIFACT_NAMES.svg), svg, 'utf8')
  await writeFile(join(outputDir, ARTIFACT_NAMES.png), png)

  const minLoopArea = Math.max(radius * radius, MIN_LOOP_AREA)
  const warnings: string[] = []
  if (cut.stats.specksDropped > 0) {
    warnings.push(`${cut.stats.specksDropped} mask loop(s) smaller than ${minLoopArea}px² were dropped as specks.`)
  }
  if (cut.stats.radiusClamped)
    warnings.push(`The ${radius}px fillet was clamped on features narrower than twice the radius.`)
  if (radius < 1)
    warnings.push(`The cut radius is ${radius}px; corners are not rounded below 1px.`)

  const report: PatternCutReport = {
    schemaVersion: 4,
    mode: 'pattern-cut',
    status: 'generated',
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      pattern: {
        path: normalizedPath(options.inputPath),
        sha256: pattern.sha256,
        width: pattern.width,
        height: pattern.height,
      },
      mask: {
        path: normalizedPath(options.maskPath),
        sha256: mask.sha256,
        width: mask.width,
        height: mask.height,
      },
    },
    cut: {
      radius,
      smoothTolerance,
      keep: CUT_KEEP_RULE,
      minLoopArea,
    },
    shape: cut.stats,
    artifacts: {
      svg: ARTIFACT_NAMES.svg,
      svgSha256: sha256(svg),
      png: ARTIFACT_NAMES.png,
      pngSha256: sha256(png),
    },
    warnings,
  }
  await writeFile(join(outputDir, ARTIFACT_NAMES.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, outputDir }
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
