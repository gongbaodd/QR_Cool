import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { assemblePoster } from '../src/assemble.js'
import { buildModuleLattice, buildModulePath, computeRimModules, moduleCellIndex } from '../src/module-cut.js'
import { buildPosterPattern, renderRoundedPattern } from '../src/pattern.js'
import { decodeQrBuffer } from '../src/qr.js'

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

describe('assemble mode', () => {
  it('cuts the texture in whole modules sampled from the region mask', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })

    expect(result.report.schemaVersion).toBe(7)
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
      drawnModules: 1_767,
      rim: { modules: 4, style: 'cell' },
      plateCornerModules: 4,
      keep: 'region-mask',
      edgeBlend: 'cell-aligned-over-original',
    })
    // The plate keeps one whole light module, so its window sits on the lattice and the cut's hole
    // is whole modules: the 39x39 window minus its four corner modules, which stay texture.
    expect(result.report.qrPlate).toEqual({
      marginModules: 1,
      marginPixels: 6,
      cornerModules: 1,
      path: 'module-window',
      box: { x: 224, y: 187, width: 234, height: 234 },
      holeModules: 1_517,
      cornerTexturePixels: 144,
    })
    expect(result.report.qr.overlay).toEqual({
      quietZoneModules: 1,
      crop: { left: 6, top: 6, size: 234 },
      x: 224,
      y: 187,
    })
    expect(result.report.shape.modules).toBe(1_767)
    expect(result.report.shape.rimModules).toBe(1_008)
    expect(result.report.shape.textureModules).toBe(759)
    expect(result.report.shape.area).toBe(1_767 * 36)
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
    expect(result.report.warnings.join(' ')).toMatch(/The QR quiet zone is 6px \(1 module\)/)
    // A whole-module margin is module-level everywhere, so nothing warns about a trimmed cell.
    expect(result.report.warnings.join(' ')).not.toMatch(/trims/)
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
        const inHole = cell >= 0 && result.report.qrPlate.box.x <= column
          && column < result.report.qrPlate.box.x + result.report.qrPlate.box.width
          && result.report.qrPlate.box.y <= row
          && row < result.report.qrPlate.box.y + result.report.qrPlate.box.height
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

  it('copies the QR into the plate window and hands the corner modules to the texture', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width } = result.report.inputs.poster
    const plate = result.report.qrPlate
    const overlay = result.report.qr.overlay
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, result.report.inputs.poster.height, pitch, result.report.placement)
    const poster = await raw(join(outputDir, 'poster.png'))
    const qr = await raw(join(outputDir, 'qr.png'))
    const cut = await raw(join(outputDir, 'pattern-cut.png'))

    let qrPixels = 0
    let qrMismatch = 0
    let cornerPixels = 0
    let cornerMismatch = 0
    let drawnInsideWindow = 0
    // The handed-back corner modules are the ones holding the window's corner pixels.
    const cornerCells = new Set<number>()
    if (plate.cornerModules > 0) {
      for (const [x, y] of [
        [plate.box.x, plate.box.y],
        [plate.box.x + plate.box.width - 1, plate.box.y],
        [plate.box.x, plate.box.y + plate.box.height - 1],
        [plate.box.x + plate.box.width - 1, plate.box.y + plate.box.height - 1],
      ])
        cornerCells.add(moduleCellIndex(lattice, x!, y!))
    }
    for (let row = plate.box.y; row < plate.box.y + plate.box.height; row++) {
      for (let column = plate.box.x; column < plate.box.x + plate.box.width; column++) {
        const offset = (row * width + column) * 4
        const cell = moduleCellIndex(lattice, column, row)
        const corner = cornerCells.has(cell)
        if (corner) {
          cornerPixels++
          // The corner module's in-window pixels are texture the cut wrote, not the QR's margin.
          if (cut.data[offset + 3] !== 255)
            cornerMismatch++
          for (let channel = 0; channel < 3; channel++) {
            if (poster.data[offset + channel] !== cut.data[offset + channel])
              cornerMismatch++
          }
          continue
        }
        qrPixels++
        const source = ((row - plate.box.y + overlay.crop.left) * result.report.placement.size
          + column - plate.box.x + overlay.crop.top) * 4
        for (let channel = 0; channel < 4; channel++) {
          if (poster.data[offset + channel] !== qr.data[source + channel])
            qrMismatch++
        }
      }
    }
    // The corner modules are the only window pixels that are not the QR's own margin.
    expect(qrPixels + cornerPixels).toBe(plate.box.width * plate.box.height)
    expect(qrMismatch).toBe(0)
    expect(cornerPixels).toBe(plate.cornerTexturePixels)
    expect(cornerMismatch).toBe(0)

    // The window is lattice-aligned at a whole-module margin: its 39x39 modules are the cut's hole
    // plus the corner modules handed back, and only those corners carry texture.
    let insideModules = 0
    for (let row = 0; row < lattice.rows; row++) {
      for (let column = 0; column < lattice.columns; column++) {
        const x = lattice.x + column * pitch
        const y = lattice.y + row * pitch
        if (x < plate.box.x || y < plate.box.y
          || x + pitch > plate.box.x + plate.box.width || y + pitch > plate.box.y + plate.box.height)
          continue
        insideModules++
        if (cut.data[(y * width + x) * 4 + 3] === 255)
          drawnInsideWindow++
      }
    }
    expect(insideModules).toBe(plate.holeModules + result.report.cut.plateCornerModules)
    expect(drawnInsideWindow).toBe(result.report.cut.plateCornerModules)
  }, 120_000)

  it('writes the square window back when the plate radius is zero', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1, radius: 0 })
    expect(result.report.qrPlate).toEqual({
      marginModules: 1,
      marginPixels: 6,
      cornerModules: 0,
      path: 'module-window',
      box: { x: 224, y: 187, width: 234, height: 234 },
      holeModules: 1_521,
      cornerTexturePixels: 0,
    })
    expect(result.report.cut.plateCornerModules).toBe(0)
    expect(result.report.cut.drawnModules).toBe(3_284 - 1_521)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/plate's 0 corner module\(s\) are handed back/)

    // With no corner handback the plain 39x39-module window carries the QR's own margin.
    const { width } = result.report.inputs.poster
    const poster = await raw(join(outputDir, 'poster.png'))
    const qr = await raw(join(outputDir, 'qr.png'))
    const box = result.report.qrPlate.box
    let mismatch = 0
    for (let row = box.y; row < box.y + box.height; row++) {
      for (let column = box.x; column < box.x + box.width; column++) {
        const source = ((row - box.y + 6) * result.report.placement.size + column - box.x + 6) * 4
        for (let channel = 0; channel < 4; channel++) {
          if (poster.data[(row * width + column) * 4 + channel] !== qr.data[source + channel])
            mismatch++
        }
      }
    }
    expect(mismatch).toBe(0)
  }, 120_000)

  it('keeps every drawn cell whole when the margin is a whole module', async () => {
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

  it('paints a fractional margin at pixel precision and says what it costs', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({
      inputPath: POSTER,
      qrPath: TRIMMED_QR,
      outputDir,
      seed: 1,
      qrMargin: 0.2,
    })
    // The tight look: a 1px band around the code, which needs a pixel-precise plate window and
    // therefore trims the cells along the plate edge. The report warns about both halves of that.
    expect(result.report.qrPlate).toEqual({
      marginModules: 0.2,
      marginPixels: 1,
      cornerModules: 1,
      path: 'pixel-window',
      box: { x: 229, y: 192, width: 224, height: 224 },
      holeModules: 1_369,
      cornerTexturePixels: 4,
    })
    expect(result.report.cut.drawnModules).toBe(1_915)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/trims 1px off every texture cell along its edge/)

    // Only the cells bordering the plate lose their inner pixel; everything else stays whole.
    const { width, height } = result.report.inputs.poster
    const pitch = result.report.placement.modulePixels
    const lattice = buildModuleLattice(width, height, pitch, result.report.placement)
    const cut = await raw(join(outputDir, 'pattern-cut.png'))
    const poster = await raw(join(outputDir, 'poster.png'))
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
        let trimmed = false
        for (let offsetY = 0; offsetY < pitch && !trimmed; offsetY++) {
          for (let offsetX = 0; offsetX < pitch; offsetX++) {
            const offset = ((y + offsetY) * width + x + offsetX) * 4
            for (let channel = 0; channel < 3; channel++) {
              if (poster.data[offset + channel] !== cut.data[offset + channel]) {
                trimmed = true
                break
              }
            }
            if (trimmed)
              break
          }
        }
        if (trimmed)
          trimmedCells++
      }
    }
    expect(drawnCells).toBe(1_915)
    // The cells that touch the pixel-tight window lose exactly the pixel the plate paints.
    expect(trimmedCells).toBeGreaterThan(0)
  }, 120_000)

  it('keeps the module cut decodable at three scales', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    // Local-decoder evidence only: the plate trims the quiet zone to one module and its corner
    // modules go to the texture, so the run still reports the poster decode checks as skipped and
    // phoneScan as untested. This asserts the module cut did not cost the three scales.
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
