import { plateToPosterPoint } from '@/core/rotate'
import { canonicalPlacement, type Placement } from './schema'

export type PlacementGestureKind = 'move' | 'resize' | 'rotate'

export interface PlacementGesture {
  kind: PlacementGestureKind
  pointer: number
  origin: Placement
  baseline: Placement
  startX: number
  startY: number
  centerX: number
  centerY: number
  anchorX: number
  anchorY: number
  centerMode: boolean
  latest: Placement
}

export function beginPlacementGesture(
  kind: PlacementGestureKind,
  pointer: number,
  point: { x: number; y: number },
  placement: Placement,
  centerMode = false,
): PlacementGesture {
  const centerX = placement.x + placement.size / 2
  const centerY = placement.y + placement.size / 2
  const anchor = plateToPosterPoint(0, 0, placement)
  return {
    kind,
    pointer,
    origin: placement,
    baseline: placement,
    startX: point.x,
    startY: point.y,
    centerX,
    centerY,
    anchorX: anchor.x,
    anchorY: anchor.y,
    centerMode,
    latest: placement,
  }
}

export function rebasePlacementGesture(
  gesture: PlacementGesture,
  point: { x: number; y: number },
  placement: Placement,
  centerMode: boolean,
): void {
  gesture.baseline = placement
  gesture.startX = point.x
  gesture.startY = point.y
  gesture.centerX = placement.x + placement.size / 2
  gesture.centerY = placement.y + placement.size / 2
  const anchor = plateToPosterPoint(0, 0, placement)
  gesture.anchorX = anchor.x
  gesture.anchorY = anchor.y
  gesture.centerMode = centerMode
  gesture.latest = placement
}

export function placementAtPointer(
  gesture: PlacementGesture,
  point: { x: number; y: number },
  modules: number,
  centerMode = gesture.centerMode,
): Placement {
  const { baseline } = gesture
  const dx = point.x - gesture.startX
  const dy = point.y - gesture.startY
  if (gesture.kind === 'move') return { ...baseline, x: baseline.x + dx, y: baseline.y + dy }
  if (gesture.kind === 'rotate') {
    const before = Math.atan2(gesture.startY - gesture.centerY, gesture.startX - gesture.centerX)
    const after = Math.atan2(point.y - gesture.centerY, point.x - gesture.centerX)
    return { ...baseline, rotation: baseline.rotation + ((after - before) * 180) / Math.PI }
  }

  const radians = (baseline.rotation * Math.PI) / 180
  const localX = Math.cos(radians) * dx + Math.sin(radians) * dy
  const localY = -Math.sin(radians) * dx + Math.cos(radians) * dy
  const sizeDelta = centerMode ? localX + localY : (localX + localY) / 2
  const size = Math.max(modules * 4, baseline.size + sizeDelta)
  if (centerMode) {
    return {
      ...baseline,
      size,
      x: gesture.centerX - size / 2,
      y: gesture.centerY - size / 2,
    }
  }

  const half = size / 2
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    ...baseline,
    size,
    x: gesture.anchorX - half + half * cos - half * sin,
    y: gesture.anchorY - half + half * sin + half * cos,
  }
}

export function canonicalGesturePlacement(gesture: PlacementGesture, candidate: Placement, modules: number): Placement {
  const canonical = canonicalPlacement(candidate, modules)
  if (gesture.kind !== 'resize') return canonical

  const size = canonical.size
  if (gesture.centerMode) {
    return {
      ...canonical,
      x: Math.round(gesture.centerX - size / 2),
      y: Math.round(gesture.centerY - size / 2),
    }
  }

  const half = size / 2
  const radians = (canonical.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    ...canonical,
    x: Math.round(gesture.anchorX - half + half * cos - half * sin),
    y: Math.round(gesture.anchorY - half + half * sin + half * cos),
  }
}

export function placementTransform(from: Placement, to: Placement): string {
  const fromX = from.x + from.size / 2
  const fromY = from.y + from.size / 2
  const toX = to.x + to.size / 2
  const toY = to.y + to.size / 2
  const scale = to.size / from.size
  return `translate(${toX} ${toY}) rotate(${to.rotation}) scale(${scale}) translate(${-fromX} ${-fromY})`
}

export function placementFrameTransform(placement: Placement): string {
  return `rotate(${placement.rotation} ${placement.x + placement.size / 2} ${placement.y + placement.size / 2})`
}

export function samePlacement(a: Placement, b: Placement): boolean {
  return a.x === b.x && a.y === b.y && a.size === b.size && a.rotation === b.rotation
}
