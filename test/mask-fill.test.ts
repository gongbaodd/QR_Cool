import { describe, expect, it } from 'vitest'
import { computeFillRegion } from '../src/lib/editor/mask-fill'

const W = 20
const H = 20

/** 10x10 wall ring x,y in 5..14; optional gap columns removed on the right edge. */
function ringWalls(gapRows: number[] = []): Uint8Array {
  const walls = new Uint8Array(W * H)
  for (let y = 5; y <= 14; y++)
    for (let x = 5; x <= 14; x++) {
      const edge = x === 5 || x === 14 || y === 5 || y === 14
      if (!edge) continue
      if (x === 14 && gapRows.includes(y)) continue
      walls[y * W + x] = 1
    }
  return walls
}

function count(filled: Uint8Array | null): number {
  if (!filled) return 0
  let n = 0
  for (const v of filled) n += v
  return n
}

describe('computeFillRegion', () => {
  it('fills a fully enclosed O interior with exact flood behavior', () => {
    const filled = computeFillRegion(ringWalls(), W, H, 9, 9)
    expect(filled).not.toBeNull()
    // 8x8 interior.
    expect(count(filled)).toBe(64)
    // Walls are never painted.
    for (let i = 0; i < W * H; i++) if (ringWalls()[i] === 1) expect(filled![i]).toBe(0)
  })

  it('does not fill a C-shaped region with a gap', () => {
    const walls = ringWalls([8, 9, 10])
    expect(computeFillRegion(walls, W, H, 9, 9)).toBeNull()
  })

  it('keeps a widely open shape open', () => {
    const walls = ringWalls([6, 7, 8, 9, 10, 11, 12, 13])
    expect(computeFillRegion(walls, W, H, 9, 9)).toBeNull()
  })

  it('rejects wall, out-of-bounds, and border-connected seeds', () => {
    const walls = ringWalls()
    expect(computeFillRegion(walls, W, H, 5, 5)).toBeNull()
    expect(computeFillRegion(walls, W, H, -1, 9)).toBeNull()
    expect(computeFillRegion(walls, W, H, 0, 0)).toBeNull()
  })

  it('bounds work to the pocket instead of the full canvas', () => {
    const big = new Uint8Array(600 * 600)
    for (let y = 50; y <= 70; y++)
      for (let x = 50; x <= 70; x++) {
        if (x === 50 || x === 70 || y === 50 || y === 70) big[y * 600 + x] = 1
      }
    const filled = computeFillRegion(big, 600, 600, 60, 60)
    expect(count(filled)).toBe(19 * 19)
  })
})
