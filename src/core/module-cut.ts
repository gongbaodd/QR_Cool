import { imaging } from './imaging'
import { QrPosterError } from './errors'
import type { BoundingBox } from './types'

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
  /** Row-major grid: 1 for the modules handed back to the texture. */
  corners: Uint8Array
  /** Modules the hole covers after the corners are handed back. */
  holeModules: number
  /** Modules the texture keeps, 0 when the hand-back rectangles are empty. */
  cornerModules: number
  /** Canvas-pixel bounds of the plate cells, the hand-backs already removed. */
  bounds: BoundingBox
}

/**
 * Builds the module lattice covering the canvas. The origin is reduced to a phase inside one
 * module, so a caller can pass the placement box directly and get the same lattice the QR uses.
 */
export function buildModuleLattice(
  width: number,
  height: number,
  modulePixels: number,
  origin: { x: number; y: number },
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
  if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows) return -1
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
        if (y < 0 || y >= height) continue
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const x = originX + offsetX
          if (x < 0 || x >= width) continue
          block++
          if (selection[y * width + x]) inside++
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
    bounds:
      safeModules === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}

/**
 * Marks the plate on the module lattice. The hole is every module whose whole block sits inside one
 * of the plate rectangles — the code grid plus the light arms beside the finder markers — so the cut
 * never relies on artwork showing through the plate and no drawn edge crosses a module. The
 * hand-back rectangles (the corner blocks `--cut-radius` carves out of the arms) leave the hole
 * again and keep the texture, so the plate's corners stay texture instead of the QR's own light
 * band. Rectangles may share edges and may reach past the canvas; only lattice cells are marked.
 */
export function computePlateModules(
  lattice: ModuleLattice,
  plateRects: BoundingBox[],
  handbackRects: BoundingBox[] = [],
): PlateModules {
  const pitch = lattice.modulePixels
  if (plateRects.length === 0) throw new QrPosterError('INVALID_INPUT', 'The QR plate needs at least one rectangle.')
  for (const rect of [...plateRects, ...handbackRects]) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
      throw new QrPosterError('INVALID_INPUT', 'The QR plate rectangles must use finite numbers.')
    if (rect.width <= 0 || rect.height <= 0)
      throw new QrPosterError('INVALID_INPUT', 'The QR plate rectangles must have a positive size.')
  }

  const cells = new Uint8Array(lattice.columns * lattice.rows)
  const corners = new Uint8Array(lattice.columns * lattice.rows)
  let holeModules = 0
  for (const rect of plateRects) {
    // A rectangle marks only the modules it covers in full: a partly covered module would slice.
    const firstColumn = Math.ceil((rect.x - lattice.x) / pitch)
    const firstRow = Math.ceil((rect.y - lattice.y) / pitch)
    const lastColumn = Math.floor((rect.x + rect.width - lattice.x) / pitch) - 1
    const lastRow = Math.floor((rect.y + rect.height - lattice.y) / pitch) - 1
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows) continue
        const index = row * lattice.columns + column
        if (cells[index]) continue
        cells[index] = 1
        holeModules++
      }
    }
  }

  // Hand-back modules leave the hole and stay texture, so the plate never paints over them.
  let cornerCount = 0
  for (const rect of handbackRects) {
    const firstColumn = Math.ceil((rect.x - lattice.x) / pitch)
    const firstRow = Math.ceil((rect.y - lattice.y) / pitch)
    const lastColumn = Math.floor((rect.x + rect.width - lattice.x) / pitch) - 1
    const lastRow = Math.floor((rect.y + rect.height - lattice.y) / pitch) - 1
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows) continue
        const index = row * lattice.columns + column
        if (cells[index]) {
          cells[index] = 0
          holeModules--
        }
        if (corners[index]) {
          continue
        }
        corners[index] = 1
        cornerCount++
      }
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      if (!cells[row * lattice.columns + column]) continue
      const x = lattice.x + column * pitch
      const y = lattice.y + row * pitch
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + pitch)
      maxY = Math.max(maxY, y + pitch)
    }
  }
  return {
    cells,
    corners,
    holeModules,
    cornerModules: cornerCount,
    bounds:
      holeModules === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}

/**
 * Marks the outer rings of drawn modules with a Chebyshev distance of at most `rimModules` from the
 * nearest module the region does not fully cover. Those modules are forced dark, so the rim is a
 * band of whole modules that closes on the silhouette. The plate is never a seed: the rim follows
 * the painted region, not the QR window.
 */
export function computeRimModules(safe: Uint8Array, lattice: ModuleLattice, rimModules: number): Uint8Array {
  const { columns, rows } = lattice
  const rim = new Uint8Array(columns * rows)
  if (!Number.isInteger(rimModules) || rimModules < 1) return rim

  const distance = new Int32Array(columns * rows).fill(-1)
  const queue: number[] = []
  for (let index = 0; index < safe.length; index++) {
    if (safe[index]) continue
    distance[index] = 0
    queue.push(index)
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!
    const distance_ = distance[index]!
    const next = distance_ + 1
    if (next > rimModules) continue
    const row = Math.floor(index / columns)
    const column = index - row * columns
    for (let deltaY = -1; deltaY <= 1; deltaY++) {
      const neighbourRow = row + deltaY
      if (neighbourRow < 0 || neighbourRow >= rows) continue
      for (let deltaX = -1; deltaX <= 1; deltaX++) {
        const neighbourColumn = column + deltaX
        if (neighbourColumn < 0 || neighbourColumn >= columns) continue
        const neighbour = neighbourRow * columns + neighbourColumn
        if (distance[neighbour] !== -1) continue
        distance[neighbour] = next
        queue.push(neighbour)
      }
    }
  }
  for (let index = 0; index < rim.length; index++) {
    if (safe[index] && distance[index]! >= 0) rim[index] = 1
  }
  return rim
}

/** Outer light margin, followed by the optional dark rim, both restricted to safe whole modules. */
export function computeRegionBands(
  safe: Uint8Array,
  lattice: ModuleLattice,
  rimModules: number,
  regionMargin: boolean,
): { margin: Uint8Array; rim: Uint8Array } {
  const margin = new Uint8Array(safe.length)
  if (!regionMargin) return { margin, rim: computeRimModules(safe, lattice, rimModules) }

  const firstRing = computeRimModules(safe, lattice, 1)
  const outerRings = rimModules > 0 ? computeRimModules(safe, lattice, rimModules + 1) : firstRing
  const rim = new Uint8Array(safe.length)
  for (let index = 0; index < safe.length; index++) {
    if (!safe[index]) continue
    const row = Math.floor(index / lattice.columns)
    const column = index - row * lattice.columns
    // A region may reach the canvas edge; the nearest off-canvas module still bounds its margin.
    const edgeDistance = Math.min(column + 1, row + 1, lattice.columns - column, lattice.rows - row)
    if (firstRing[index] || edgeDistance === 1) margin[index] = 1
    else if (rimModules > 0 && (outerRings[index] || edgeDistance <= rimModules + 1)) rim[index] = 1
  }
  return { margin, rim }
}

/** Union of whole module rectangles as an SVG path; every edge lands on an integer pixel. */
export function buildModulePath(cells: Uint8Array, lattice: ModuleLattice): string {
  if (cells.length !== lattice.columns * lattice.rows)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module grid does not match the lattice.', 3)
  const pitch = lattice.modulePixels
  const parts: string[] = []
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      if (!cells[row * lattice.columns + column]) continue
      const x = lattice.x + column * pitch
      const y = lattice.y + row * pitch
      parts.push(`M${x},${y}h${pitch}v${pitch}h-${pitch}Z`)
    }
  }
  if (parts.length === 0)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module cut path selects no modules.', 3)
  return parts.join('')
}

/** Rounded outer silhouette of whole-module union: outer corners filleted to `radius` with antialiasing. */
export function buildRoundedModulePath(cells: Uint8Array, lattice: ModuleLattice, radius: number): string {
  if (cells.length !== lattice.columns * lattice.rows)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module grid does not match the lattice.', 3)
  const pitch = lattice.modulePixels
  if (!Number.isFinite(radius) || radius <= 0) return buildModulePath(cells, lattice)
  // Build a pixel mask of drawn modules, then trace its outer boundary as a rounded rect union.
  // For a module-aligned lattice, rounding only the outer convex corners is sufficient; inner
  // notches stay square and the SVG arc join produces antialiased edges when rasterized.
  const width = lattice.columns
  const height = lattice.rows
  const isInside = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < width && r < height && !!cells[r * width + c]
  const parts: string[] = []
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (!cells[row * width + column]) continue
      const x = lattice.x + column * pitch
      const y = lattice.y + row * pitch
      const left = !isInside(column - 1, row)
      const right = !isInside(column + 1, row)
      const top = !isInside(column, row - 1)
      const bottom = !isInside(column, row + 1)
      const topLeft = !isInside(column - 1, row - 1) && !left && !top
      const topRight = !isInside(column + 1, row - 1) && !right && !top
      const bottomLeft = !isInside(column - 1, row + 1) && !left && !bottom
      const bottomRight = !isInside(column + 1, row + 1) && !right && !bottom
      const tl = top && left ? radius : 0
      const tr = top && right ? radius : 0
      const br = bottom && right ? radius : 0
      const bl = bottom && left ? radius : 0
      // For fully interior modules keep square; for edge modules emit rounded outer corners.
      if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
        parts.push(`M${x},${y}h${pitch}v${pitch}h-${pitch}Z`)
        continue
      }
      const r = Math.min(radius, pitch / 2)
      // Build per-module rounded rect: only outer corners are rounded, inner edges remain square.
      let d = `M${x + tl},${y}`
      d += `H${x + pitch - tr}`
      if (tr) d += `A${r},${r} 0 0 1 ${x + pitch},${y + tr}`
      else d += `V${y}`
      d += `V${y + pitch - br}`
      if (br) d += `A${r},${r} 0 0 1 ${x + pitch - br},${y + pitch}`
      else d += `H${x + pitch}`
      d += `H${x + bl}`
      if (bl) d += `A${r},${r} 0 0 1 ${x},${y + pitch - bl}`
      else d += `V${y + pitch}`
      d += `V${y + tl}`
      if (tl) d += `A${r},${r} 0 0 1 ${x + tl},${y}`
      else d += `H${x}`
      d += 'Z'
      // When neighboring modules fill the corner gap, the arc would create a notch; clip it by
      // falling back to square for those corners.
      if ((tl && topLeft) || (tr && topRight) || (br && bottomRight) || (bl && bottomLeft)) {
        parts.push(`M${x},${y}h${pitch}v${pitch}h-${pitch}Z`)
      } else {
        parts.push(d)
      }
    }
  }
  if (parts.length === 0)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The module cut path selects no modules.', 3)
  return parts.join('')
}

/**
 * Rasterizes the module path and returns its coverage. By default module edges land on integer
 * pixel boundaries, so the raster is binary; when `allowAntialias` is true partial alpha is kept
 * for rounded, antialiased edges.
 */
export async function renderModuleCoverage(
  pathData: string,
  width: number,
  height: number,
  allowAntialias = false,
): Promise<Uint8Array> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}"><path fill="#ffffff" d="${pathData}"/></svg>`
  const raster = await imaging().rasterizeSvg(svg, width, height)
  const coverage = new Uint8Array(width * height)
  for (let index = 0; index < coverage.length; index++) {
    const alpha = raster.data[index * 4 + 3]!
    if (!allowAntialias && alpha !== 0 && alpha !== 255) {
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
