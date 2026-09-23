import { describe, expect, it } from 'vitest'
import {
  buildModuleLattice,
  buildModulePath,
  computePlateModules,
  computeRimModules,
  computeSafeArea,
  moduleBlock,
  moduleCellIndex,
  renderModuleCoverage,
} from '@/core/module-cut'

/** Rectangle of 1s inside a width x height grid, with a one-pixel border left outside. */
function rectangle(width: number, height: number, x: number, y: number, size: number): Uint8Array {
  const selection = new Uint8Array(width * height)
  for (let row = y; row < y + size; row++) {
    for (let column = x; column < x + size; column++) selection[row * width + column] = 1
  }
  return selection
}

describe('module lattice', () => {
  it('reduces the origin to a phase inside one module and covers the canvas', () => {
    const lattice = buildModuleLattice(688, 566, 5, { x: 249, y: 201 })
    expect(lattice).toMatchObject({ x: 4, y: 1, modulePixels: 5, columns: 137, rows: 113 })
    expect(moduleBlock(lattice, 0, 0)).toEqual({ x: 4, y: 1, size: 5 })
    expect(moduleBlock(lattice, 2, 3)).toEqual({ x: 14, y: 16, size: 5 })
    expect(moduleCellIndex(lattice, 4, 1)).toBe(0)
    expect(moduleCellIndex(lattice, 9, 6)).toBe(1 * 137 + 1)
    expect(moduleCellIndex(lattice, 8, 5)).toBe(0)
    expect(moduleCellIndex(lattice, 3, 300)).toBe(-1)
    // The last column starts at 684 and covers 688 too; only a pixel past 689 leaves the lattice.
    expect(moduleCellIndex(lattice, 688, 300)).toBe(59 * 137 + 136)
    expect(moduleCellIndex(lattice, 689, 300)).toBe(-1)
  })

  it('rejects a pitch that is not a positive integer', () => {
    expect(() => buildModuleLattice(10, 10, 0, { x: 0, y: 0 })).toThrowError(/module pitch/)
  })
})

describe('safe area', () => {
  it('keeps only the modules the region covers in full', () => {
    const lattice = buildModuleLattice(40, 40, 5, { x: 0, y: 0 })
    // Modules 1..5 are inside the block (5..30); module 0 and module 6 touch its edge.
    const selection = rectangle(40, 40, 5, 5, 25)
    const area = computeSafeArea(selection, 40, 40, lattice)
    expect(area.safeModules).toBe(25)
    expect(area.partialModules).toBe(0)
    expect(area.bounds).toEqual({ x: 5, y: 5, width: 25, height: 25 })

    // A block that ends mid-module drops that module and counts its pixels.
    const ragged = rectangle(40, 40, 5, 5, 23)
    const raggedArea = computeSafeArea(ragged, 40, 40, lattice)
    expect(raggedArea.safeModules).toBe(16)
    expect(raggedArea.partialModules).toBe(9)
    // 23x23 region pixels minus the 16 safe modules' 20x20 block: four partial modules along each
    // of the two ragged edges, each keeping 3 of its 5 columns (or rows), plus the 3x3 corner.
    expect(raggedArea.droppedPartialPixels).toBe(4 * 3 * 5 + 4 * 3 * 5 + 3 * 3)
    expect(raggedArea.droppedPartialPixels).toBe(23 * 23 - 20 * 20)
  })

  it('drops modules that run off the canvas', () => {
    // With a phase of 3 the last column starts at 38 and its block leaves the canvas.
    const lattice = buildModuleLattice(40, 40, 5, { x: 3, y: 3 })
    expect(lattice.columns).toBe(8)
    const selection = new Uint8Array(40 * 40).fill(1)
    const area = computeSafeArea(selection, 40, 40, lattice)
    expect(area.safeModules).toBe(7 * 7)
    expect(area.partialModules).toBe(15)
    // The last column and row keep only their two on-canvas slices.
    expect(area.droppedPartialPixels).toBe(7 * 10 + 7 * 10 + 4)
  })

  it('reports no bounds when nothing is safe', () => {
    const lattice = buildModuleLattice(20, 20, 5, { x: 0, y: 0 })
    const area = computeSafeArea(new Uint8Array(20 * 20), 20, 20, lattice)
    expect(area.safeModules).toBe(0)
    expect(area.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('rim modules', () => {
  it('marks the outer rings of a block and nothing deeper', () => {
    const lattice = buildModuleLattice(60, 60, 5, { x: 0, y: 0 })
    // Safe modules 1..10 (blocks 5..55): a 10x10 block of modules.
    const safe = new Uint8Array(lattice.columns * lattice.rows)
    for (let row = 1; row <= 10; row++) {
      for (let column = 1; column <= 10; column++) safe[row * lattice.columns + column] = 1
    }
    const rim = computeRimModules(safe, lattice, 4)
    expect(rim[1 * lattice.columns + 1]).toBe(1)
    expect(rim[5 * lattice.columns + 5]).toBe(0)
    let counted = 0
    for (const value of rim) counted += value
    // 10x10 minus the 2x2 interior that sits further than four modules from the edge.
    expect(counted).toBe(100 - 4)
  })

  it('treats a narrow feature as all rim and a zero width as no rim', () => {
    const lattice = buildModuleLattice(30, 30, 5, { x: 0, y: 0 })
    const safe = new Uint8Array(lattice.columns * lattice.rows)
    safe[2 * lattice.columns + 1] = 1
    safe[2 * lattice.columns + 2] = 1
    const rim = computeRimModules(safe, lattice, 4)
    expect([...rim].filter((value) => value === 1)).toHaveLength(2)
    expect([...computeRimModules(safe, lattice, 0)]).toEqual([...new Uint8Array(safe.length)])
  })
})

describe('plate modules', () => {
  it('unions the plate rectangles and hands the corner blocks back', () => {
    const lattice = buildModuleLattice(60, 60, 5, { x: 2, y: 2 })
    // A code grid plus the two arms beside a marker and its diagonal corner block.
    const plate = computePlateModules(
      lattice,
      [
        { x: 7, y: 7, width: 25, height: 25 },
        { x: 2, y: 7, width: 5, height: 25 },
        { x: 7, y: 2, width: 25, height: 5 },
      ],
      [{ x: 2, y: 2, width: 5, height: 5 }],
    )
    expect(plate.holeModules).toBe(25 + 5 + 5)
    expect(plate.cornerModules).toBe(1)
    expect(plate.bounds).toEqual({ x: 2, y: 2, width: 30, height: 30 })
    let corners = 0
    for (const value of plate.corners) corners += value
    expect(corners).toBe(1)
    // No module is both the hole and a corner handed to the texture.
    for (let index = 0; index < plate.cells.length; index++)
      expect(plate.cells[index]! + plate.corners[index]!).toBeLessThanOrEqual(1)
  })

  it('covers the whole band when the corner blocks are not handed back', () => {
    const lattice = buildModuleLattice(60, 60, 5, { x: 2, y: 2 })
    // With no hand-back the corner block belongs to the band, so the plate is the whole L.
    const plate = computePlateModules(lattice, [
      { x: 7, y: 7, width: 25, height: 25 },
      { x: 2, y: 7, width: 5, height: 25 },
      { x: 7, y: 2, width: 25, height: 5 },
      { x: 2, y: 2, width: 5, height: 5 },
    ])
    expect(plate.holeModules).toBe(25 + 5 + 5 + 1)
    expect(plate.cornerModules).toBe(0)
    expect(plate.bounds).toEqual({ x: 2, y: 2, width: 30, height: 30 })
  })

  it('marks only the modules a rectangle covers in full and reaches past the canvas safely', () => {
    // The hole is the modules each rectangle covers in full, so a rectangle that starts inside a
    // module does not slice it, and one that runs off the canvas simply stops at the edge.
    const lattice = buildModuleLattice(60, 60, 5, { x: 2, y: 2 })
    const plate = computePlateModules(lattice, [
      // Covers columns 1..5 and rows 1..5.
      { x: 6, y: 6, width: 28, height: 28 },
      // Starts off-canvas, so only the columns that sit fully inside it are marked: 0..1.
      { x: -20, y: 30, width: 32, height: 20 },
      // Overlaps the first rectangle, which must not be counted twice.
      { x: 7, y: 7, width: 15, height: 15 },
    ])
    expect(plate.holeModules).toBe(5 * 5 + 2 * 3)
    expect(plate.cornerModules).toBe(0)
    expect(plate.bounds).toEqual({ x: 2, y: 7, width: 30, height: 40 })
    expect(() => computePlateModules(lattice, [{ x: 7, y: 7, width: 0, height: 25 }])).toThrowError(/positive size/)
    expect(() => computePlateModules(lattice, [])).toThrowError(/at least one rectangle/)
  })
})

describe('module path and coverage', () => {
  it('emits one rectangle per selected module', () => {
    const lattice = buildModuleLattice(20, 20, 5, { x: 0, y: 0 })
    const cells = new Uint8Array(lattice.columns * lattice.rows)
    cells[0] = 1
    cells[1 * lattice.columns + 1] = 1
    expect(buildModulePath(cells, lattice)).toBe('M0,0h5v5h-5ZM5,5h5v5h-5Z')
    expect(() => buildModulePath(new Uint8Array(cells.length), lattice)).toThrowError(/selects no modules/)
  })

  it('rasterizes binary coverage with no partial pixel', async () => {
    const lattice = buildModuleLattice(20, 20, 4, { x: 0, y: 0 })
    const cells = new Uint8Array(lattice.columns * lattice.rows)
    for (let row = 1; row <= 3; row++) {
      for (let column = 1; column <= 3; column++) cells[row * lattice.columns + column] = 1
    }
    cells[2 * lattice.columns + 2] = 0
    const coverage = await renderModuleCoverage(buildModulePath(cells, lattice), 20, 20)
    const values = new Set(coverage)
    expect([...values].sort()).toEqual([0, 255])
    let opaque = 0
    for (const value of coverage) opaque += value === 255 ? 1 : 0
    // 9 modules of 16px minus the one hole module in the middle.
    expect(opaque).toBe(8 * 16)
    expect(coverage[(1 * 4 + 1) * 20 + 1 * 4 + 1]).toBe(255)
    expect(coverage[2 * 20 + 2]).toBe(0)
    expect(coverage[(2 * 4 + 2) * 20 + 2 * 4 + 2]).toBe(0)
  })
})
