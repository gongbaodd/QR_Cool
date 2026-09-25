import { plateToPosterPoint } from '@mahu-qr/renderer/core/rotate'
import type { Placement } from '@mahu-qr/renderer/schema'
import { describe, expect, it } from 'vitest'
import {
  beginPlacementGesture,
  canonicalGesturePlacement,
  placementAtPointer,
  rebasePlacementGesture,
} from '@/lib/editor/placement-gesture'

const placement: Placement = { x: 120, y: 80, size: 225, rotation: 0 }

function localDiagonalDelta(rotation: number, amount: number) {
  const radians = (rotation * Math.PI) / 180
  return {
    x: amount * Math.cos(radians) - amount * Math.sin(radians),
    y: amount * Math.sin(radians) + amount * Math.cos(radians),
  }
}

describe('QR placement gestures', () => {
  it.each([0, 45, 90])('projects resize motion onto the local diagonal at %s°', (rotation) => {
    const box = { ...placement, rotation }
    const start = { x: 500, y: 420 }
    const delta = localDiagonalDelta(rotation, 24)
    const gesture = beginPlacementGesture('resize', 1, start, box)
    const candidate = placementAtPointer(gesture, { x: start.x + delta.x, y: start.y + delta.y }, 45)

    expect(candidate.size).toBeCloseTo(box.size + 24)
    const before = plateToPosterPoint(0, 0, box)
    const after = plateToPosterPoint(0, 0, candidate)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)

    const committed = canonicalGesturePlacement(gesture, candidate, 45)
    expect(committed.size).toBe(270)
    expect(Number.isInteger(committed.x)).toBe(true)
    expect(Number.isInteger(committed.y)).toBe(true)
    const snappedAnchor = plateToPosterPoint(0, 0, committed)
    expect(Math.abs(snappedAnchor.x - before.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(snappedAnchor.y - before.y)).toBeLessThanOrEqual(1)
  })

  it('keeps the placement centre fixed when Alt scaling is active', () => {
    const start = { x: 500, y: 420 }
    const delta = localDiagonalDelta(placement.rotation, 12)
    const gesture = beginPlacementGesture('resize', 1, start, placement, true)
    const candidate = placementAtPointer(gesture, { x: start.x + delta.x, y: start.y + delta.y }, 45)

    expect(candidate.size).toBeCloseTo(placement.size + 24)
    expect(candidate.x + candidate.size / 2).toBeCloseTo(placement.x + placement.size / 2)
    expect(candidate.y + candidate.size / 2).toBeCloseTo(placement.y + placement.size / 2)

    const committed = canonicalGesturePlacement(gesture, candidate, 45)
    expect(committed.size).toBe(270)
    expect(Math.abs(committed.x + committed.size / 2 - (placement.x + placement.size / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(committed.y + committed.size / 2 - (placement.y + placement.size / 2))).toBeLessThanOrEqual(1)
  })

  it('rebases when the resize modifier changes without moving the QR', () => {
    const start = { x: 500, y: 420 }
    const delta = localDiagonalDelta(45, 18)
    const pointer = { x: start.x + delta.x, y: start.y + delta.y }
    const gesture = beginPlacementGesture('resize', 1, start, { ...placement, rotation: 45 })
    const beforeToggle = placementAtPointer(gesture, pointer, 45)

    rebasePlacementGesture(gesture, pointer, beforeToggle, true)
    const atToggle = placementAtPointer(gesture, pointer, 45, true)
    expect(atToggle).toEqual(beforeToggle)

    const nextDelta = localDiagonalDelta(45, 6)
    const afterToggle = placementAtPointer(
      gesture,
      { x: pointer.x + nextDelta.x, y: pointer.y + nextDelta.y },
      45,
      true,
    )
    expect(afterToggle.size).toBeCloseTo(beforeToggle.size + 12)
  })

  it('keeps move and rotation candidates in poster coordinates', () => {
    const start = { x: 300, y: 240 }
    const moveGesture = beginPlacementGesture('move', 1, start, placement)
    expect(placementAtPointer(moveGesture, { x: 317.5, y: 231 }, 45)).toMatchObject({ x: 137.5, y: 71 })

    const centerX = placement.x + placement.size / 2
    const centerY = placement.y + placement.size / 2
    const rotateGesture = beginPlacementGesture('rotate', 2, { x: centerX + 100, y: centerY }, placement)
    const rotated = placementAtPointer(rotateGesture, { x: centerX, y: centerY + 100 }, 45)
    expect(rotated.rotation).toBeCloseTo(90)
  })
})
