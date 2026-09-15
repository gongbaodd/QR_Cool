import sharp from 'sharp'
import { QrPosterError } from './errors.js'
import type { BoundingBox } from './types.js'

/**
 * The poster-space module lattice the assembled cut is built on. Cell (column, row) covers one
 * `modulePixels`-sized pixel block, and the origin is the placed QR's own lattice, so every drawn
 * module is a whole QR cell of the texture rather than a slice of one.
 */
export interface ModuleLattice {
  /** Poster-space x of the lattice origin; `0 <= x < modulePixels`. */
  x: number
  /** Poster-space y of the lattice origin; `0 <= y < modulePixels`. */
  y: number
  modulePixels: number
  columns: number
  rows: number
  width: number
  height: number
}

/** Plate window in poster pixels; its box must sit on the lattice or the hole would slice a module. */
export interface ModuleWindow {
  x: number
  y: number
  size: number
}

export interface SafeArea {
  /** Row-major grid: 1 when the module's whole pixel block is inside the painted region. */
  safe: Uint8Array
  safeModules: number
  /** Modules the region covers only in part; they keep the original artwork. */
  partialModules: number
  /** Region pixels inside those partial modules, which the cut therefore never paints. */
  droppedPartialPixels: number
  /** Canvas-pixel bounds of the safe modules. */
  bounds: BoundingBox
}

export interface PlateModules {
  /** Row-major grid: 1 for every module the cut drops for the QR plate, corners already handed back. */
  cells: Uint8Array
  /** Row-major grid: 1 for the corner modules handed back to the texture. */
  corners: Uint8Array
  /** Modules the hole covers after the corners are handed back. */
  holeModules: number
  /** Corner modules the texture keeps, 0 or up to 4. */
  cornerModules: number
  box: BoundingBox
}

/**
 * Builds the module lattice covering the canvas. The origin is reduced to a phase inside one
 * module, so a caller can pass the placement box directly and get the same lattice the QR uses.
 */
export function buildModuleLattice(
  width: number,
  height: number,
  modulePixels: number,
  origin: { x: number, y: number },
): ModuleLattice {
  if (!Number.isInteger(modulePixels) || modulePixels < 1)
    throw new QrPosterError('INVALID_INPUT', 'The module pitch must be a positive integer.')
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new QrPosterError('INVALID_INPUT', 'The canvas must have positive integer dimensions.')
  const phase = (value: number): number => ((Math.trunc(value) % modulePixels) + modulePixels) % modulePixels
  const x = phase(origin.x)
  const y = phase(origin.y)
  return {
    x,
    y,
    modulePixels,
    columns: Math.ceil((width - x) / modulePixels),
    rows: Math.ceil((height - y) / modulePixels),
    width,
    height,
  }
}

/** Poster-space block of one lattice cell. */
export function moduleBlock(lattice: ModuleLattice, column: number, row: number): ModuleWindow {
  return {
    x: lattice.x + column * lattice.modulePixels,
    y: lattice.y + row * lattice.modulePixels,
    size: lattice.modulePixels,
  }
}

/** Index of the cell containing a poster pixel, or -1 when the pixel is off the lattice. */
export function moduleCellIndex(lattice: ModuleLattice, x: number, y: number): number {
  const column = Math.floor((x - lattice.x) / lattice.modulePixels)
  const row = Math.floor((y - lattice.y) / lattice.modulePixels)
  if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows)
    return -1
  return row * lattice.columns + column
}

/**
 * Marks the modules the cut may draw: a module is safe only when its whole pixel block is on the
 * canvas and every one of those pixels is inside the painted region. A module the region covers
 * only in part is dropped, so the drawn area stays a union of whole modules and the original
 * artwork survives along the silhouette.
 */
export function computeSafeArea(
  selection: Uint8Array,
  width: number,
  height: number,
  lattice: ModuleLattice,
): SafeArea {
  if (selection.length !== width * height)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The cut selection does not match its dimensions.', 3)

  const pitch = lattice.modulePixels
  const safe = new Uint8Array(lattice.columns * lattice.rows)
  let safeModules = 0
  let partialModules = 0
  let droppedPartialPixels = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      const originX = lattice.x + column * pitch
      const originY = lattice.y + row * pitch
      let inside = 0
      let block = 0
      for (let offsetY = 0; offsetY < pitch; offsetY++) {
        const y = originY + offsetY
        if (y < 0 || y >= height)
          continue
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const x = originX + offsetX
          if (x < 0 || x >= width)
            continue
          block++
          if (selection[y * width + x])
            inside++
        }
      }
      if (block === pitch * pitch && inside === block) {
        safe[row * lattice.columns + column] = 1
        safeModules++
        minX = Math.min(minX, originX)
        minY = Math.min(minY, originY)
        maxX = Math.max(maxX, originX + pitch)
        maxY = Math.max(maxY, originY + pitch)
        continue
      }
      if (inside > 0) {
        partialModules++
        droppedPartialPixels += inside
      }
    }
  }

  return {
    safe,
    safeModules,
    partialModules,
    droppedPartialPixels,
    bounds: safeModules === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}

/**
 * Marks the plate window on the module lattice. The hole is every module whose whole block sits
 * inside the window, so the cut never relies on artwork showing through the plate; the window
 * itself is painted at pixel precision, which is what lets the light margin be a fraction of a
 * module. When the corner treatment is on, the four modules holding the window's corner pixels are
 * handed back to the texture and left unpainted, so the plate's corners stay texture the way the
 * module window's corners used to.
 */
export function computePlateModules(
  lattice: ModuleLattice,
  window: ModuleWindow,
  cornerModules: number,
): PlateModules {
  const pitch = lattice.modulePixels
  if (![window.x, window.y, window.size].every(Number.isFinite))
    throw new QrPosterError('INVALID_INPUT', 'The QR plate window must use finite numbers.')
  if (window.size <= 0)
    throw new QrPosterError('INVALID_INPUT', 'The QR plate window must have a positive size.')

  const cells = new Uint8Array(lattice.columns * lattice.rows)
  const corners = new Uint8Array(lattice.columns * lattice.rows)
  const firstColumn = Math.ceil((window.x - lattice.x) / pitch)
  const firstRow = Math.ceil((window.y - lattice.y) / pitch)
  const lastColumn = Math.floor((window.x + window.size - lattice.x) / pitch) - 1
  const lastRow = Math.floor((window.y + window.size - lattice.y) / pitch) - 1
  const cornerColumns = cornerModules > 0
    ? [window.x, window.x + window.size - 1].map(x => Math.floor((x - lattice.x) / pitch))
    : []
  const cornerRows = cornerModules > 0
    ? [window.y, window.y + window.size - 1].map(y => Math.floor((y - lattice.y) / pitch))
    : []

  let holeModules = 0
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows)
        continue
      cells[row * lattice.columns + column] = 1
      holeModules++
    }
  }

  // The corner modules stay texture even when the window is not lattice-aligned, so their pixels
  // inside the plate are handed back rather than painted over.
  let cornerCount = 0
  for (const row of cornerRows) {
    for (const column of cornerColumns) {
      if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows)
        continue
      const index = row * lattice.columns + column
      if (cells[index]) {
        cells[index] = 0
        holeModules--
      }
      corners[index] = 1
      cornerCount++
    }
  }
  return {
    cells,
    corners,
    holeModules,
    cornerModules: cornerCount,
    box: { x: window.x, y: window.y, width: window.size, height: window.size },
  }
}

/**
 * Marks the outer rings of drawn modules with a Chebyshev distance of at most `rimModules` from the
 * nearest module the region does not fully cover. Those modules are forced dark, so the rim is a
 * band of whole modules that closes on the silhouette. The plate is never a seed: the rim follows
 * the painted region, not the QR window.
 */
export function computeRimModules(
  safe: Uint8Array,
  lattice: ModuleLattice,
  rimModules: number,
): Uint8Array {
  const { columns, rows } = lattice
  const rim = new Uint8Array(columns * rows)
  if (!Number.isInteger(rimModules) || rimModules < 1)
    return rim

  const distance = new Int32Array(columns * rows).fill(-1)
  const queue: number[] = []
  for (let index = 0; index < safe.length; index++) {
    if (safe[index])
      continue
    distance[index] = 0
    queue.push(index)
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!
    const distance_ = distance[index]!
    const next = distance_ + 1
    if (next > rimModules)
      continue
    const row = Math.floor(index / columns)
    const column = index - row * columns
    for (let deltaY = -1; deltaY <= 1; deltaY++) {
      const neighbourRow = row + deltaY
      if (neighbourRow < 0 || neighbourRow >= rows)
        continue
      for (let deltaX = -1; deltaX <= 1; deltaX++) {
        const neighbourColumn = column + deltaX
        if (neighbourColumn < 0 || neighbourColumn >= columns)
          continue
        const neighbour = neighbourRow * columns + neighbourColumn
        if (distance[neighbour] !== -1)
          continue
        distance[neighbour] = next
        queue.push(neighbour)
      }
    }
  }
  for (let index = 0; index < rim.length; index++) {
    if (safe[index] && distance[index]! >= 0)
      rim[index] = 1
  }
  return rim
}

/** Union of whole module rectangles as an SVG path; every edge lands on an integer pixel. */
export function buildModulePath(cells: Uint8Array, lattice: ModuleLattice): string {
  if (cells.length !== lattice.columns * lattice.rows)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module grid does not match the lattice.', 3)
  const pitch = lattice.modulePixels
  const parts: string[] = []
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      if (!cells[row * lattice.columns + column])
        continue
      const x = lattice.x + column * pitch
      const y = lattice.y + row * pitch
      parts.push(`M${x},${y}h${pitch}v${pitch}h-${pitch}Z`)
    }
  }
  if (parts.length === 0)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module cut path selects no modules.', 3)
  return parts.join('')
}

/**
 * Rasterizes the module path and returns its coverage. Module edges land on integer pixel
 * boundaries, so the raster is binary: a partial pixel would mean the cut stopped landing on the
 * lattice, which is an error rather than something to blend away.
 */
export async function renderModuleCoverage(
  pathData: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
    + ` viewBox="0 0 ${width} ${height}"><path fill="#ffffff" d="${pathData}"/></svg>`
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== width || info.height !== height) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `Module rasterization produced ${info.width}x${info.height} instead of ${width}x${height}.`,
      3,
    )
  }
  const coverage = new Uint8Array(width * height)
  for (let index = 0; index < coverage.length; index++) {
    const alpha = data[index * 4 + 3]!
    if (alpha !== 0 && alpha !== 255) {
      throw new QrPosterError(
        'IMAGE_PROCESSING_FAILED',
        `The module cut rasterized a partial pixel (alpha ${alpha}); module edges must land on integer pixels.`,
        3,
      )
    }
    coverage[index] = alpha
  }
  return coverage
}
