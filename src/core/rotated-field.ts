/**
 * The rotated assembly's upright field: plate-local coordinates (origin = the unrotated
 * placement square's top-left) extended to cover the whole canvas' pre-image, so the
 * decorative texture that fills the painted region rotates with the QR.
 *
 * Everything the cut paints — texture cells, plate, rim — lives on one extended
 * plate-local module grid. A poster pixel is painted through the shared inverse
 * transform: its plate-local sample point picks both the module it belongs to and the
 * texture pixel it reads, so module membership and texel sampling can never disagree.
 * The composition into the poster happens once, through {@link inverseMap}; safe-area
 * validation then runs against the *rotated* cell footprints, which has one consequence:
 * a cell is safe only when every poster pixel whose sample lands in it lies inside the
 * painted region and on the canvas. Pixels the region covers only in part keep the
 * original artwork, exactly as on the upright path.
 */

import { QrPosterError } from './errors'
import { forwardMap, inverseMap, placementInverse } from './rotate'
import type { PlacementInverse } from './rotate'
import type { ModuleLattice } from './module-cut'
import type { BoundingBox, QrPlacement } from './types'

/**
 * Plate-local module grid, extended past the canvas where the rotation's pre-image
 * reaches. Cell `(column, row)` covers plate-local pixels
 * `[column*pitch, (column+1)*pitch) × [row*pitch, (row+1)*pitch)`; the indices may be
 * negative or beyond the canvas extent. The grid also owns the safe mask: a cell is
 * safe only when every poster pixel that samples into it is inside the painted region
 * and on the canvas.
 */
export interface RotatedField {
  modulePixels: number
  /** First column/row module index of the grid; can be negative. */
  colMin: number
  rowMin: number
  cols: number
  rows: number
  /** Plate-local window extent in pixels: the grid's own bounding box, whole modules. */
  width: number
  height: number
  /** Row-major masks; `index = (row - rowMin) * cols + (column - colMin)`. */
  safe: Uint8Array
  plate: Uint8Array
  safeModules: number
  holeModules: number
  /** Modules the rotated region coverage touches but never covers fully: left as artwork. */
  partialModules: number
  /** Region pixels inside those partial modules. */
  droppedPartialPixels: number
  /** Poster-space pixel bounds of the safe modules' rotated footprints. */
  bounds: BoundingBox
}

/**
 * Marks the candidate plate-main modules the rotated fill needs. Returns a field with
 * `safe` filled per rotated cell and `plate` marked on the whole normalized square —
 * QR generation stays upright, so the rotation carries the entire upright composite
 * (texture field plus plate) in one transform.
 */
export function buildRotatedField(input: {
  /** Row-major painted-region mask; nonzero means the region selects the pixel. */
  selection: Uint8Array
  width: number
  height: number
  placement: QrPlacement & { rotation: number }
}): RotatedField {
  const { selection, width, height, placement } = input
  const pitch = placement.modulePixels
  const size = placement.size
  if (placement.rotation === 0)
    throw new QrPosterError('INVALID_INPUT', 'The rotated field needs a non-zero placement rotation.')
  if (size % pitch !== 0)
    throw new QrPosterError('INVALID_INPUT', 'The placement size must be a whole-number module multiple.')
  if (selection.length !== width * height)
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', 'The cut selection does not match its dimensions.', 3)

  const inv = placementInverse(placement)
  // Plate-local AABB every canvas pixel centre can sample from, plus the plate square
  // itself, padded one module in every direction so both extremes stay whole cells.
  let qMinX = 0
  let qMinY = 0
  let qMaxX = size
  let qMaxY = size
  for (const [posterX, posterY] of [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ] as const) {
    const local = inverseMap(inv, posterX, posterY)
    qMinX = Math.min(qMinX, local.x)
    qMinY = Math.min(qMinY, local.y)
    qMaxX = Math.max(qMaxX, local.x)
    qMaxY = Math.max(qMaxY, local.y)
  }
  const colMin = Math.floor(qMinX / pitch) - 1
  const rowMin = Math.floor(qMinY / pitch) - 1
  const colMax = Math.floor(qMaxX / pitch) + 1
  const rowMax = Math.floor(qMaxY / pitch) + 1
  const cols = colMax - colMin + 1
  const rows = rowMax - rowMin + 1
  const field: RotatedField = {
    modulePixels: pitch,
    colMin,
    rowMin,
    cols,
    rows,
    width: cols * pitch,
    height: rows * pitch,
    safe: new Uint8Array(cols * rows),
    plate: new Uint8Array(cols * rows),
    safeModules: 0,
    holeModules: 0,
    partialModules: 0,
    droppedPartialPixels: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  }

  // One pass over the canvas: each poster pixel inversely samples its plate-local
  // module (nearest-neighbour), so a cell's totals count the pixels that belong to it.
  const totals = new Uint32Array(cols * rows)
  const inside = new Uint32Array(cols * rows)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const local = inverseMap(inv, x + 0.5, y + 0.5)
      const column = Math.floor(local.x / pitch) - colMin
      const row = Math.floor(local.y / pitch) - rowMin
      const index = row * cols + column
      if (column < 0 || column >= cols || row < 0 || row >= rows) continue
      totals[index]!++
      if (selection[y * width + x]) inside[index]!++
    }
  }

  const full = pitch * pitch
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < cols; column++) {
      const index = row * cols + column
      const total = totals[index]!
      if (total === full && inside[index] === total) {
        field.safe[index] = 1
        field.safeModules++
        // The block rotates with the placement: its poster-space footprint is the
        // rotated whole module, so the bounds carry it via the shared forward map.
        const localX = (column + colMin) * pitch
        const localY = (row + rowMin) * pitch
        for (const [cornerX, cornerY] of [
          forwardMap(inv, localX, localY),
          forwardMap(inv, localX + pitch, localY),
          forwardMap(inv, localX + pitch, localY + pitch),
          forwardMap(inv, localX, localY + pitch),
        ]) {
          minX = Math.min(minX, cornerX)
          minY = Math.min(minY, cornerY)
          maxX = Math.max(maxX, cornerX)
          maxY = Math.max(maxY, cornerY)
        }
        continue
      }
      if (inside[index]! > 0) {
        field.partialModules++
        field.droppedPartialPixels += inside[index]!
      }
    }
  }
  field.bounds =
    field.safeModules === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  // Plate hole: the whole normalized QR square [0, size)², whole modules only, in
  // plate-local coordinates.
  const plateColumns = size / pitch
  for (let row = 0; row < plateColumns; row++) {
    for (let column = 0; column < plateColumns; column++) {
      field.plate[(row - rowMin) * cols + (column - colMin)] = 1
      field.holeModules++
    }
  }
  return field
}

/** Index of the cell whose whole module block contains a plate-local point, -1 outside. */
export function rotatedCellIndex(field: RotatedField, localX: number, localY: number): number {
  const pitch = field.modulePixels
  const column = Math.floor(localX / pitch) - field.colMin
  const row = Math.floor(localY / pitch) - field.rowMin
  if (column < 0 || column >= field.cols || row < 0 || row >= field.rows) return -1
  return row * field.cols + column
}

/**
 * Byte offset of the plate-local texture pixel a poster pixel samples from: the
 * pattern render's window at `(colMin*pitch, rowMin*pitch)`, colophon snapped to whole
 * modules so this never crosses the boundary of the cell above.
 */
export function rotatedTexelIndex(field: RotatedField, localX: number, localY: number): number {
  const sourceX = Math.floor(localX) - field.colMin * field.modulePixels
  const sourceY = Math.floor(localY) - field.rowMin * field.modulePixels
  if (sourceX < 0 || sourceY < 0 || sourceX >= field.width || sourceY >= field.height) return -1
  return (sourceY * field.width + sourceX) * 4
}

/**
 * Stand-in `ModuleLattice` for helpers that only address a grid by columns/rows (rim
 * computation), so the extended grid shares the same whole-module rim logic.
 */
export function fieldLattice(field: RotatedField): ModuleLattice {
  return {
    x: 0,
    y: 0,
    modulePixels: field.modulePixels,
    columns: field.cols,
    rows: field.rows,
    width: field.width,
    height: field.height,
  }
}
