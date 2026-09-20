/**
 * Pure rotation geometry for the placement step. The QR generator is unaware of
 * rotation: it always produces the complete upright square plate. Rotation is a
 * property of placement — clockwise degrees around the unrotated square's
 * centre, applied once when compositing the finished plate onto the poster.
 *
 * `x`, `y`, and `size` keep describing the **unrotated square**, so the existing
 * editor contract (integer origin, module-multiple size) is unchanged.
 */

/** Any placement-like box that can carry a rotation, in degrees. */
export interface RotatableBox {
  x: number
  y: number
  size: number
  rotation?: number | undefined
}

/** Canonicalizes an angle to finite degrees in `[0, 360)`; non-finite input maps to 0. */
export function canonicalizeRotation(deg: number | undefined): number {
  if (deg === undefined || !Number.isFinite(deg)) return 0
  const normalized = deg % 360
  return normalized < 0 ? normalized + 360 : normalized
}

/** Centre of the unrotated placement square in poster pixels. */
export function placementCenter(box: RotatableBox): { x: number; y: number } {
  return { x: box.x + box.size / 2, y: box.y + box.size / 2 }
}

/**
 * The placement transform precomputed: centre, canonical half size, and the
 * rotation's cos/sin. Tight per-pixel loops (field building, assembly sampling)
 * reuse it instead of recomputing trigonometry for every pixel, and the fast
 * mappers are the same math as the point helpers below.
 */
export interface PlacementInverse {
  centerX: number
  centerY: number
  size: number
  cos: number
  sin: number
}

/** Precomputes the inverse placement transform of {@link posterToPlatePoint}. */
export function placementInverse(box: RotatableBox): PlacementInverse {
  const radians = (canonicalizeRotation(box.rotation) * Math.PI) / 180
  const center = placementCenter(box)
  return {
    centerX: center.x,
    centerY: center.y,
    size: box.size,
    cos: Math.cos(radians),
    sin: Math.sin(radians),
  }
}

/** Fast {@link plateToPosterPoint} over a precomputed {@link PlacementInverse}. */
export function forwardMap(
  inv: PlacementInverse,
  localX: number,
  localY: number,
): { x: number; y: number } {
  const dx = localX - inv.size / 2
  const dy = localY - inv.size / 2
  return {
    x: inv.centerX + dx * inv.cos - dy * inv.sin,
    y: inv.centerY + dx * inv.sin + dy * inv.cos,
  }
}

/** Fast {@link posterToPlatePoint} over a precomputed {@link PlacementInverse}. */
export function inverseMap(
  inv: PlacementInverse,
  posterX: number,
  posterY: number,
): { x: number; y: number } {
  const dx = posterX - inv.centerX
  const dy = posterY - inv.centerY
  return {
    x: inv.size / 2 + dx * inv.cos + dy * inv.sin,
    y: inv.size / 2 - dx * inv.sin + dy * inv.cos,
  }
}

/**
 * Maps a plate-local point (origin = the unrotated square's top-left) forward to
 * poster coordinates: the same centre and angle the Konva preview uses, so
 * preview, validation, and assembly cannot disagree about the footprint.
 */
export function plateToPosterPoint(
  localX: number,
  localY: number,
  box: RotatableBox,
): { x: number; y: number } {
  return forwardMap(placementInverse(box), localX, localY)
}

/**
 * Inverse of {@link plateToPosterPoint}: maps a poster-space sample point back
 * into plate-local coordinates. Assembly and mask containment iterate
 * destination pixels and use this to find the source pixel they read.
 */
export function posterToPlatePoint(
  posterX: number,
  posterY: number,
  box: RotatableBox,
): { x: number; y: number } {
  return inverseMap(placementInverse(box), posterX, posterY)
}

/** The four corners of the rotated plate square, in consistent clockwise order. */
export function rotatedSquareCorners(box: RotatableBox): readonly [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  return [
    plateToPosterPoint(0, 0, box),
    plateToPosterPoint(box.size, 0, box),
    plateToPosterPoint(box.size, box.size, box),
    plateToPosterPoint(0, box.size, box),
  ]
}

/** Integer pixel bounds covering the rotated plate's footprint, clipped to the canvas. */
export function rotatedFootprintBounds(
  box: RotatableBox,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } {
  const corners = rotatedSquareCorners(box)
  const minX = Math.min(...corners.map((corner) => corner.x))
  const minY = Math.min(...corners.map((corner) => corner.y))
  const maxX = Math.max(...corners.map((corner) => corner.x))
  const maxY = Math.max(...corners.map((corner) => corner.y))
  return {
    left: Math.max(0, Math.floor(minX)),
    top: Math.max(0, Math.floor(minY)),
    right: Math.min(width, Math.ceil(maxX)),
    bottom: Math.min(height, Math.ceil(maxY)),
  }
}

/**
 * Whether a plate-local point lies inside the plate square `[0, size) × [0, size)`.
 * Nearest-neighbour sampling maps a poster pixel centre here and copies the
 * source pixel at `floor(x), floor(y)` when it does.
 */
export function localPointInPlate(
  localX: number,
  localY: number,
  size: number,
): boolean {
  return localX >= 0 && localY >= 0 && localX < size && localY < size
}
