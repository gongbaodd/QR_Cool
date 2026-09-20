// Bucket fill for the step-2 mask preview.
//
// Walls are white mask pixels (white-selects-region); open pixels are black.
// `computeFillRegion` returns the black pixels to paint white, or null when the
// seed is invalid or the region is open (connected to the canvas edge).
//
// Work is bounded to a growing ROI around the seed so small enclosed clicks
// never pay for a full-canvas flood. Only a genuinely open shape expands
// toward the full canvas before aborting.

export interface FillBounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Try the fill inside one ROI. Returns the filled pixels in ROI coordinates,
 * `null` for an open/invalid seed, or `'expand'` when the region touches the
 * ROI edge and a larger ROI could change the answer.
 */
function tryFillInRoi(
  walls: Uint8Array,
  width: number,
  height: number,
  bounds: FillBounds,
  seedX: number,
  seedY: number,
): Uint8Array | null | 'expand' {
  const { x0, y0, x1, y1 } = bounds
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return null
  const lx = seedX - x0
  const ly = seedY - y0
  const at = (x: number, y: number) => walls[(y0 + y) * width + (x0 + x)]!
  if (at(lx, ly) === 1) return null

  const crop = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crop[y * w + x] = at(x, y)

  const filled = new Uint8Array(w * h)
  const stack = [ly * w + lx]
  filled[ly * w + lx] = 1
  let touchesRoiEdge = false
  const touchesCanvasAt = (x: number, y: number) =>
    x0 + x === 0 || y0 + y === 0 || x0 + x === width - 1 || y0 + y === height - 1

  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    if (touchesCanvasAt(x, y)) return null
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesRoiEdge = true
    const visit = (n: number) => {
      if (filled[n] === 1 || crop[n] === 1) return
      filled[n] = 1
      stack.push(n)
    }
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (y > 0) visit(i - w)
    if (y < h - 1) visit(i + w)
  }
  if (touchesRoiEdge) return 'expand'
  return filled
}

/**
 * Fill region for a binary wall map (`1` = white barrier).
 * Returns a full-canvas mask (`1` = paint white) or null when the seed is a
 * wall, out of bounds, or in a region open to the canvas edge.
 */
export function computeFillRegion(
  walls: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
): Uint8Array | null {
  if (width <= 0 || height <= 0 || walls.length < width * height) return null
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return null
  if (walls[seedY * width + seedX] === 1) return null
  let size = 64
  for (;;) {
    const half = Math.floor(size / 2)
    const bounds: FillBounds = {
      x0: Math.max(0, seedX - half),
      y0: Math.max(0, seedY - half),
      x1: Math.min(width, seedX + half),
      y1: Math.min(height, seedY + half),
    }
    const result = tryFillInRoi(walls, width, height, bounds, seedX, seedY)
    if (result === 'expand') {
      if (bounds.x0 === 0 && bounds.y0 === 0 && bounds.x1 === width && bounds.y1 === height) return null
      if (size >= Math.max(width, height)) return null
      size *= 2
      continue
    }
    if (result === null) return null
    const filled = new Uint8Array(width * height)
    const w = bounds.x1 - bounds.x0
    const h = bounds.y1 - bounds.y0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (result[y * w + x] === 1) filled[(bounds.y0 + y) * width + (bounds.x0 + x)] = 1
    return filled
  }
}
