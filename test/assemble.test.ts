import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { assemblePoster, buildQrPlatePath, roundedRectArea } from '../src/assemble.js'
import { renderPosterPattern } from '../src/pattern.js'
import {
  buildCutPath,
  cleanMaskSelection,
  renderCutBorderCoverage,
  renderCutCoverage,
} from '../src/pattern-cut.js'
import { decodeQrBuffer } from '../src/qr.js'

const POSTER = resolve('source/poster.png')
const FIXTURE_QR = resolve('test/fixtures/qr.png')
const TRIMMED_QR = resolve('source/qr.png')
const ARTIFACTS = ['pattern-cut.png', 'pattern-cut.svg', 'poster.png', 'qr.png', 'region-mask.png', 'report.json']

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qr-cool-assemble-'))
  temporaryDirectories.push(path)
  return path
}

describe('assemble mode', () => {
  it('assembles texture, filleted cut and exact QR without a network call', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({
      inputPath: POSTER,
      qrPath: TRIMMED_QR,
      outputDir,
      seed: 1,
    })

    expect(result.report.schemaVersion).toBe(6)
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
    expect(result.report.placement).toMatchObject({ x: 249, y: 201, size: 205, modulePixels: 5 })

    expect(result.report.pattern.version).toBe(30)
    expect(result.report.pattern.modulePixels).toBe(5)
    expect(result.report.pattern.seed).toBe(1)
    // The window is nudged under one module so the texture lattice lands on the placed QR's.
    expect(result.report.pattern.crop).toEqual({ left: 9, top: 71 })
    expect(result.report.pattern.alignment).toEqual({ alignedToQr: true, phase: { x: 4, y: 1 } })
    expect(result.report.cut).toEqual({
      radius: 10,
      smoothTolerance: 5,
      cleanRadius: 5,
      border: { width: 20, color: '#000000', side: 'inside' },
      keep: 'region-mask',
      minLoopArea: 100,
      edgeBlend: 'coverage-over-original',
    })
    // The QR keeps one quiet-zone module: the 39-module plate is the code grid plus 5px.
    expect(result.report.qr.overlay).toEqual({
      quietZoneModules: 1,
      crop: { left: 5, top: 5, size: 195 },
      x: 254,
      y: 206,
    })
    // The plate is the same window, rounded by the two-module fillet, and it is the only hole in
    // the cut path: its corners hand 56 window pixels back to the texture.
    expect(result.report.qrPlate).toEqual({
      marginModules: 1,
      radius: 10,
      path: 'rounded-rect',
      box: { x: 254, y: 206, width: 195, height: 195 },
      cornerTexturePixels: 56,
    })
    expect(result.report.shape.loopsKept).toBe(1)
    expect(result.report.shape.holes).toBe(1)
    expect(result.report.shape.bounds).toEqual({ x: 169, y: 104, width: 379, height: 419 })
    // Cleaning plus a two-module fillet turns the traced staircase into a rounded outline.
    expect(result.report.shape.verticesTraced).toBeGreaterThan(1000)
    expect(result.report.shape.verticesSimplified).toBeLessThanOrEqual(60)
    // The net cut area is the region minus the plate: cleaning adds about 1.5% along the outline
    // and the rounded plate takes its window back out.
    expect(result.report.shape.area).toBeGreaterThan(87_000)
    expect(result.report.shape.area).toBeLessThan(92_000)
    const plateArea = roundedRectArea(195, 10)
    expect(Math.abs(result.report.region.area - plateArea - result.report.shape.area) / result.report.region.area).toBeLessThan(0.02)
    expect(result.report.verification.checks.map(check => check.name)).toEqual([
      'sourceQr',
      'normalizedQr',
      'outsideRegionPixels',
      'qrPixels',
      'qrPlateCorners',
      'alphaPreserved',
    ])
    expect(result.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(result.report.warnings.join(' ')).toMatch(/quiet zone was trimmed to 1 module/)
    expect(result.report.warnings.join(' ')).toMatch(/rounding keeps only 56 of the window's corner pixels as texture/)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
  }, 60_000)

  it('keeps every pixel outside the region, the exact QR, and the source alpha channel', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const { x, y, size } = result.report.placement
    const overlay = result.report.qr.overlay
    const plate = result.report.qrPlate
    const overlayX = overlay.x
    const overlayY = overlay.y
    const overlaySize = overlay.crop.size
    const marginInset = overlay.quietZoneModules * result.report.placement.modulePixels
    const codeX = overlayX + marginInset
    const codeY = overlayY + marginInset
    const codeSize = overlaySize - marginInset * 2
    const plateCoverage = await renderCutCoverage(
      buildQrPlatePath(plate.box.x, plate.box.y, plate.box.width, plate.radius),
      width,
      height,
    )

    const source = await sharp(POSTER).ensureAlpha().raw().toBuffer()
    const assembled = await sharp(join(outputDir, 'poster.png')).ensureAlpha().raw().toBuffer()
    const mask = await sharp(join(outputDir, 'region-mask.png')).extractChannel(0).raw().toBuffer()
    const qr = await sharp(join(outputDir, 'qr.png')).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer()
    const pattern = await sharp((await renderPosterPattern({
      width,
      height,
      modulePixels: result.report.placement.modulePixels,
      seed: 1,
      alignTo: { x, y },
    })).png).ensureAlpha().raw().toBuffer()

    let outsideChanged = 0
    let qrMismatch = 0
    let alphaChanged = 0
    let transparent = 0
    let replacedInsideRegion = 0
    let marginDark = 0
    let marginPixels = 0
    let cornerMismatch = 0
    let cornerPixels = 0
    let cutMarginDark = 0
    let cutMarginPixels = 0
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column
        const offset = index * 4
        const insideQr = column >= overlayX && column < overlayX + overlaySize
          && row >= overlayY && row < overlayY + overlaySize
        // Only the fully opaque plate carries the copied QR: its rounded corners must stay texture.
        const insidePlate = plateCoverage[index] === 255
        const insideBox = column >= x && column < x + size && row >= y && row < y + size
        for (let channel = 0; channel < 4; channel++) {
          if (!mask[index] && assembled[offset + channel] !== source[offset + channel])
            outsideChanged++
          if (insidePlate && assembled[offset + channel] !== qr[((row - y) * size + column - x) * 4 + channel])
            qrMismatch++
          if (insideQr && plateCoverage[index] === 0 && assembled[offset + channel] !== pattern[offset + channel])
            cornerMismatch++
        }
        // The one-module light margin around the code grid, and the box ring outside the plate
        // where the dropped quiet-zone module used to be, which is texture now.
        const insideCode = column >= codeX && column < codeX + codeSize
          && row >= codeY && row < codeY + codeSize
        if (insidePlate && !insideCode) {
          marginPixels++
          if (assembled[offset] < 248)
            marginDark++
        }
        if (insideQr && plateCoverage[index] === 0)
          cornerPixels++
        if (insideBox && !insideQr && mask[index]) {
          cutMarginPixels++
          if (assembled[offset] < 128)
            cutMarginDark++
        }
        if (assembled[offset + 3] !== source[offset + 3])
          alphaChanged++
        if (assembled[offset + 3] === 0)
          transparent++
        if (mask[index] && !insideQr && assembled[offset] !== source[offset])
          replacedInsideRegion++
      }
    }
    expect(outsideChanged).toBe(0)
    expect(qrMismatch).toBe(0)
    expect(cornerMismatch).toBe(0)
    expect(alphaChanged).toBe(0)
    expect(transparent).toBe(0)
    // The texture really did replace the painted blob rather than leaving it black.
    expect(replacedInsideRegion).toBeGreaterThan(40_000)
    // The one-module ring inside the plate is the QR's own light margin, not texture: 3,800 window
    // pixels less the 56 the rounding hands back to the texture and the 68 antialiased pixels along
    // the four corner arcs, which are neither fully plate nor fully texture.
    expect(marginPixels).toBe(3_676)
    expect(marginDark).toBe(0)
    // The rounded corners are the only window pixels the plate gives back to the texture.
    expect(cornerPixels).toBe(56)
    // The ring of the placement box outside the plate is the quiet-zone module that was dropped,
    // so the texture runs there instead of a wide white square.
    expect(cutMarginPixels).toBeGreaterThan(3_000)
    expect(cutMarginDark / cutMarginPixels).toBeGreaterThan(0.25)
  }, 60_000)

  it('draws the black border inside the rounded cut edge', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const mask = await sharp(join(outputDir, 'region-mask.png')).extractChannel(0).raw().toBuffer()
    const selection = cleanMaskSelection(
      Uint8Array.from(mask, value => (value ? 1 : 0)),
      width,
      height,
      result.report.cut.cleanRadius,
    )
    const cut = buildCutPath(selection, width, height, {
      radius: result.report.cut.radius,
      smoothTolerance: result.report.cut.smoothTolerance,
    })
    const border = await renderCutBorderCoverage(cut.d, width, height, result.report.cut.border.width)
    const assembled = await sharp(join(outputDir, 'poster.png')).removeAlpha().raw().toBuffer()
    const source = await sharp(POSTER).removeAlpha().raw().toBuffer()

    let solid = 0
    let notBlack = 0
    let paintedOutside = 0
    for (let index = 0; index < border.length; index++) {
      if (border[index] === 255) {
        solid++
        if (mask[index]
          && (assembled[index * 3]! > 32 || assembled[index * 3 + 1]! > 32 || assembled[index * 3 + 2]! > 32))
          notBlack++
      }
      // The band may reach past the mask where the rounded cut does, but the composite never
      // paints it there: those pixels keep the original artwork.
      if (border[index]! > 0 && !mask[index]) {
        for (let channel = 0; channel < 3; channel++) {
          if (assembled[index * 3 + channel] !== source[index * 3 + channel])
            paintedOutside++
        }
      }
    }
    // The band is a real four-module (20px) ring, every pixel of it inside the painted region is
    // black, and none of it is painted outside that region, so the outside-region guarantee holds.
    expect(solid).toBeGreaterThan(20_000)
    expect(notBlack).toBe(0)
    expect(paintedOutside).toBe(0)

    // Clipping the band to the region trims the outermost pixel or two where the rounded cut runs
    // just outside the detected mask, so the border reads as a continuous rim on the mask edge.
    let boundary = 0
    let boundaryDark = 0
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x
        if (!mask[index])
          continue
        const onBoundary = !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width]
        if (!onBoundary)
          continue
        boundary++
        if (assembled[index * 3]! < 40)
          boundaryDark++
      }
    }
    expect(boundary).toBeGreaterThan(1_500)
    expect(boundaryDark / boundary).toBeGreaterThan(0.7)
  }, 120_000)

  it('composites the same cut texture the pattern-cut mode would produce', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    const { width, height } = result.report.inputs.poster
    const mask = await sharp(join(outputDir, 'region-mask.png')).extractChannel(0).raw().toBuffer()
    const selected = Uint8Array.from(mask, value => (value ? 1 : 0))
    // Rebuild the composited geometry, then sample only where neither the antialiased cut edge nor
    // the black border paints and the rounded plate leaves the texture, so the comparison covers
    // the texture itself.
    const cutEdge = buildCutPath(
      cleanMaskSelection(selected, width, height, result.report.cut.cleanRadius),
      width,
      height,
      { radius: result.report.cut.radius, smoothTolerance: result.report.cut.smoothTolerance },
    )
    const plate = result.report.qrPlate
    const platePath = buildQrPlatePath(plate.box.x, plate.box.y, plate.box.width, plate.radius)
    const coverage = await renderCutCoverage(cutEdge.d + platePath, width, height)
    const plateCoverage = await renderCutCoverage(platePath, width, height)
    const borderCoverage = await renderCutBorderCoverage(
      cutEdge.d,
      width,
      height,
      result.report.cut.border.width,
    )

    const pattern = await renderPosterPattern({
      width,
      height,
      modulePixels: 5,
      seed: 1,
      alignTo: { x: result.report.placement.x, y: result.report.placement.y },
    })
    expect(pattern.crop).toEqual(result.report.pattern.crop)
    const source = await sharp(pattern.png).removeAlpha().raw().toBuffer()
    const cut = await sharp(join(outputDir, 'pattern-cut.png')).ensureAlpha().raw().toBuffer()

    let sampled = 0
    let mismatches = 0
    for (let index = 0; index < selected.length; index++) {
      if (coverage[index] !== 255 || borderCoverage[index] !== 0)
        continue
      const offset = index * 4
      sampled++
      if (cut[offset + 3] !== 255) {
        mismatches++
        continue
      }
      for (let channel = 0; channel < 3; channel++) {
        if (cut[offset + channel] !== source[index * 3 + channel])
          mismatches++
      }
    }
    expect(sampled).toBeGreaterThan(10_000)
    expect(mismatches).toBe(0)

    // The plate is a hole in the written cut layer: transparent inside the plate, texture in the
    // corners the rounding gives back.
    let plateOpaque = 0
    let cornerTransparent = 0
    for (let row = plate.box.y; row < plate.box.y + plate.box.height; row++) {
      for (let column = plate.box.x; column < plate.box.x + plate.box.width; column++) {
        const index = row * width + column
        if (plateCoverage[index] === 255) {
          if (cut[index * 4 + 3] !== 0)
            plateOpaque++
        }
        else if (plateCoverage[index] === 0 && cut[index * 4 + 3] !== 255) {
          cornerTransparent++
        }
      }
    }
    expect(cornerTransparent).toBe(0)
    expect(plateOpaque).toBe(0)

    // Nothing outside the painted region survives into the written cut layer.
    let coveredOutside = 0
    for (let index = 0; index < selected.length; index++) {
      if (!selected[index] && cut[index * 4 + 3] !== 0)
        coveredOutside++
    }
    expect(coveredOutside).toBe(0)
  }, 60_000)

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

  it('writes the square window back when the plate radius is zero', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1, radius: 0 })
    // A zero fillet clamps the plate to a plain rectangle, so no window pixel is handed back to
    // the texture and the straight cut the rounding replaced is reproduced.
    expect(result.report.qrPlate).toMatchObject({
      marginModules: 1,
      radius: 0,
      path: 'rounded-rect',
      box: { x: 254, y: 206, width: 195, height: 195 },
      cornerTexturePixels: 0,
    })
    expect(result.report.shape.holes).toBe(1)
    expect(result.report.shape.area).toBeGreaterThan(89_000)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)
    expect(result.report.warnings.join(' ')).toMatch(/rounding keeps only 0 of the window's corner pixels as texture/)
  }, 60_000)

  it('keeps the rounded plate decodable at three scales', async () => {
    const outputDir = await temporaryDirectory()
    const result = await assemblePoster({ inputPath: POSTER, qrPath: TRIMMED_QR, outputDir, seed: 1 })
    // Local-decoder evidence only: the plate trims the quiet zone to one module and rounds its
    // corners, so the run still reports the poster decode checks as skipped and phoneScan as
    // untested. This asserts the rounding did not cost the three scales the square window kept.
    const poster = await sharp(join(outputDir, 'poster.png')).png().toBuffer()
    const { width } = result.report.inputs.poster
    await expect(decodeQrBuffer(poster)).resolves.toBe(result.report.qr.decodedText)
    await expect(decodeQrBuffer(await sharp(poster).resize({ width: width / 2 }).png().toBuffer()))
      .resolves.toBe(result.report.qr.decodedText)
    await expect(decodeQrBuffer(await sharp(poster).jpeg({ quality: 80 }).png().toBuffer()))
      .resolves.toBe(result.report.qr.decodedText)
    expect(result.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(result.report.phoneScan).toBe('untested')
  }, 60_000)

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
    await expect(assemblePoster({
      inputPath: POSTER,
      qrPath: TRIMMED_QR,
      outputDir: await temporaryDirectory(),
      smoothTolerance: Number.NaN,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 })
  }, 60_000)
})
