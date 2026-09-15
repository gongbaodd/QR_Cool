import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { renderRegionMask } from './artifacts.js'
import { QrPosterError } from './errors.js'
import { decodePng, rgbaToPng } from './image.js'
import { resolveLayout } from './layout.js'
import {
  buildModuleLattice,
  buildModulePath,
  computePlateModules,
  computeRimModules,
  computeSafeArea,
  moduleCellIndex,
  renderModuleCoverage,
} from './module-cut.js'
import type { ModuleWindow } from './module-cut.js'
import {
  PATTERN_ALPHABET,
  PATTERN_ECC,
  PATTERN_MARKER_REFILL,
  PATTERN_PIXEL_STYLE,
  PATTERN_QUIET_ZONE_MODULES,
  buildPosterPattern,
  renderRoundedPattern,
} from './pattern.js'
import { buildCutSvg } from './pattern-cut.js'
import { verifyQrVariant } from './qr.js'
import type { AssemblePosterOptions, AssembleReport, AssembleResult, VerificationCheck } from './types.js'

/** Quiet-zone modules the QR input profile carries; the overlay keeps one of them as a light margin. */
const QUIET_ZONE_MODULES = PATTERN_QUIET_ZONE_MODULES
/**
 * Light margin kept around the code grid, in modules. A whole module keeps the plate on the lattice,
 * so every drawn cell stays whole; a fraction is painted at pixel precision, which trims that many
 * pixels off each texture cell along the plate edge. The band cannot be smaller than one cell and
 * still be module-level, because it is a row of whole cells.
 */
const OVERLAY_MARGIN_MODULES = 1
/** Module margins below this are tighter than the local decoder tolerates at half scale. */
const NARROW_MARGIN_PIXELS = 2
/** Outer rings of drawn modules forced dark, the module-level version of the old 20px border. */
const RIM_MODULES = 4 as const
/** A requested `--cut-radius` below this keeps the plate window square; any larger value rounds it. */
const PLATE_CORNER_EPSILON = 0.01
const SKIPPED_DECODE_CHECKS = ['poster', 'posterHalfScale', 'posterJpeg80'] as const
const REMOVED_TYPES = ['Position', 'Alignment'] as const
const ARTIFACT_NAMES = {
  poster: 'poster.png',
  regionMask: 'region-mask.png',
  qr: 'qr.png',
  patternCutPng: 'pattern-cut.png',
  patternCutSvg: 'pattern-cut.svg',
  report: 'report.json',
} as const

/**
 * Assembles the finished poster offline in whole modules: the generator's marker-free matrix is
 * sampled against the painted region on the placed QR's own lattice, only modules that sit entirely
 * inside the region are drawn, and the QR plate is cut out as a hole on that same lattice. Pixels
 * outside the region, pixels in modules the region only partly covers, and the whole alpha channel
 * are preserved, so nothing is ever punched transparent and no drawn edge crosses a module.
 */
export async function assemblePoster(options: AssemblePosterOptions): Promise<AssembleResult> {
  try {
    return await assemblePosterImpl(options)
  }
  catch (error) {
    if (error instanceof QrPosterError)
      throw error
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      error instanceof Error ? error.message : 'Image processing failed.',
      3,
      { cause: error },
    )
  }
}

async function assemblePosterImpl(options: AssemblePosterOptions): Promise<AssembleResult> {
  const startedAt = Date.now()
  if (options.radius !== undefined && (!Number.isFinite(options.radius) || options.radius < 0))
    throw new QrPosterError('INVALID_INPUT', '--cut-radius must be zero or a positive number.')
  if (options.qrMargin !== undefined && (!Number.isFinite(options.qrMargin) || options.qrMargin <= 0)) {
    throw new QrPosterError(
      'INVALID_INPUT',
      '--qr-margin must be a positive number of modules. Zero removes the code\'s quiet zone, which '
      + 'stops the local decoder at every scale; the tightest usable margins are 0.2 module (1px, '
      + 'painted at pixel precision) and 1 module (the smallest module-level margin).',
    )
  }
  if (options.smoothTolerance !== undefined) {
    throw new QrPosterError(
      'INVALID_INPUT',
      '--cut-smooth is not used by --assemble: the assembled cut draws whole modules, so there is no '
      + 'traced outline to simplify. Use --pattern-cut for a filleted cut.',
    )
  }

  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const { poster, qrSource, maskInput, regionMask, decoded, qrMetadata, placement, normalizedQr }
    = await resolveLayout(options)
  const { width, height } = poster
  const pitch = placement.modulePixels

  // The module lattice is the placed QR's own lattice, so the texture's cells, the rim, and the
  // plate hole all share one grid and no drawn edge can slice a cell.
  const lattice = buildModuleLattice(width, height, pitch, placement)
  const selection = Uint8Array.from(regionMask.data, value => (value ? 1 : 0))
  const safeArea = computeSafeArea(selection, width, height, lattice)

  const marginModules = options.qrMargin ?? OVERLAY_MARGIN_MODULES
  const marginPixels = Math.max(1, Math.round(marginModules * pitch))
  // A whole-module margin leaves the plate on the lattice, so the plate covers whole cells and every
  // drawn cell stays intact. A fractional margin paints the plate at pixel precision instead.
  const plateOnLattice = Number.isInteger(marginModules)
  const overlayInset = QUIET_ZONE_MODULES * pitch - marginPixels
  const overlayX = placement.x + overlayInset
  const overlayY = placement.y + overlayInset
  const overlaySize = placement.size - overlayInset * 2
  const plateWindow: ModuleWindow = { x: overlayX, y: overlayY, size: overlaySize }
  const radius = options.radius ?? 2 * pitch
  const plateCornerModules = radius < PLATE_CORNER_EPSILON ? 0 : 1
  const plate = computePlateModules(lattice, plateWindow, plateCornerModules)

  const drawn = new Uint8Array(lattice.columns * lattice.rows)
  let drawnModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!safeArea.safe[index] || plate.cells[index])
      continue
    drawn[index] = 1
    drawnModules++
  }
  const rim = computeRimModules(safeArea.safe, lattice, RIM_MODULES)
  let rimModules = 0
  let textureModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!drawn[index])
      continue
    if (rim[index])
      rimModules++
    else
      textureModules++
  }
  if (textureModules === 0) {
    throw new QrPosterError(
      'QR_LAYOUT_INVALID',
      `The painted region leaves no texture module once the ${RIM_MODULES}-module rim and the QR plate `
      + 'are removed. Use a larger region, a smaller QR box, or a manual --qr-box.',
    )
  }

  // The generator's matrix is the source of the field; the rim cells are forced dark in a copy and
  // the dropped modules are excluded from the render, so every drawn cell is a whole module.
  const pattern = await buildPosterPattern({
    width,
    height,
    modulePixels: pitch,
    alignTo: { x: placement.x, y: placement.y },
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  })
  const phaseX = (pattern.crop.left + placement.x) % pitch
  const phaseY = (pattern.crop.top + placement.y) % pitch
  if (phaseX !== 0 || phaseY !== 0) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `The texture window at ${pattern.crop.left},${pattern.crop.top} is not phase-locked to the ${pitch}px `
      + `QR lattice (residual ${phaseX},${phaseY}); whole-module drawing needs both on one grid.`,
      3,
    )
  }
  const moduleOffsetX = (pattern.crop.left + (placement.x % pitch)) / pitch
  const moduleOffsetY = (pattern.crop.top + (placement.y % pitch)) / pitch
  const matrixOffsetX = moduleOffsetX - pattern.marginModules
  const matrixOffsetY = moduleOffsetY - pattern.marginModules
  const effective = pattern.matrix.map(row => row.slice())
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      const index = row * lattice.columns + column
      if (!drawn[index])
        continue
      const matrixRow = row + matrixOffsetY
      const matrixColumn = column + matrixOffsetX
      if (matrixRow < 0 || matrixColumn < 0 || matrixRow >= effective.length || matrixColumn >= effective.length)
        continue
      if (rim[index])
        effective[matrixRow]![matrixColumn] = true
    }
  }
  const include = (moduleX: number, moduleY: number): boolean => {
    const column = moduleX - moduleOffsetX
    const row = moduleY - moduleOffsetY
    if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows)
      return false
    return drawn[row * lattice.columns + column] === 1
  }
  const texturePng = await renderRoundedPattern(effective, pitch, {
    marginModules: pattern.marginModules,
    window: { ...pattern.crop, width, height },
    include,
  })
  const render = await decodePng(texturePng, 'pattern.png', 'rendered pattern')

  // The written cut layer is the composited geometry: whole drawn modules carry the texture, and
  // everything else — the artwork along the silhouette, the plate hole — is transparent.
  const unitPath = buildModulePath(drawn, lattice)
  const coverage = await renderModuleCoverage(unitPath, width, height)
  const cutLayer = new Uint8Array(width * height * 4)
  for (let index = 0; index < coverage.length; index++) {
    if (coverage[index] === 0)
      continue
    const offset = index * 4
    cutLayer[offset] = render.data[offset]!
    cutLayer[offset + 1] = render.data[offset + 1]!
    cutLayer[offset + 2] = render.data[offset + 2]!
    cutLayer[offset + 3] = 255
  }
  const cutPng = await rgbaToPng(cutLayer, width, height)
  const cutSvg = buildCutSvg(unitPath, width, height, texturePng)

  // The QR keeps a fraction of a quiet-zone module and drops the rest: the window (code grid plus
  // `marginPixels`) is copied verbatim, corner modules excepted, over the texture the ring modules
  // drew underneath. A margin that tight is below what the local decoder tolerates at half scale,
  // so the poster stays unverified and the report warns about it.
  const qrRaw = await sharp(normalizedQr)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const output = Uint8Array.from(poster.data)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const cell = moduleCellIndex(lattice, column, row)
      const inWindow = column >= overlayX && column < overlayX + overlaySize
        && row >= overlayY && row < overlayY + overlaySize
      // The plate is the window at pixel precision; the corner modules stay texture.
      if (inWindow && !(cell >= 0 && plate.corners[cell])) {
        const source = ((row - overlayY + overlayInset) * placement.size + column - overlayX + overlayInset) * 4
        for (let channel = 0; channel < 4; channel++)
          output[offset + channel] = qrRaw[source + channel]!
        continue
      }
      if (coverage[index] === 0)
        continue
      for (let channel = 0; channel < 3; channel++)
        output[offset + channel] = render.data[offset + channel]!
    }
  }

  let outsidePassed = true
  let qrPassed = true
  let plateCornersPassed = true
  let moduleCutPassed = true
  let alphaPassed = true
  let cornerTexturePixels = 0
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const cell = moduleCellIndex(lattice, column, row)
      const isCorner = cell >= 0 && plate.corners[cell] === 1
      const isDrawn = cell >= 0 && drawn[cell] === 1
      const inWindow = column >= overlayX && column < overlayX + overlaySize
        && row >= overlayY && row < overlayY + overlaySize
      const insidePlate = inWindow && !isCorner
      const insideCorner = inWindow && isCorner
      if (insideCorner)
        cornerTexturePixels++
      let changed = false
      for (let channel = 0; channel < 4; channel++) {
        const value = output[offset + channel]!
        if (value !== poster.data[offset + channel]!)
          changed = true
        if (!regionMask.data[index] && value !== poster.data[offset + channel]!)
          outsidePassed = false
        if (insidePlate
          && value !== qrRaw[((row - overlayY + overlayInset) * placement.size + column - overlayX + overlayInset) * 4 + channel]!)
          qrPassed = false
        if (insideCorner && value !== render.data[offset + channel]!)
          plateCornersPassed = false
      }
      // Whole modules or nothing: a pixel can only differ from the original inside a drawn module.
      // The plate hole is the one region the cut hands over wholesale to the QR.
      if (changed && !isDrawn && !insidePlate)
        moduleCutPassed = false
      if (output[offset + 3] !== poster.data[offset + 3]!)
        alphaPassed = false
    }
  }

  const assembled = await rgbaToPng(output, width, height)

  // The quiet zone is trimmed to one module, so the assembled poster is deliberately not
  // decode-verified; only the QR input, the geometry, and the untouched alpha channel are checked.
  // phoneScan stays untested.
  const checks: VerificationCheck[] = [
    {
      name: 'sourceQr',
      passed: true,
      decodedText: decoded.text,
      decoder: decoded.decoder,
      ...(decoded.version !== undefined ? { version: decoded.version } : {}),
    },
    await verifyQrVariant('normalizedQr', normalizedQr, decoded.text),
    { name: 'outsideRegionPixels', passed: outsidePassed },
    { name: 'qrPixels', passed: qrPassed },
    { name: 'qrPlateCorners', passed: plateCornersPassed },
    { name: 'moduleCut', passed: moduleCutPassed },
    { name: 'alphaPreserved', passed: alphaPassed },
  ]
  const qualified = checks.every(check => check.passed)

  const warnings: string[] = []
  warnings.push(
    `The QR quiet zone is ${marginPixels}px (${formatNumber(marginModules)} module) in the composited plate `
    + `against the profile's ${QUIET_ZONE_MODULES}, and the plate's ${plate.cornerModules} corner module(s) `
    + 'are handed back to the texture, so the assembled poster is not decode-verified; only the QR input '
    + 'and the geometry checks ran.',
  )
  if (marginPixels < NARROW_MARGIN_PIXELS) {
    warnings.push(
      `The ${marginPixels}px margin (${formatNumber(marginModules)} module at ${pitch}px modules) is tighter than `
      + 'the local decoder tolerates at half scale: the bundled poster decodes at full size and JPEG-80, not '
      + `at 50%. Raise --qr-margin so the plate keeps at least ${NARROW_MARGIN_PIXELS}px `
      + `(${formatNumber(NARROW_MARGIN_PIXELS / pitch)} module at ${pitch}px modules) for all three.`,
    )
  }
  if (!plateOnLattice) {
    warnings.push(
      `The plate margin is ${formatNumber(marginModules)} module, which is not a whole cell, so the plate is `
      + `painted at pixel precision and trims ${marginPixels}px off every texture cell along its edge. Use a `
      + 'whole-module --qr-margin to keep the cut module-level everywhere.',
    )
  }
  if (safeArea.partialModules > 0) {
    warnings.push(
      `${safeArea.partialModules} module(s) crossed the painted region's edge and kept the original `
      + `artwork (${safeArea.droppedPartialPixels} region pixels); the cut draws whole modules only.`,
    )
  }
  if (pitch < 6)
    warnings.push(`The normalized QR uses ${pitch}px modules; 6px or larger is preferred.`)
  for (const check of checks) {
    if (!check.passed)
      warnings.push(`${check.name} verification failed${check.error ? `: ${check.error}` : '.'}`)
  }

  const regionMaskPng = await renderRegionMask(regionMask)
  await Promise.all([
    writeFile(join(outputDir, ARTIFACT_NAMES.poster), assembled),
    writeFile(join(outputDir, ARTIFACT_NAMES.regionMask), regionMaskPng),
    writeFile(join(outputDir, ARTIFACT_NAMES.qr), normalizedQr),
    writeFile(join(outputDir, ARTIFACT_NAMES.patternCutPng), cutPng),
    writeFile(join(outputDir, ARTIFACT_NAMES.patternCutSvg), cutSvg, 'utf8'),
  ])

  const report: AssembleReport = {
    schemaVersion: 7,
    mode: 'assemble',
    status: qualified ? 'generated' : 'verification_failed',
    qualified,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      poster: {
        path: normalizedPath(options.inputPath),
        sha256: poster.sha256,
        width: poster.width,
        height: poster.height,
      },
      qr: {
        path: qrSource.path === '<generated>' ? qrSource.path : normalizedPath(qrSource.path),
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(maskInput ? { mask: { path: normalizedPath(options.maskPath!), sha256: maskInput.sha256 } } : {}),
    },
    region: {
      source: regionMask.source,
      area: regionMask.area,
      bounds: regionMask.bounds,
      centroid: regionMask.centroid,
      ...(regionMask.detection ? { detection: regionMask.detection } : {}),
    },
    qr: {
      ...qrMetadata,
      normalizedSize: placement.size,
      normalizedModulePixels: pitch,
      overlay: {
        quietZoneModules: marginModules,
        crop: { left: overlayInset, top: overlayInset, size: overlaySize },
        x: overlayX,
        y: overlayY,
      },
    },
    placement,
    pattern: {
      seed: pattern.seed,
      alphabet: PATTERN_ALPHABET,
      textLength: pattern.text.length,
      textSha256: sha256(pattern.text),
      ecc: PATTERN_ECC,
      version: pattern.version,
      qrModules: pattern.qrModules,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules: pattern.totalModules,
      modulePixels: pitch,
      pixelStyle: PATTERN_PIXEL_STYLE,
      alignment: { alignedToQr: true, phase: { x: phaseX, y: phaseY } },
      removedTypes: [...REMOVED_TYPES],
      markerRefill: PATTERN_MARKER_REFILL,
      refilledModules: pattern.refilledModules,
      codeSize: pattern.codeSize,
      canvas: { width, height },
      crop: pattern.crop,
    },
    cut: {
      modulePixels: pitch,
      lattice: { x: lattice.x, y: lattice.y },
      radius,
      safeModules: safeArea.safeModules,
      droppedPartialModules: safeArea.partialModules,
      droppedPartialPixels: safeArea.droppedPartialPixels,
      drawnModules,
      rim: { modules: RIM_MODULES, style: 'cell' },
      plateCornerModules: plate.cornerModules,
      keep: 'region-mask',
      edgeBlend: 'cell-aligned-over-original',
    },
    qrPlate: {
      marginModules,
      marginPixels,
      cornerModules: plate.cornerModules > 0 ? 1 : 0,
      path: plateOnLattice ? 'module-window' : 'pixel-window',
      box: plate.box,
      holeModules: plate.holeModules,
      cornerTexturePixels,
    },
    shape: {
      bounds: safeArea.bounds,
      area: drawnModules * pitch * pitch,
      modules: drawnModules,
      rimModules,
      textureModules,
    },
    artifacts: {
      poster: ARTIFACT_NAMES.poster,
      posterSha256: sha256(assembled),
      regionMask: ARTIFACT_NAMES.regionMask,
      qr: ARTIFACT_NAMES.qr,
      qrSha256: sha256(normalizedQr),
      patternCutPng: ARTIFACT_NAMES.patternCutPng,
      patternCutPngSha256: sha256(cutPng),
      patternCutSvg: ARTIFACT_NAMES.patternCutSvg,
      patternCutSvgSha256: sha256(cutSvg),
    },
    verification: { expectedText: decoded.text, checks, qualified, skippedChecks: [...SKIPPED_DECODE_CHECKS] },
    phoneScan: 'untested',
    warnings,
  }
  await writeFile(join(outputDir, ARTIFACT_NAMES.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, outputDir }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function normalizedPath(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
}

async function ensureOutputsAvailable(outputDir: string, force: boolean): Promise<void> {
  if (force)
    return
  const collisions: string[] = []
  for (const name of Object.values(ARTIFACT_NAMES)) {
    try {
      await access(join(outputDir, name))
      collisions.push(name)
    }
    catch {
      // Missing is the expected state.
    }
  }
  if (collisions.length > 0) {
    throw new QrPosterError(
      'OUTPUT_EXISTS',
      `Refusing to overwrite existing output files: ${collisions.join(', ')}. Use --force to replace them.`,
    )
  }
}
