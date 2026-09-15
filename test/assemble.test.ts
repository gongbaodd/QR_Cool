import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { assemblePoster } from '../src/assemble.js'
import { buildModuleLattice, buildModulePath, computeRimModules, moduleCellIndex } from '../src/module-cut.js'
import { buildPosterPattern, renderRoundedPattern } from '../src/pattern.js'
import { decodeQrBuffer } from '../src/qr.js'
import type { AssembleReport } from '../src/types.js'

const POSTER = resolve('source/poster.png')
const FIXTURE_QR = resolve('test/fixtures/qr.png')
const TRIMMED_QR = resolve('source/qr.png')
const ARTIFACTS = ['pattern-cut.png', 'pattern-cut.svg', 'poster.png', 'qr.png', 'region-mask.png', 'report.json']
const RIM_MODULES = 4

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qr-cool-assemble-'))
  temporaryDirectories.push(path)
  return path
}

interface RawImage {
  data: Uint8Array
  width: number
  height: number
}

async function raw(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

/** Module grid of a mask, safe when every pixel of the module is inside it. */
function safeModules(mask: RawImage, lattice: ReturnType<typeof buildModuleLattice>): Uint8Array {
  const grid = new Uint8Array(lattice.columns * lattice.rows)
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      let safe = 1
      for (let offsetY = 0; offsetY < lattice.modulePixels && safe; offsetY++) {
        for (let offsetX = 0; offsetX < lattice.modulePixels; offsetX++) {
          const x = lattice.x + column * lattice.modulePixels + offsetX
          const y = lattice.y + row * lattice.modulePixels + offsetY
          if (x >= mask.width || y >= mask.height || !mask.data[(y * mask.width + x) * 4]) {
            safe = 0
            break
          }
        }
      }
      grid[row * lattice.columns + column] = safe
    }
  }
  return grid
}

type Lattice = ReturnType<typeof buildModuleLattice>

/** Lattice cells a poster-pixel rectangle covers in full, the rule the plate is built on. */
function rectCells(lattice: Lattice, x: number, y: number, width: number, height: number): number[] {
  const pitch = lattice.modulePixels
  const firstColumn = Math.ceil((x - lattice.x) / pitch)
  const firstRow = Math.ceil((y - lattice.y) / pitch)
  const lastColumn = Math.floor((x + width - lattice.x) / pitch) - 1
  const lastRow = Math.floor((y + height - lattice.y) / pitch) - 1
  const cells: number[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows)
        continue
      cells.push(row * lattice.columns + column)
    }
  }
  return cells
}

/**
 * The marker band as poster-pixel rectangles: beside each 7x7 finder, the arm above or below it and
 * the arm on its outer side, plus the diagonal corner block. Rebuilt from the report, so the tests
 * check the geometry the report claims rather than the implementation.
 */
function markerBandRects(report: AssembleReport): { arms: number[][], cornerBlocks: number[][] } {
  const pitch = report.placement.modulePixels
  const grid = report.qrPlate.box
  const markerPixels = report.qrPlate.markerModules * pitch
  const marginPixels = report.qrPlate.marginPixels
  const last = report.qr.qrModules - report.qrPlate.markerModules
  const arms: number[][] = []
  const cornerBlocks: number[][] = []
  for (const { column, row } of [{ column: 0, row: 0 }, { column: last, row: 0 }, { column: 0, row: last }]) {
    const markerX = grid.x + column * pitch
    const markerY = grid.y + row * pitch
    const outerX = column === 0 ? grid.x - marginPixels : grid.x + grid.width
    const outerY = row === 0 ? grid.y - marginPixels : grid.y + grid.height
    arms.push([markerX, outerY, markerPixels, marginPixels])
    arms.push([outerX, markerY, marginPixels, markerPixels])
    cornerBlocks.push([outerX, outerY, marginPixels, marginPixels])
  }
  // The band lives inside the placement box; this guards the rebuild against a stale report.
  expect(Math.min(...arms.map(arm => arm[0]!))).toBeGreaterThanOrEqual(report.placement.x)
  expect(Math.min(...arms.map(arm => arm[1]!))).toBeGreaterThanOrEqual(report.placement.y)
  return { arms, cornerBlocks }
}

/** Cells the plate paints: the code grid plus the marker arms, the corner blocks when kept light. */
function plateCells(report: AssembleReport, lattice: Lattice): Set<number> {
  const grid = report.qrPlate.box
  const { arms, cornerBlocks } = markerBandRects(report)
  const rects = [[grid.x, grid.y, grid.width, grid.height], ...arms]
  if (report.qrPlate.cornerModules === 0)
    rects.push(...cornerBlocks)
  const cells = new Set<number>()
  for (const [x, y, width, height] of rects)
    for (const cell of rectCells(lattice, x!, y!, width!, height!))
      cells.add(cell)
  return cells
}

/** Cells the texture keeps: the diagonal corner block beside each of the three markers. */
function cornerBlockCells(report: AssembleReport, lattice: Lattice): Set<number> {
  const cells = new Set<number>()
  for (const [x, y, width, height] of markerBandRects(report).cornerBlocks)
    for (const cell of rectCells(lattice, x!, y!, width!, height!))
      cells.add(cell)
  return cells
}

describe('assemble mode', () => {
  it('cuts the texture in whole modules sampled from the region mask', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })

    expect(result.report.schemaVersion).toBe(8)
    expect(result.report.mode).toBe('assemble')
    expect(result.report.status).toBe('generated')
    expect(result.report.qualified).toBe(true)
    expect(result.report.phoneScan).toBe('untested')
    expect((await readdir(outputDir)).sort()).toEqual(ARTIFACTS)

    // The trimmed source/qr.png is accepted and its two-module margin is rebuilt locally.
    expect(result.report.qr.quietZoneSource).toBe('added')
    expect(result.report.qr.sourceTrim).toEqual({ left: 8, top: 5, right: 5, bottom: 3, modulePixels: 20 })
    expect(result.report.qr.version).toBe(5)
    expect(result.report.qr.sourceModulePixels).toBe(20)
    expect(result.report.placement).toMatchObject({ x: 218, y: 181, size: 246, modulePixels: 6, artPaddingModules: 0 })

    // The texture window is phase-locked to the QR lattice: the residual offset is zero, so the
    // matrix cells, the drawn modules and the QR are all on one grid.
    expect(result.report.pattern.version).toBe(24)
    expect(result.report.pattern.modulePixels).toBe(6)
    expect(result.report.pattern.seed).toBe(1)
    expect(result.report.pattern.crop).toEqual({ left: 4, top: 65 })
    expect(result.report.pattern.alignment).toEqual({ alignedToQr: true, phase: { x: 0, y: 0 } })

    // The safe area is the modules the region covers in full; the partial ones keep the artwork.
    expect(result.report.cut).toEqual({
      modulePixels: 6,
      lattice: { x: 2, y: 1 },
      radius: 12,
      safeModules: 3_284,
      droppedPartialModules: 367,
      droppedPartialPixels: 7_273,
      drawnModules: 1_873,
      rim: { modules: 4, style: 'cell' },
      plateCornerModules: 3,
      keep: 'region-mask',
      edgeBlend: 'cell-aligned-over-original',
    })
    // The light band is kept beside the three finder markers only: 42 cells (two 7-cell arms per
    // marker) sit outside the 37x37 code grid, and the three corner blocks go back to the texture.
    expect(result.report.qrPlate).toEqual({
      band: 'markers',
      marginModules: 1,
      marginPixels: 6,
      markerModules: 7,
      bandCells: 42,
      box: { x: 230, y: 193, width: 222, height: 222 },
      holeModules: 1_411,
      cornerModules: 3,
      cornerTexturePixels: 108,
    })
    expect(result.report.qr.overlay).toEqual({
      band: 'markers',
      quietZoneModules: 1,
      markerModules: 7,
      crop: { left: 12, top: 12, size: 222 },
      x: 230,
      y: 193,
    })
    expect(result.report.shape.modules).toBe(1_873)
    expect(result.report.shape.rimModules).toBe(1_029)
    expect(result.report.shape.textureModules).toBe(844)
    expect(result.report.shape.area).toBe(1_873 * 36)
    expect(result.report.shape.bounds).toEqual({ x: 176, y: 109, width: 366, height: 408 })

    expect(result.report.verification.checks.map(check => check.name)).toEqual([
      'sourceQr',
      'normalizedQr',
      'outsideRegionPixels',
      'qrPixels',
      'qrPlateCorners',
      'moduleCut',
      'alphaPreserved',
    ])
    expect(result.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/The light band is kept beside the three finder markers only: 42 cell\(s\)/)
    // The band is whole cells, so nothing warns about a trimmed or pixel-precise plate.
    expect(result.report.warnings.join(' ')).not.toMatch(/trims|pixel precision/)
    expect(result.report.warnings.join(' ')).toMatch(/367 module\(s\) crossed the painted region's edge/)
  }, 120_000)

  it('draws whole modules only, so dropped modules keep the original artwork', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const placement = result.report.placement
    const pitch = placement.modulePixels
    const lattice = buildModuleLattice(width, height, pitch, placement)

    const source = await raw(POSTER)
    const assembled = await raw(join(outputDir, 'poster.png'))
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const mask = await raw(join(outputDir, 'region-mask.png'))

    // The written cut layer is the module grid: every module is either fully opaque or fully clear.
    const drawn = new Uint8Array(lattice.columns * lattice.rows)
    let partialModules = 0
    for (let cell = 0; cell < drawn.length; cell++) {
      const row = Math.floor(cell / lattice.columns)
      const column = cell - row * lattice.columns
      let opaque = 0
      for (let offsetY = 0; offsetY < pitch; offsetY++) {
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const index = ((lattice.y + row * pitch + offsetY) * width) + lattice.x + column * pitch + offsetX
          if (cut.data[index * 4 + 3] === 255)
            opaque++
        }
      }
      if (opaque > 0 && opaque < pitch * pitch)
        partialModules++
      drawn[cell] = opaque === pitch * pitch ? 1 : 0
    }
    expect(partialModules).toBe(0)
    expect(drawn.reduce<number>((total, value) => total + value, 0)).toBe(result.report.cut.drawnModules)

    const safe = safeModules(mask, lattice)
    const plate = plateCells(result.report, lattice)
    let outsideChanged = 0
    let changedOutsideModules = 0
    let changedInDroppedModules = 0
    let alphaChanged = 0
    let transparent = 0
    let replaced = 0
    let drawnOutsideRegion = 0
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column
        const offset = index * 4
        const cell = moduleCellIndex(lattice, column, row)
        const isDrawn = cell >= 0 && drawn[cell] === 1
        // The plate hole is the code grid plus the marker band, not a rectangle.
        const inHole = cell >= 0 && plate.has(cell)
        let changed = false
        for (let channel = 0; channel < 4; channel++) {
          if (assembled.data[offset + channel] !== source.data[offset + channel])
            changed = true
          if (!mask.data[offset] && assembled.data[offset + channel] !== source.data[offset + channel])
            outsideChanged++
        }
        if (changed && !isDrawn && !inHole)
          changedOutsideModules++
        if (changed && cell >= 0 && !drawn[cell] && !inHole)
          changedInDroppedModules++
        if (isDrawn && !safe[cell!])
          drawnOutsideRegion++
        if (assembled.data[offset + 3] !== source.data[offset + 3])
          alphaChanged++
        if (assembled.data[offset + 3] === 0)
          transparent++
        if (mask.data[offset] && isDrawn && assembled.data[offset] !== source.data[offset])
          replaced++
      }
    }
    expect(outsideChanged).toBe(0)
    expect(changedOutsideModules).toBe(0)
    expect(changedInDroppedModules).toBe(0)
    expect(drawnOutsideRegion).toBe(0)
    expect(alphaChanged).toBe(0)
    expect(transparent).toBe(0)
    // The texture really did replace the painted blob inside the drawn modules.
    expect(replaced).toBeGreaterThan(result.report.shape.area / 2)
  }, 120_000)

  it('composites the same whole modules the generator and the matrix describe', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const placement = result.report.placement
    const pitch = placement.modulePixels
    const lattice = buildModuleLattice(width, height, pitch, placement)
    const mask = await raw(join(outputDir, 'region-mask.png'))
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const poster = await raw(join(outputDir, 'poster.png'))
    const safe = safeModules(mask, lattice)
    const rim = computeRimModules(safe, lattice, RIM_MODULES)
    const drawn = new Uint8Array(safe.length)
    for (let cell = 0; cell < drawn.length; cell++)
      drawn[cell] = cut.data[(((Math.floor(cell / lattice.columns) * pitch + lattice.y) * width)
        + lattice.x + (cell % lattice.columns) * pitch) * 4 + 3] === 255 ? 1 : 0

    // Rebuild the texture the report describes: the generator's matrix, rim cells forced dark, and
    // only the drawn modules emitted.
    const pattern = await buildPosterPattern({
      width,
      height,
      modulePixels: pitch,
      seed: result.report.pattern.seed,
      alignTo: { x: placement.x, y: placement.y },
    })
    expect(pattern.crop).toEqual(result.report.pattern.crop)
    const moduleOffsetX = (pattern.crop.left + (placement.x % pitch)) / pitch
    const moduleOffsetY = (pattern.crop.top + (placement.y % pitch)) / pitch
    const effective = pattern.matrix.map(row => row.slice())
    for (let row = 0; row < lattice.rows; row++) {
      for (let column = 0; column < lattice.columns; column++) {
        const cell = row * lattice.columns + column
        if (!drawn[cell] || !rim[cell])
          continue
        const matrixRow = row + moduleOffsetY - pattern.marginModules
        const matrixColumn = column + moduleOffsetX - pattern.marginModules
        if (matrixRow >= 0 && matrixColumn >= 0 && matrixRow < effective.length && matrixColumn < effective.length)
          effective[matrixRow]![matrixColumn] = true
      }
    }
    const rendered = await sharp(await renderRoundedPattern(effective, pitch, {
      marginModules: pattern.marginModules,
      window: { ...pattern.crop, width, height },
      include: (moduleX, moduleY) => {
        const column = moduleX - moduleOffsetX
        const row = moduleY - moduleOffsetY
        return column >= 0 && row >= 0 && column < lattice.columns && row < lattice.rows
          && drawn[row * lattice.columns + column] === 1
      },
    })).ensureAlpha().raw().toBuffer()

    let sampled = 0
    let cutMismatch = 0
    let rimPixels = 0
    let rimDark = 0
    for (let cell = 0; cell < drawn.length; cell++) {
      if (!drawn[cell])
        continue
      const row = Math.floor(cell / lattice.columns)
      const column = cell - row * lattice.columns
      for (let offsetY = 0; offsetY < pitch; offsetY++) {
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const x = lattice.x + column * pitch + offsetX
          const y = lattice.y + row * pitch + offsetY
          const offset = (y * width + x) * 4
          sampled++
          for (let channel = 0; channel < 3; channel++) {
            if (cut.data[offset + channel] !== rendered[offset + channel])
              cutMismatch++
          }
          if (rim[cell]) {
            rimPixels++
            if (poster.data[offset]! < 32 && poster.data[offset + 1]! < 32 && poster.data[offset + 2]! < 32)
              rimDark++
          }
        }
      }
    }
    expect(sampled).toBe(result.report.shape.area)
    expect(cutMismatch).toBe(0)
    // The rim is whole dark modules, so the outline reads as one band of the texture's own cells.
    expect(rimDark / rimPixels).toBeGreaterThan(0.97)
  }, 120_000)

  it('keeps the light band beside the markers and leaves the rest of the code edge to the texture', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width } = result.report.inputs.poster
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, result.report.inputs.poster.height, pitch, result.report.placement)
    const poster = await raw(join(outputDir, 'poster.png'))
    const qr = await raw(join(outputDir, 'qr.png'))
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const plate = plateCells(result.report, lattice)
    const corners = cornerBlockCells(result.report, lattice)
    const grid = result.report.qrPlate.box
    const placement = result.report.placement

    // The QR is copied verbatim at its placement position: the code grid plus the band cells, whose
    // pixels are the QR's own light margin. The corner blocks are the only plate cells left out.
    let platePixels = 0
    let qrMismatch = 0
    for (const cell of plate) {
      const row = Math.floor(cell / lattice.columns)
      const column = cell - row * lattice.columns
      for (let offsetY = 0; offsetY < pitch; offsetY++) {
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const x = lattice.x + column * pitch + offsetX
          const y = lattice.y + row * pitch + offsetY
          const source = ((y - placement.y) * placement.size + x - placement.x) * 4
          platePixels++
          for (let channel = 0; channel < 4; channel++) {
            if (poster.data[(y * width + x) * 4 + channel] !== qr.data[source + channel])
              qrMismatch++
          }
        }
      }
    }
    expect(plate.size).toBe(result.report.qrPlate.holeModules)
    expect(platePixels).toBe(result.report.qrPlate.holeModules * pitch * pitch)
    expect(qrMismatch).toBe(0)

    // The band is exactly the cells beside the markers: every other cell of the code edge is drawn
    // as texture, so the margin there is zero, and the cut has no hole outside the band.
    let bandCells = 0
    let textureEdgeCells = 0
    let edgeMismatch = 0
    for (let row = 0; row < lattice.rows; row++) {
      for (let column = 0; column < lattice.columns; column++) {
        const x = lattice.x + column * pitch
        const y = lattice.y + row * pitch
        const insideGrid = x >= grid.x && y >= grid.y
          && x + pitch <= grid.x + grid.width && y + pitch <= grid.y + grid.height
        const insidePlacement = x >= placement.x && y >= placement.y
          && x + pitch <= placement.x + placement.size && y + pitch <= placement.y + placement.size
        if (insideGrid || !insidePlacement)
          continue
        const cell = row * lattice.columns + column
        const offset = (y * width + x) * 4
        if (plate.has(cell)) {
          bandCells++
          if (cut.data[offset + 3] === 255)
            edgeMismatch++
          continue
        }
        textureEdgeCells++
        // Everything the plate leaves on the code edge carries the texture, corner blocks included.
        if (cut.data[offset + 3] !== 255)
          edgeMismatch++
        for (let channel = 0; channel < 4; channel++) {
          if (poster.data[offset + channel] !== cut.data[offset + channel])
            edgeMismatch++
        }
      }
    }
    expect(edgeMismatch).toBe(0)
    expect(bandCells).toBe(result.report.qrPlate.bandCells)
    expect(bandCells).toBe(42)
    // The three corner blocks are handed back, so they are texture; the rest of the ring is too.
    expect(textureEdgeCells).toBeGreaterThan(100)
    expect(corners.size).toBe(result.report.qrPlate.cornerModules)
    expect(corners.size).toBe(3)
    for (const corner of corners)
      expect(plate.has(corner)).toBe(false)
  }, 120_000)

  it('keeps the marker corner blocks light when the plate radius is zero', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1, radius: 0 })
    expect(result.report.qrPlate).toEqual({
      band: 'markers',
      marginModules: 1,
      marginPixels: 6,
      markerModules: 7,
      bandCells: 45,
      box: { x: 230, y: 193, width: 222, height: 222 },
      holeModules: 1_414,
      cornerModules: 0,
      cornerTexturePixels: 0,
    })
    expect(result.report.cut.plateCornerModules).toBe(0)
    expect(result.report.cut.drawnModules).toBe(3_284 - 1_414)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/plate's 0 corner block module\(s\) handed back/)

    // With no corner handback the band is the full L: the three corner blocks carry the QR's own
    // light margin and are part of the plate, so the cut has no hole there.
    const { width } = result.report.inputs.poster
    const poster = await raw(join(outputDir, 'poster.png'))
    const qr = await raw(join(outputDir, 'qr.png'))
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, result.report.inputs.poster.height, pitch, result.report.placement)
    const corners = cornerBlockCells(result.report, lattice)
    const plate = plateCells(result.report, lattice)
    expect(corners.size).toBe(3 * result.report.qrPlate.marginModules ** 2)
    let mismatch = 0
    for (const cell of plate) {
      const row = Math.floor(cell / lattice.columns)
      const column = cell - row * lattice.columns
      for (let offsetY = 0; offsetY < pitch; offsetY++) {
        for (let offsetX = 0; offsetX < pitch; offsetX++) {
          const x = lattice.x + column * pitch + offsetX
          const y = lattice.y + row * pitch + offsetY
          const offset = (y * width + x) * 4
          const source = ((y - result.report.placement.y) * result.report.placement.size
            + x - result.report.placement.x) * 4
          for (let channel = 0; channel < 4; channel++) {
            if (poster.data[offset + channel] !== qr.data[source + channel])
              mismatch++
          }
          if (cut.data[offset + 3] === 255)
            mismatch++
        }
      }
    }
    expect(mismatch).toBe(0)
    for (const corner of corners)
      expect(plate.has(corner)).toBe(true)
  }, 120_000)

  it('keeps every drawn cell whole even where the code edge loses its margin', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, height, pitch, result.report.placement)
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const poster = await raw(join(outputDir, 'poster.png'))

    // The module-level guarantee: the plate never paints over a drawn cell, so every drawn module in
    // the poster is bit-exact with the cut layer that carries it.
    let drawnCells = 0
    let trimmedCells = 0
    for (let row = 0; row < lattice.rows; row++) {
      for (let column = 0; column < lattice.columns; column++) {
        const x = lattice.x + column * pitch
        const y = lattice.y + row * pitch
        if (x + pitch > width || y + pitch > height)
          continue
        if (cut.data[(y * width + x) * 4 + 3] !== 255)
          continue
        drawnCells++
        for (let offsetY = 0; offsetY < pitch; offsetY++) {
          for (let offsetX = 0; offsetX < pitch; offsetX++) {
            const offset = ((y + offsetY) * width + x + offsetX) * 4
            for (let channel = 0; channel < 3; channel++) {
              if (poster.data[offset + channel] !== cut.data[offset + channel]) {
                trimmedCells++
                offsetX = pitch
                offsetY = pitch
                break
              }
            }
          }
        }
      }
    }
    expect(drawnCells).toBe(result.report.cut.drawnModules)
    expect(trimmedCells).toBe(0)
  }, 120_000)

  it('accepts a two-module band and rejects a fractional or out-of-range margin', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1, qrMargin: 2 })
    // Two modules deep: the arms double and the corner blocks grow with them, so the band is 84
    // cells and 12 whole modules go back to the texture.
    expect(result.report.qrPlate).toEqual({
      band: 'markers',
      marginModules: 2,
      marginPixels: 12,
      markerModules: 7,
      bandCells: 84,
      box: { x: 230, y: 193, width: 222, height: 222 },
      holeModules: 1_453,
      cornerModules: 12,
      cornerTexturePixels: 432,
    })
    expect(result.report.cut.plateCornerModules).toBe(12)
    expect(result.report.cut.drawnModules).toBe(3_284 - 1_453)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/84 cell\(s\) 2 module deep/)

    // The band is a row of whole cells beside each marker, so a fraction is rejected rather than
    // rounded, zero would leave the code grid flush with the texture, and the profile's quiet zone
    // is the cap.
    for (const qrMargin of [0, 0.2, 1.5, 3]) {
      await expect(assemblePoster({
        inputPath: POSTER,
        qrPath: TRIMMED_QR,
        outputDir: await temporaryDirectory(),
        qrMargin,
      })).rejects.toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 })
    }
  }, 120_000)

  it('keeps the marker band decodable at three scales', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    // Local-decoder evidence only: the light band is kept beside the three finder markers and the
    // rest of the code edge sits flush against the texture, so the run still reports the poster
    // decode checks as skipped and phoneScan as untested. Measured: the marker band did not cost the
    // three scales, because the finder patterns are what a decoder locks onto.
    const poster = await sharp(join(outputDir, 'poster.png')).png().toBuffer()
    const { width } = result.report.inputs.poster
    await expect(decodeQrBuffer(poster)).resolves.toBe(result.report.qr.decodedText)
    await expect(decodeQrBuffer(await sharp(poster).resize({ width: width / 2 }).png().toBuffer()))
      .resolves.toBe(result.report.qr.decodedText)
    await expect(decodeQrBuffer(await sharp(poster).jpeg({ quality: 80 }).png().toBuffer()))
      .resolves.toBe(result.report.qr.decodedText)
    expect(result.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(result.report.phoneScan).toBe('untested')
  }, 120_000)

  it('is reproducible for a seed, varies by seed, and protects existing artifacts', async () => {
    const outputDir = await temporaryDirectory()
    const base = { inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 7 }
    const first = await assemblePoster(base)
    await expect(assemblePoster(base)).rejects.toMatchObject({ code: 'OUTPUT_EXISTS', exitCode: 2 })
    const repeated = await assemblePoster({ ...base, force: true })
    expect(repeated.report.artifacts.posterSha256).toBe(first.report.artifacts.posterSha256)
    expect(repeated.report.artifacts.patternCutPngSha256).toBe(first.report.artifacts.patternCutPngSha256)
    const reseeded = await assemblePoster({ ...base, seed: 8, force: true })
    expect(reseeded.report.artifacts.posterSha256).not.toBe(first.report.artifacts.posterSha256)
  }, 120_000)

  it('matches the square fixture QR and rejects unusable cut options', async () => {
    const trimmedDir = await temporaryDirectory()
    const fixtureDir = await temporaryDirectory()
    const trimmed = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir: trimmedDir, seed: 1 })
    const fixture = await assemblePoster({ inputPath: POSTER, qrPath: FIXTURE_QR, outputDir: fixtureDir, seed: 1 })
    expect(fixture.report.qr.quietZoneSource).toBeUndefined()
    expect(fixture.report.artifacts.posterSha256).toBe(trimmed.report.artifacts.posterSha256)

    await expect(assemblePoster({
      inputPath: POSTER,
      qrPath: TRIMMED_QR,
      outputDir: await temporaryDirectory(),
      radius: -1,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 })
    // The cut is module-aligned, so there is no traced outline for --cut-smooth to simplify.
    await expect(assemblePoster({
      inputPath: POSTER,
      qrPath: TRIMMED_QR,
      outputDir: await temporaryDirectory(),
      smoothTolerance: 3,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 })
  }, 120_000)

  it('writes the module path into the cut SVG', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const svg = await import('node:fs/promises').then(fs => fs.readFile(join(outputDir, 'pattern-cut.svg'), 'utf8'))
    expect(svg).toContain('<clipPath id="pattern-cut">')
    expect(svg).toContain('data:image/png;base64,')
    expect(svg).not.toContain('stroke="url')
    // The clip is the same module union the composite used: rebuild it and compare.
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, height, pitch, result.report.placement)
    const drawn = new Uint8Array(lattice.columns * lattice.rows)
    for (let row = 0; row < lattice.rows; row++) {
      for (let column = 0; column < lattice.columns; column++) {
        const x = lattice.x + column * pitch
        const y = lattice.y + row * pitch
        drawn[row * lattice.columns + column] = cut.data[(y * width + x) * 4 + 3] === 255 ? 1 : 0
      }
    }
    const path = buildModulePath(drawn, lattice)
    expect(svg).toContain(`d="${path}"`)
  }, 120_000)

  it('refuses a region with no texture module left after the rim and the plate', async () => {
    const directory = await temporaryDirectory()
    // A square painted region only slightly wider than the QR plate: the maximum placement fits,
    // but the four-module rim and the plate leave nothing to texture, so the run
    // reports the layout instead of drawing a black slab.
    const size = 200
    const region = 180
    const mask = Buffer.alloc(size * size * 4)
    const poster = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4
        poster[offset] = poster[offset + 1] = poster[offset + 2] = 255
        poster[offset + 3] = 255
        const inside = x >= 10 && x < 10 + region && y >= 10 && y < 10 + region
        mask[offset] = mask[offset + 1] = mask[offset + 2] = inside ? 255 : 0
        mask[offset + 3] = 255
      }
    }
    const posterPath = join(directory, 'poster.png')
    const maskPath = join(directory, 'region-mask.png')
    await sharp(poster, { raw: { width: size, height: size, channels: 4 } }).png().toFile(posterPath)
    await sharp(mask, { raw: { width: size, height: size, channels: 4 } }).png().toFile(maskPath)

    await expect(assemblePoster({
      inputPath: posterPath,
      qrPath: FIXTURE_QR,
      maskPath,
      outputDir: join(directory, 'out'),
      seed: 1,
    })).rejects.toMatchObject({ code: 'QR_LAYOUT_INVALID', exitCode: 2 })
  }, 120_000)
})
