/**
 * Pure rotation geometry for the placement step. The QR generator is unaware of
 * rotation: it always produces the complete upright square plate. Rotation is a
 * property of placement — clockwise degrees around the unrotated square's
 * centre, applied once when compositing the finished plate onto the poster.
 *
 * `x`, `y`, and `size` keep describing the **unrotated square**, so the existing
 * editor contract (integer origin, module-multiple size) is unchanged.
 */

import { QrPosterError } from './errors'

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

/** Tight integer poster-space AABB of the painted region, end coordinates exclusive. */
export interface PixelBounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The upright assembly's working canvas, expressed in plate-local coordinates
 * (origin = the unrotated placement square's top-left). The frame is the integer
 * AABB that contains every poster pixel's inverse-rotated sample point, so the
 * whole-module pipeline can run there and the finished overlay can ride the same
 * placement transform back onto the poster. See doc/plan/rotated-mask-fill.md.
 */
export interface QrFrame {
  /** Plate-local x/y of the working canvas' top-left; can be negative. */
  left: number
  top: number
  width: number
  height: number
  /** The unrotated QR box expressed in working-canvas coordinates. */
  qr: { x: number; y: number; size: number }
}

/**
 * The working frame for a rotated placement: the plate-local AABB of the
 * inverse-mapped painted-region bounds, floored/ceiled to whole pixels. Every
 * poster pixel whose sample point can land inside the region maps into this
 * frame, so mask sampling and overlay generation never look outside it.
 */
export function qrWorkingFrame(placement: RotatableBox, regionBounds: PixelBounds): QrFrame {
  const corners = [
    posterToPlatePoint(regionBounds.x0, regionBounds.y0, placement),
    posterToPlatePoint(regionBounds.x1, regionBounds.y0, placement),
    posterToPlatePoint(regionBounds.x1, regionBounds.y1, placement),
    posterToPlatePoint(regionBounds.x0, regionBounds.y1, placement),
  ]
  const minX = Math.min(...corners.map((corner) => corner.x))
  const minY = Math.min(...corners.map((corner) => corner.y))
  const maxX = Math.max(...corners.map((corner) => corner.x))
  const maxY = Math.max(...corners.map((corner) => corner.y))
  const left = Math.floor(minX)
  const top = Math.floor(minY)
  return {
    left,
    top,
    width: Math.ceil(maxX) - left,
    height: Math.ceil(maxY) - top,
    qr: { x: -left, y: -top, size: placement.size },
  }
}

/**
 * Samples the original region mask into the working frame with the same inverse
 * transform assembly's plate pixels use: each working pixel centre maps forward
 * to its poster sample point, and the working mask keeps that poster pixel's
 * selection. Off-poster samples are 0, so safe-area checks stay whole blocks.
 */
export function sampleMaskIntoQrFrame(
  mask: Uint8Array,
  posterWidth: number,
  posterHeight: number,
  frame: QrFrame,
  placement: RotatableBox,
): Uint8Array {
  if (mask.length !== posterWidth * posterHeight)
    throw new Error('sampleMaskIntoQrFrame: mask does not match the poster dimensions.')
  const inv = placementInverse(placement)
  const working = new Uint8Array(frame.width * frame.height)
  for (let wy = 0; wy < frame.height; wy++) {
    for (let wx = 0; wx < frame.width; wx++) {
      const poster = forwardMap(inv, wx + frame.left + 0.5, wy + frame.top + 0.5)
      const sourceX = Math.floor(poster.x)
      const sourceY = Math.floor(poster.y)
      if (sourceX < 0 || sourceY < 0 || sourceX >= posterWidth || sourceY >= posterHeight) continue
      if (mask[sourceY * posterWidth + sourceX]) working[wy * frame.width + wx] = 1
    }
  }
  return working
}

/** Tight poster-space AABB of a painted-region mask, end coordinates exclusive. */
export function regionPixelBounds(mask: { data: Uint8Array; width: number; height: number }): PixelBounds {
  let x0 = mask.width
  let y0 = mask.height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x + 1)
      y1 = Math.max(y1, y + 1)
    }
  }
  if (x1 === 0 || y1 === 0) throw new Error('regionPixelBounds: the region mask is empty.')
  return { x0, y0, x1, y1 }
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

/**
 * The rotated-frame invariant: every poster pixel centre that belongs to the valid
 * placed QR square must map to a working pixel inside the working frame. A frame
 * built from wrong region bounds would silently drop plate cells, and the assembly's
 * `qrPixels` check never sees a plate cell it cannot address. Rejected with the
 * layout error both validation and assembly report, so a bad placement is flagged
 * before export instead of clipping silently (doc/plan/rotated-working-frame-clipping.md).
 */
export function assertFrameHoldsPlacement(
  frame: QrFrame,
  placement: RotatableBox,
  posterWidth: number,
  posterHeight: number,
): void {
  for (let y = 0; y < posterHeight; y++) {
    for (let x = 0; x < posterWidth; x++) {
      const local = posterToPlatePoint(x + 0.5, y + 0.5, placement)
      if (!localPointInPlate(local.x, local.y, placement.size)) continue
      const wx = Math.floor(local.x - frame.left)
      const wy = Math.floor(local.y - frame.top)
      if (wx >= 0 && wy >= 0 && wx < frame.width && wy < frame.height) continue
      throw new QrPosterError(
        'QR_LAYOUT_INVALID',
        'The rotated working frame does not cover the placed QR plate; the placement would be clipped. ' +
          'Adjust the position, size, or rotation inside the painted region.',
      )
    }
  }
}
