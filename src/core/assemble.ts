import { renderRegionMask } from './artifacts'
import { QrPosterError } from './errors'
import { imaging } from './imaging'
import { decodePng, rgbaToPng } from './image'
import {
  buildModuleLattice,
  buildModulePath,
  computePlateModules,
  computeRimModules,
  computeSafeArea,
  moduleCellIndex,
  renderModuleCoverage,
} from './module-cut'
import {
  posterToPlatePoint,
  qrWorkingFrame,
  regionPixelBounds,
  sampleMaskIntoQrFrame,
  assertFrameHoldsPlacement,
} from './rotate'
import type { QrFrame } from './rotate'
import {
  PATTERN_ALPHABET,
  PATTERN_ECC,
  PATTERN_MARKER_REFILL,
  PATTERN_PIXEL_STYLE,
  PATTERN_QUIET_ZONE_MODULES,
  buildPosterPattern,
  renderPattern,
} from './pattern'
import type { PixelStyle } from './pattern'
import { buildCutSvg } from './pattern-cut'
import { compositePixelOver } from './imaging/pixels'
import { transparentQrBackground, verifyQrVariant } from './qr'
import type { AssembleReport, BoundingBox, QrPlacement, ResolvedLayout, VerificationCheck } from './types'

/** Quiet-zone modules the QR input profile carries; the plate band is cut out of them. */
const QUIET_ZONE_MODULES = PATTERN_QUIET_ZONE_MODULES
/** Depth of the light band kept beside each finder marker: one whole cell. */
const BAND_MODULES = 1 as const
/** Finder patterns are 7x7 modules; the band arms span that footprint along the code edge. */
const MARKER_MODULES = 7 as const
/** Default outer rings of drawn modules forced dark; configurable 0-5. UI exposes 0/1 via Add Rim checkbox. */
const DEFAULT_RIM_MODULES = 1 as const
/** A requested `--cut-radius` below this keeps the marker corner blocks light; any larger value cuts them. */
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
 * Assembles the finished poster offline in whole modules. Upright placements take the golden
 * 0° path, where the generator's marker-free matrix is sampled against the painted region on
 * the placed QR's own lattice. A rotated placement instead validates and paints in the QR's
 * upright frame: the region mask is inverse-rotated into that frame, the same whole-module
 * pipeline generates the fill and plate there, and the finished overlay rides the placement
 * transform back onto the poster (doc/plan/rotated-mask-fill.md).
 */
export async function assembleResolved(
  layout: ResolvedLayout,
  options: {
    seed?: number
    qrMargin?: 1
    radius?: number
    rimModules?: number
    rimRounded?: boolean
    pixelStyle?: PixelStyle
    transparentBlank?: boolean
  },
) {
  if ((layout.placement.rotation ?? 0) !== 0) return assembleRotated(layout, options)
  return assembleUpright(layout, options)
}

/**
 * The 0° golden path, byte-for-byte the former `assembleResolved` body: the generator's
 * marker-free matrix is sampled against the painted region on the placed QR's own lattice,
 * only modules that sit entirely inside the region are drawn, and the QR plate is cut out
 * as a hole on that same lattice. Uploaded posters keep their source alpha. The generated
 * transparent blank mode writes ink and the QR plate onto a transparent canvas.
 */
async function assembleUpright(
  layout: ResolvedLayout,
  options: {
    seed?: number
    qrMargin?: 1
    radius?: number
    rimModules?: number
    rimRounded?: boolean
    pixelStyle?: PixelStyle
    transparentBlank?: boolean
  },
) {
  const startedAt = Date.now()
  const { poster, qrSource, maskInput, regionMask, decoded, qrMetadata, placement, normalizedQr } = layout
  const { width, height } = poster
  const pitch = placement.modulePixels

  // The module lattice is the placed QR's own lattice, so the texture's cells, the rim, and the
  // plate hole all share one grid and no drawn edge can slice a cell.
  const lattice = buildModuleLattice(width, height, pitch, placement)
  const selection = Uint8Array.from(regionMask.data, (value) => (value ? 1 : 0))
  const safeArea = computeSafeArea(selection, width, height, lattice)

  const marginModules = options.qrMargin ?? BAND_MODULES
  const marginPixels = marginModules * pitch
  const radius = options.radius ?? 2 * pitch
  const rimModulesCount = options.rimModules ?? DEFAULT_RIM_MODULES
  const rimRounded = options.rimRounded ?? false
  const transparentBlank = options.transparentBlank ?? false
  if (!Number.isInteger(rimModulesCount) || rimModulesCount < 0 || rimModulesCount > 5)
    throw new QrPosterError('INVALID_INPUT', 'rimModules must be an integer between 0 and 5.')
  // The plate copies the normalized QR verbatim at its placement position, but keeps a light band
  // only beside the three finder markers: the rest of the code edge sits flush against the texture,
  // so the margin there is zero. Only the markers keep a band, because they are what a decoder locks
  // onto. The code grid sits inside the placement box by the profile's quiet zone.
  const codeGrid: BoundingBox = {
    x: placement.x + QUIET_ZONE_MODULES * pitch,
    y: placement.y + QUIET_ZONE_MODULES * pitch,
    width: qrMetadata.qrModules * pitch,
    height: qrMetadata.qrModules * pitch,
  }
  const { arms, cornerBlocks } = markerBandRects(codeGrid, qrMetadata.qrModules, pitch, marginModules)
  const plateCornersCut = radius >= PLATE_CORNER_EPSILON
  const plate = computePlateModules(
    lattice,
    [codeGrid, ...arms, ...(plateCornersCut ? [] : cornerBlocks)],
    plateCornersCut ? cornerBlocks : [],
  )
  const bandCells = plate.holeModules - qrMetadata.qrModules * qrMetadata.qrModules

  const drawn = new Uint8Array(lattice.columns * lattice.rows)
  let drawnModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!safeArea.safe[index] || plate.cells[index]) continue
    drawn[index] = 1
    drawnModules++
  }
  const rim = computeRimModules(safeArea.safe, lattice, rimModulesCount)
  let rimModuleCount = 0
  let textureModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!drawn[index]) continue
    if (rim[index]) rimModuleCount++
    else textureModules++
  }
  if (textureModules === 0 && rimModulesCount > 0) {
    throw new QrPosterError(
      'QR_LAYOUT_INVALID',
      `The painted region leaves no texture module once the ${rimModulesCount}-module rim and the QR plate ` +
        'are removed. Use a larger region, a smaller QR box, or a manual --qr-box.',
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
  // Non-negative remainder, so a negative working-space offset never reports a -0 phase.
  const phaseX = (((pattern.crop.left + placement.x) % pitch) + pitch) % pitch
  const phaseY = (((pattern.crop.top + placement.y) % pitch) + pitch) % pitch
  if (phaseX !== 0 || phaseY !== 0) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `The texture window at ${pattern.crop.left},${pattern.crop.top} is not phase-locked to the ${pitch}px ` +
        `QR lattice (residual ${phaseX},${phaseY}); whole-module drawing needs both on one grid.`,
      3,
    )
  }
  const moduleOffsetX = (pattern.crop.left + (placement.x % pitch)) / pitch
  const moduleOffsetY = (pattern.crop.top + (placement.y % pitch)) / pitch
  const matrixOffsetX = moduleOffsetX - pattern.marginModules
  const matrixOffsetY = moduleOffsetY - pattern.marginModules
  const effective = pattern.matrix.map((row) => row.slice())
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      const index = row * lattice.columns + column
      if (!drawn[index]) continue
      const matrixRow = row + matrixOffsetY
      const matrixColumn = column + matrixOffsetX
      if (matrixRow < 0 || matrixColumn < 0 || matrixRow >= effective.length || matrixColumn >= effective.length)
        continue
      if (rim[index]) effective[matrixRow]![matrixColumn] = true
    }
  }
  const include = (moduleX: number, moduleY: number): boolean => {
    const column = moduleX - moduleOffsetX
    const row = moduleY - moduleOffsetY
    if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows) return false
    return drawn[row * lattice.columns + column] === 1
  }
  const pixelStyle: PixelStyle = options.pixelStyle ?? PATTERN_PIXEL_STYLE
  const texturePng = await renderPattern(effective, pitch, pixelStyle, {
    marginModules: pattern.marginModules,
    window: { ...pattern.crop, width, height },
    include,
  })
  const render = await decodePng(texturePng, 'pattern.png', 'rendered pattern')

  // The written cut layer is the composited geometry: whole drawn modules carry the texture, and
  // everything else — the artwork along the silhouette, the plate hole — is transparent.
  // Rounded rim is antialiased on the same module-aligned path; the underlying geometry stays
  // whole modules so verification remains pixel-exact at the module level.
  const unitPath = buildModulePath(drawn, lattice)
  const coverage = await renderModuleCoverage(unitPath, width, height, rimRounded)
  const cutLayer = new Uint8Array(width * height * 4)
  for (let index = 0; index < coverage.length; index++) {
    const alpha = coverage[index]!
    if (alpha === 0) continue
    const offset = index * 4
    if (transparentBlank) {
      const textureAlpha = Math.round((render.data[offset + 3]! * alpha) / 255)
      if (textureAlpha === 0) continue
      cutLayer[offset] = render.data[offset]!
      cutLayer[offset + 1] = render.data[offset + 1]!
      cutLayer[offset + 2] = render.data[offset + 2]!
      cutLayer[offset + 3] = textureAlpha
      continue
    }
    if (alpha === 255 || !rimRounded) {
      cutLayer[offset] = render.data[offset]!
      cutLayer[offset + 1] = render.data[offset + 1]!
      cutLayer[offset + 2] = render.data[offset + 2]!
      cutLayer[offset + 3] = 255
    } else {
      // Antialiased edge: blend texture over transparent background.
      const srcA = alpha / 255
      cutLayer[offset] = Math.round(render.data[offset]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 1] = Math.round(render.data[offset + 1]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 2] = Math.round(render.data[offset + 2]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 3] = alpha
    }
  }
  const cutPng = await rgbaToPng(cutLayer, width, height)
  const cutSvg = buildCutSvg(unitPath, width, height, texturePng)

  // The normalized QR is copied verbatim where the plate is: the code grid and the light arms beside
  // the three finder markers. Every plate pixel maps to the same position inside the placement box,
  // so the arms carry the QR's own quiet zone and the corner blocks keep the texture the drawn
  // modules put underneath. The rest of the code edge is texture, so the poster stays unverified and
  // the report warns about it.
  const qrRaw = (await decodePng(normalizedQr, 'normalized QR', 'normalized QR')).data
  const output = Uint8Array.from(poster.data)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const cell = moduleCellIndex(lattice, column, row)
      const source = cell >= 0 && plate.cells[cell] === 1 ? qrSourceOffset(placement, column, row) : null
      if (source !== null && source >= 0) {
        for (let channel = 0; channel < 4; channel++) output[offset + channel] = qrRaw[source + channel]!
        continue
      }
      const alpha = coverage[index]!
      if (alpha === 0) continue
      if (transparentBlank) {
        const textureAlpha = Math.round((render.data[offset + 3]! * alpha) / 255)
        if (textureAlpha > 0) compositePixelOver(render.data, offset, output, offset, textureAlpha)
        continue
      }
      if (alpha === 255 || !rimRounded) {
        for (let channel = 0; channel < 3; channel++) output[offset + channel] = render.data[offset + channel]!
      } else {
        const srcA = alpha / 255
        for (let channel = 0; channel < 3; channel++) {
          const src = render.data[offset + channel]!
          const dst = output[offset + channel]!
          output[offset + channel] = Math.round(src * srcA + dst * (1 - srcA))
        }
      }
    }
  }

  let outsidePassed = true
  let qrPassed = true
  let plateCornersPassed = true
  let moduleCutPassed = true
  let alphaPassed = true
  let transparentBackgroundPassed = true
  let cornerTexturePixels = 0
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const cell = moduleCellIndex(lattice, column, row)
      const isPlate = cell >= 0 && plate.cells[cell] === 1
      const plateSource = isPlate ? qrSourceOffset(placement, column, row) : -1
      const isCorner = cell >= 0 && plate.corners[cell] === 1
      const isDrawn = cell >= 0 && drawn[cell] === 1
      const hasCoverage = coverage[index]! > 0
      if (isCorner) cornerTexturePixels++
      let changed = false
      for (let channel = 0; channel < 4; channel++) {
        const value = output[offset + channel]!
        if (value !== poster.data[offset + channel]!) changed = true
        if (!regionMask.data[index] && value !== poster.data[offset + channel]!) outsidePassed = false
        if (isPlate && value !== qrRaw[plateSource + channel]!) qrPassed = false
        if (isCorner) {
          const expected =
            transparentBlank && channel === 3
              ? Math.round((render.data[offset + 3]! * coverage[index]!) / 255)
              : render.data[offset + channel]!
          if (value !== expected) plateCornersPassed = false
        }
      }
      // Square rim: whole modules or nothing. Rounded rim: antialiased coverage may change pixels
      // where coverage is partial, so allow any pixel with coverage >0.
      const allowed = rimRounded ? hasCoverage || isPlate : isDrawn || isPlate
      if (changed && !allowed) moduleCutPassed = false
      if (output[offset + 3] !== poster.data[offset + 3]!) alphaPassed = false
      if (transparentBlank) {
        const expectedAlpha = isPlate
          ? qrRaw[plateSource + 3]!
          : Math.round((render.data[offset + 3]! * coverage[index]!) / 255)
        if (poster.data[offset + 3] !== 0 || output[offset + 3] !== expectedAlpha) transparentBackgroundPassed = false
      }
    }
  }

  const assembled = await rgbaToPng(output, width, height)

  // The quiet zone is trimmed to one module, so the assembled poster is deliberately not
  // decode-verified; only the QR input, geometry, and the applicable alpha contract are checked.
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
    ...(transparentBlank
      ? [{ name: 'transparentBackground' as const, passed: transparentBackgroundPassed }]
      : [{ name: 'alphaPreserved' as const, passed: alphaPassed }]),
  ]
  const qualified = checks.every((check) => check.passed)

  const warnings: string[] = []
  warnings.push(
    `The light band is kept beside the three finder markers only: ${bandCells} cell(s) ` +
      `${formatNumber(marginModules)} module deep (${marginPixels}px at ${pitch}px modules), with the ` +
      `plate's ${plate.cornerModules} corner block module(s) handed back to the texture. The code's other ` +
      `edges sit flush against the texture, so the profile's ${QUIET_ZONE_MODULES}-module quiet zone is not ` +
      'kept and the assembled poster is not decode-verified; only the QR input and the geometry checks ran.',
  )
  if (safeArea.partialModules > 0) {
    warnings.push(
      `${safeArea.partialModules} module(s) crossed the painted region's edge and kept the original ` +
        `artwork (${safeArea.droppedPartialPixels} region pixels); the cut draws whole modules only.`,
    )
  }
  if (pitch < 6) warnings.push(`The normalized QR uses ${pitch}px modules; 6px or larger is preferred.`)
  for (const check of checks) {
    if (!check.passed) warnings.push(`${check.name} verification failed${check.error ? `: ${check.error}` : '.'}`)
  }

  const regionMaskPng = await renderRegionMask(regionMask)
  const transparentQr = await transparentQrBackground(normalizedQr)
  const [posterSha, qrSha, cutPngSha, cutSvgSha, textSha] = await Promise.all([
    imaging().sha256Hex(assembled),
    imaging().sha256Hex(transparentQr),
    imaging().sha256Hex(cutPng),
    imaging().sha256Hex(cutSvg),
    imaging().sha256Hex(pattern.text),
  ])
  const report: AssembleReport = {
    schemaVersion: 8,
    mode: 'assemble',
    status: qualified ? 'generated' : 'verification_failed',
    qualified,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      poster: {
        path: poster.path,
        sha256: poster.sha256,
        width: poster.width,
        height: poster.height,
      },
      qr: {
        path: qrSource.path,
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(maskInput ? { mask: { path: maskInput.path, sha256: maskInput.sha256 } } : {}),
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
        band: 'markers',
        quietZoneModules: marginModules,
        markerModules: MARKER_MODULES,
        crop: {
          left: QUIET_ZONE_MODULES * pitch,
          top: QUIET_ZONE_MODULES * pitch,
          size: codeGrid.width,
        },
        x: codeGrid.x,
        y: codeGrid.y,
      },
    },
    placement,
    pattern: {
      seed: pattern.seed,
      alphabet: PATTERN_ALPHABET,
      textLength: pattern.text.length,
      textSha256: textSha,
      ecc: PATTERN_ECC,
      version: pattern.version,
      qrModules: pattern.qrModules,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules: pattern.totalModules,
      modulePixels: pitch,
      pixelStyle,
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
      rim: { modules: rimModulesCount, style: rimRounded ? 'rounded-antialiased' : 'cell' },
      plateCornerModules: plate.cornerModules,
      keep: 'region-mask',
      edgeBlend: rimRounded ? 'antialiased' : 'cell-aligned-over-original',
    },
    qrPlate: {
      band: 'markers',
      marginModules,
      marginPixels,
      markerModules: MARKER_MODULES,
      bandCells,
      box: codeGrid,
      holeModules: plate.holeModules,
      cornerModules: plate.cornerModules,
      cornerTexturePixels,
    },
    shape: {
      bounds: safeArea.bounds,
      area: drawnModules * pitch * pitch,
      modules: drawnModules,
      rimModules: rimModuleCount,
      textureModules,
    },
    artifacts: {
      poster: ARTIFACT_NAMES.poster,
      posterSha256: posterSha,
      regionMask: ARTIFACT_NAMES.regionMask,
      qr: ARTIFACT_NAMES.qr,
      qrSha256: qrSha,
      patternCutPng: ARTIFACT_NAMES.patternCutPng,
      patternCutPngSha256: cutPngSha,
      patternCutSvg: ARTIFACT_NAMES.patternCutSvg,
      patternCutSvgSha256: cutSvgSha,
    },
    verification: { expectedText: decoded.text, checks, qualified, skippedChecks: [...SKIPPED_DECODE_CHECKS] },
    phoneScan: 'untested',
    warnings,
  }
  const encoder = new TextEncoder()
  const artifacts: Record<string, Uint8Array> = {
    'poster.png': assembled,
    'region-mask.png': regionMaskPng,
    'qr.png': transparentQr,
    'pattern-cut.png': cutPng,
    'pattern-cut.svg': encoder.encode(cutSvg),
    'report.json': encoder.encode(`${JSON.stringify(report, null, 2)}\n`),
  }
  return { report, artifacts }
}

/**
 * The rotated assembly path (doc/plan/rotated-mask-fill.md). QR generation, marker bands, rim,
 * and module rendering stay rotation-unaware: the painted region mask is inverse-rotated into
 * the QR's upright frame, the whole-module pipeline generates the texture plus the 0° plate
 * there, and the finished overlay is rotated back onto the poster with one nearest-neighbour
 * inverse-map pass clipped to the original region. Rotation is placement state, not pattern
 * settings; `rotation = 0` never reaches this path and the golden bytes stay untouched.
 */
async function assembleRotated(
  layout: ResolvedLayout,
  options: {
    seed?: number
    qrMargin?: 1
    radius?: number
    rimModules?: number
    rimRounded?: boolean
    pixelStyle?: PixelStyle
    transparentBlank?: boolean
  },
) {
  const startedAt = Date.now()
  const { poster, qrSource, maskInput, regionMask, decoded, qrMetadata, placement, normalizedQr } = layout
  const { width, height } = poster
  const pitch = placement.modulePixels

  // The working canvas covers the inverse-rotated selected region, not the whole poster: assembly
  // only paints inside the region, so a small painted area stays a small buffer even at 45deg.
  const regionBounds = regionPixelBounds(regionMask)
  const frame = qrWorkingFrame(placement, regionBounds)
  // The frame must hold the whole placed plate: a truncated frame would silently drop plate
  // cells the qrPixels check could never see. Same helper as preparation, same rejection.
  assertFrameHoldsPlacement(frame, placement, width, height)
  const selection = Uint8Array.from(regionMask.data, (value) => (value ? 1 : 0))
  const workingMask = sampleMaskIntoQrFrame(selection, width, height, frame, placement)

  // Everything below is the 0° whole-module pipeline on the working canvas, with the QR box at
  // the plate origin: lattice, safe modules, rim, plate hole, phase-locked pattern crop.
  const lattice = buildModuleLattice(frame.width, frame.height, pitch, frame.qr)
  const safeArea = computeSafeArea(workingMask, frame.width, frame.height, lattice)

  const marginModules = options.qrMargin ?? BAND_MODULES
  const marginPixels = marginModules * pitch
  const radius = options.radius ?? 2 * pitch
  const rimModulesCount = options.rimModules ?? DEFAULT_RIM_MODULES
  const rimRounded = options.rimRounded ?? false
  const transparentBlank = options.transparentBlank ?? false
  if (!Number.isInteger(rimModulesCount) || rimModulesCount < 0 || rimModulesCount > 5)
    throw new QrPosterError('INVALID_INPUT', 'rimModules must be an integer between 0 and 5.')
  const codeGrid: BoundingBox = {
    x: frame.qr.x + QUIET_ZONE_MODULES * pitch,
    y: frame.qr.y + QUIET_ZONE_MODULES * pitch,
    width: qrMetadata.qrModules * pitch,
    height: qrMetadata.qrModules * pitch,
  }
  const { arms, cornerBlocks } = markerBandRects(codeGrid, qrMetadata.qrModules, pitch, marginModules)
  const plateCornersCut = radius >= PLATE_CORNER_EPSILON
  // Generation is upright, so the plate regains the 0° hole semantics at every angle: the code
  // grid plus the finder arms, with the corner hand-back restored for rotated placements too.
  const plate = computePlateModules(
    lattice,
    [codeGrid, ...arms, ...(plateCornersCut ? [] : cornerBlocks)],
    plateCornersCut ? cornerBlocks : [],
  )
  const bandCells = plate.holeModules - qrMetadata.qrModules * qrMetadata.qrModules

  const drawn = new Uint8Array(lattice.columns * lattice.rows)
  let drawnModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!safeArea.safe[index] || plate.cells[index]) continue
    drawn[index] = 1
    drawnModules++
  }
  const rim = computeRimModules(safeArea.safe, lattice, rimModulesCount)
  let rimModuleCount = 0
  let textureModules = 0
  for (let index = 0; index < drawn.length; index++) {
    if (!drawn[index]) continue
    if (rim[index]) rimModuleCount++
    else textureModules++
  }
  if (textureModules === 0 && rimModulesCount > 0) {
    throw new QrPosterError(
      'QR_LAYOUT_INVALID',
      `The rotated painted region leaves no texture module once the ${rimModulesCount}-module rim and ` +
        'the QR plate are removed. Use a larger region, a smaller QR box, or a smaller rotation.',
    )
  }

  // The texture stays phase-locked to the placed QR's lattice, now in the QR's frame: the crop
  // residual versus the pitch must be 0 for both axes in working space.
  const pattern = await buildPosterPattern({
    width: frame.width,
    height: frame.height,
    modulePixels: pitch,
    alignTo: { x: frame.qr.x, y: frame.qr.y },
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  })
  const phaseX = (((pattern.crop.left + frame.qr.x) % pitch) + pitch) % pitch
  const phaseY = (((pattern.crop.top + frame.qr.y) % pitch) + pitch) % pitch
  if (phaseX !== 0 || phaseY !== 0) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `The texture window at ${pattern.crop.left},${pattern.crop.top} is not phase-locked to the ${pitch}px ` +
        `QR lattice (residual ${phaseX},${phaseY}); whole-module drawing needs both on one grid.`,
      3,
    )
  }
  const moduleOffsetX = (pattern.crop.left + (frame.qr.x % pitch)) / pitch
  const moduleOffsetY = (pattern.crop.top + (frame.qr.y % pitch)) / pitch
  const matrixOffsetX = moduleOffsetX - pattern.marginModules
  const matrixOffsetY = moduleOffsetY - pattern.marginModules
  const effective = pattern.matrix.map((row) => row.slice())
  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column < lattice.columns; column++) {
      const index = row * lattice.columns + column
      if (!drawn[index]) continue
      const matrixRow = row + matrixOffsetY
      const matrixColumn = column + matrixOffsetX
      if (matrixRow < 0 || matrixColumn < 0 || matrixRow >= effective.length || matrixColumn >= effective.length)
        continue
      if (rim[index]) effective[matrixRow]![matrixColumn] = true
    }
  }
  const include = (moduleX: number, moduleY: number): boolean => {
    const column = moduleX - moduleOffsetX
    const row = moduleY - moduleOffsetY
    if (column < 0 || row < 0 || column >= lattice.columns || row >= lattice.rows) return false
    return drawn[row * lattice.columns + column] === 1
  }
  const pixelStyle: PixelStyle = options.pixelStyle ?? PATTERN_PIXEL_STYLE
  const texturePng = await renderPattern(effective, pitch, pixelStyle, {
    marginModules: pattern.marginModules,
    window: { ...pattern.crop, width: frame.width, height: frame.height },
    include,
  })
  const render = await decodePng(texturePng, 'pattern.png', 'rendered pattern')

  // The working cut layer is the same whole-module geometry as the upright path: drawn modules
  // carry the texture, the plate hole stays transparent, and antialiasing lives on the same
  // module-aligned path. It is rotated back with the same NN map, never retessellated.
  const unitPath = buildModulePath(drawn, lattice)
  const coverage = await renderModuleCoverage(unitPath, frame.width, frame.height, rimRounded)
  const cutLayer = new Uint8Array(frame.width * frame.height * 4)
  for (let index = 0; index < coverage.length; index++) {
    const alpha = coverage[index]!
    if (alpha === 0) continue
    const offset = index * 4
    if (transparentBlank) {
      const textureAlpha = Math.round((render.data[offset + 3]! * alpha) / 255)
      if (textureAlpha === 0) continue
      cutLayer[offset] = render.data[offset]!
      cutLayer[offset + 1] = render.data[offset + 1]!
      cutLayer[offset + 2] = render.data[offset + 2]!
      cutLayer[offset + 3] = textureAlpha
      continue
    }
    if (alpha === 255 || !rimRounded) {
      cutLayer[offset] = render.data[offset]!
      cutLayer[offset + 1] = render.data[offset + 1]!
      cutLayer[offset + 2] = render.data[offset + 2]!
      cutLayer[offset + 3] = 255
    } else {
      const srcA = alpha / 255
      cutLayer[offset] = Math.round(render.data[offset]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 1] = Math.round(render.data[offset + 1]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 2] = Math.round(render.data[offset + 2]! * srcA + 255 * (1 - srcA))
      cutLayer[offset + 3] = alpha
    }
  }
  const workingCutSvg = buildCutSvg(unitPath, frame.width, frame.height, texturePng)
  // The cut artifact for a rotated placement is the working cut rotated back with the same NN
  // inverse map, and the SVG keeps the same working geometry wrapped in the placement transform
  // — rotated quads are never retessellated in a second geometry path.
  const rotatedCutPng = await rotateBackCutPng(cutLayer, frame, placement, width, height, regionMask)
  const posterCutSvg = buildRotatedCutSvg(workingCutSvg, placement, frame, width, height)

  // The working overlay is the whole finished composite ready to be rotated: the upright QR plate
  // copied verbatim over the plate cells, the texture over the drawn cells, and the alpha that
  // lets the rounded rim blend onto the original artwork during the rotate-back.
  const qrRaw = (await decodePng(normalizedQr, 'normalized QR', 'normalized QR')).data
  const overlay = new Uint8Array(frame.width * frame.height * 4)
  for (let row = 0; row < frame.height; row++) {
    for (let column = 0; column < frame.width; column++) {
      const index = row * frame.width + column
      const offset = index * 4
      const cell = moduleCellIndex(lattice, column, row)
      const plateSource = cell >= 0 && plate.cells[cell] === 1 ? workingQrSourceOffset(frame, column, row) : -1
      if (plateSource >= 0) {
        for (let channel = 0; channel < 4; channel++) overlay[offset + channel] = qrRaw[plateSource + channel]!
        continue
      }
      const alpha = coverage[index]!
      if (alpha === 0) continue
      for (let channel = 0; channel < 3; channel++) overlay[offset + channel] = render.data[offset + channel]!
      overlay[offset + 3] = transparentBlank
        ? Math.round((render.data[offset + 3]! * alpha) / 255)
        : alpha === 255 || !rimRounded
          ? 255
          : alpha
    }
  }

  // Rotate back: destination-driven nearest-neighbour inverse-map pass, clipped to the original
  // region so the artistic margin never paints outside the mask and the alpha channel survives.
  const output = Uint8Array.from(poster.data)
  let outsidePassed = true
  let qrPassed = true
  let plateCornersPassed = true
  let moduleCutPassed = true
  let alphaPassed = true
  let transparentBackgroundPassed = true
  let cornerTexturePixels = 0
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const local = posterToPlatePoint(column + 0.5, row + 0.5, placement)
      const wx = Math.floor(local.x - frame.left)
      const wy = Math.floor(local.y - frame.top)
      const inFrame = wx >= 0 && wy >= 0 && wx < frame.width && wy < frame.height
      const cell = inFrame ? moduleCellIndex(lattice, wx, wy) : -1
      const isPlate = cell >= 0 && plate.cells[cell] === 1
      const isCorner = cell >= 0 && plate.corners[cell] === 1
      const isDrawn = cell >= 0 && drawn[cell] === 1
      const overlayOffset = inFrame ? (wy * frame.width + wx) * 4 : -1
      const srcA = inFrame ? overlay[overlayOffset! + 3]! / 255 : 0
      let changed = false
      // Only original-region pixels may be written, and only where the inverse map lands on a
      // drawn module or the plate: moduleCut judges writes through the inverse map, not the
      // poster lattice.
      if (regionMask.data[index] && inFrame) {
        if (isPlate) {
          const plateSource = workingQrSourceOffset(frame, wx, wy)
          for (let channel = 0; channel < 4; channel++) {
            const value = qrRaw[plateSource + channel]!
            if (value !== poster.data[offset + channel]!) changed = true
            output[offset + channel] = value
          }
        } else if (srcA > 0 && transparentBlank) {
          compositePixelOver(overlay, overlayOffset!, output, offset)
          for (let channel = 0; channel < 4; channel++)
            if (output[offset + channel] !== poster.data[offset + channel]) changed = true
        } else if (srcA > 0) {
          for (let channel = 0; channel < 3; channel++) {
            const dst = output[offset + channel]!
            const value =
              srcA === 1
                ? overlay[overlayOffset! + channel]!
                : Math.round(overlay[overlayOffset! + channel]! * srcA + dst * (1 - srcA))
            if (value !== poster.data[offset + channel]!) changed = true
            output[offset + channel] = value
          }
        }
      }
      for (let channel = 0; channel < 4; channel++) {
        const value = output[offset + channel]!
        if (!regionMask.data[index] && value !== poster.data[offset + channel]!) outsidePassed = false
        if (isPlate && value !== qrRaw[workingQrSourceOffset(frame, wx, wy) + channel]!) qrPassed = false
        if (isCorner && value !== overlay[overlayOffset! + channel]!) plateCornersPassed = false
      }
      // Square rim: whole modules or nothing. Rounded rim: antialiased coverage may change pixels
      // where coverage is partial, so allow any pixel whose sample has coverage.
      const allowed = rimRounded ? srcA > 0 || isPlate : isDrawn || isPlate
      if (changed && !allowed) moduleCutPassed = false
      if (output[offset + 3] !== poster.data[offset + 3]!) alphaPassed = false
      if (transparentBlank) {
        const expectedAlpha = regionMask.data[index] && inFrame ? overlay[overlayOffset! + 3]! : 0
        if (poster.data[offset + 3] !== 0 || output[offset + 3] !== expectedAlpha) transparentBackgroundPassed = false
      }
      if (isCorner) cornerTexturePixels++
    }
  }

  const assembled = await rgbaToPng(output, width, height)

  // The quiet zone is trimmed to one module, so the assembled poster is deliberately not
  // decode-verified; only the QR input, geometry, and the applicable alpha contract are checked.
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
    ...(transparentBlank
      ? [{ name: 'transparentBackground' as const, passed: transparentBackgroundPassed }]
      : [{ name: 'alphaPreserved' as const, passed: alphaPassed }]),
  ]
  const qualified = checks.every((check) => check.passed)

  const warnings: string[] = []
  warnings.push(
    `The light band is kept beside the three finder markers only: ${bandCells} cell(s) ` +
      `${formatNumber(marginModules)} module deep (${marginPixels}px at ${pitch}px modules), with the ` +
      `plate's ${plate.cornerModules} corner block module(s) handed back to the texture. The code's other ` +
      `edges sit flush against the texture, so the profile's ${QUIET_ZONE_MODULES}-module quiet zone is not ` +
      'kept and the assembled poster is not decode-verified; only the QR input and the geometry checks ran.',
  )
  if (safeArea.partialModules > 0) {
    warnings.push(
      `${safeArea.partialModules} module(s) crossed the painted region's edge in the QR's frame and kept the ` +
        `original artwork (${safeArea.droppedPartialPixels} region pixels); the cut draws whole modules only.`,
    )
  }
  if (pitch < 6) warnings.push(`The normalized QR uses ${pitch}px modules; 6px or larger is preferred.`)
  for (const check of checks) {
    if (!check.passed) warnings.push(`${check.name} verification failed${check.error ? `: ${check.error}` : '.'}`)
  }

  const regionMaskPng = await renderRegionMask(regionMask)
  const transparentQr = await transparentQrBackground(normalizedQr)
  const [posterSha, qrSha, cutPngSha, cutSvgSha, textSha] = await Promise.all([
    imaging().sha256Hex(assembled),
    imaging().sha256Hex(transparentQr),
    imaging().sha256Hex(rotatedCutPng),
    imaging().sha256Hex(posterCutSvg),
    imaging().sha256Hex(pattern.text),
  ])
  const report: AssembleReport = {
    schemaVersion: 8,
    mode: 'assemble',
    status: qualified ? 'generated' : 'verification_failed',
    qualified,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      poster: {
        path: poster.path,
        sha256: poster.sha256,
        width: poster.width,
        height: poster.height,
      },
      qr: {
        path: qrSource.path,
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(maskInput ? { mask: { path: maskInput.path, sha256: maskInput.sha256 } } : {}),
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
        band: 'markers',
        quietZoneModules: marginModules,
        markerModules: MARKER_MODULES,
        crop: {
          left: QUIET_ZONE_MODULES * pitch,
          top: QUIET_ZONE_MODULES * pitch,
          size: codeGrid.width,
        },
        x: codeGrid.x,
        y: codeGrid.y,
      },
    },
    placement,
    pattern: {
      seed: pattern.seed,
      alphabet: PATTERN_ALPHABET,
      textLength: pattern.text.length,
      textSha256: textSha,
      ecc: PATTERN_ECC,
      version: pattern.version,
      qrModules: pattern.qrModules,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules: pattern.totalModules,
      modulePixels: pitch,
      pixelStyle,
      alignment: { alignedToQr: true, phase: { x: phaseX, y: phaseY } },
      removedTypes: [...REMOVED_TYPES],
      markerRefill: PATTERN_MARKER_REFILL,
      refilledModules: pattern.refilledModules,
      codeSize: pattern.codeSize,
      canvas: { width: frame.width, height: frame.height },
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
      rim: { modules: rimModulesCount, style: rimRounded ? 'rounded-antialiased' : 'cell' },
      plateCornerModules: plate.cornerModules,
      keep: 'region-mask',
      edgeBlend: rimRounded ? 'antialiased' : 'cell-aligned-over-original',
    },
    qrPlate: {
      band: 'markers',
      marginModules,
      marginPixels,
      markerModules: MARKER_MODULES,
      bandCells,
      box: codeGrid,
      holeModules: plate.holeModules,
      cornerModules: plate.cornerModules,
      cornerTexturePixels,
    },
    shape: {
      bounds: safeArea.bounds,
      area: drawnModules * pitch * pitch,
      modules: drawnModules,
      rimModules: rimModuleCount,
      textureModules,
    },
    artifacts: {
      poster: ARTIFACT_NAMES.poster,
      posterSha256: posterSha,
      regionMask: ARTIFACT_NAMES.regionMask,
      qr: ARTIFACT_NAMES.qr,
      qrSha256: qrSha,
      patternCutPng: ARTIFACT_NAMES.patternCutPng,
      patternCutPngSha256: cutPngSha,
      patternCutSvg: ARTIFACT_NAMES.patternCutSvg,
      patternCutSvgSha256: cutSvgSha,
    },
    verification: { expectedText: decoded.text, checks, qualified, skippedChecks: [...SKIPPED_DECODE_CHECKS] },
    phoneScan: 'untested',
    warnings,
  }
  const encoder = new TextEncoder()
  const artifacts: Record<string, Uint8Array> = {
    'poster.png': assembled,
    'region-mask.png': regionMaskPng,
    'qr.png': transparentQr,
    'pattern-cut.png': rotatedCutPng,
    'pattern-cut.svg': encoder.encode(posterCutSvg),
    'report.json': encoder.encode(`${JSON.stringify(report, null, 2)}\n`),
  }
  return { report, artifacts }
}

/** Plate-local coordinates of the working overlay's QR pixels: the working plate IS the QR. */
function workingQrSourceOffset(frame: QrFrame, workingX: number, workingY: number): number {
  return ((workingY - frame.qr.y) * frame.qr.size + (workingX - frame.qr.x)) * 4
}

/**
 * The poster-space cut SVG for a rotated placement: the working cut rides the same centre/angle
 * transform as the PNG rotate-back, so the vector artifact matches the rasterized one instead of
 * retessellating rotated quads in a second geometry path.
 */
function buildRotatedCutSvg(
  workingCutSvg: string,
  placement: QrPlacement,
  frame: QrFrame,
  posterWidth: number,
  posterHeight: number,
): string {
  const body = workingCutSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const centerX = placement.x + placement.size / 2
  const centerY = placement.y + placement.size / 2
  const transform = `translate(${centerX},${centerY}) rotate(${placement.rotation}) translate(${frame.left - centerX},${frame.top - centerY})`
  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${posterWidth}" height="${posterHeight}" viewBox="0 0 ${posterWidth} ${posterHeight}">`
  return `${header}\n  <g transform="${transform}">${body}</g>\n</svg>\n`
}

/**
 * Nearest-neighbour rotate-back of the working cut: each poster pixel maps into the working
 * frame and keeps the cut layer's RGBA, so transparent stays transparent and no decode loop
 * crosses PNG boundaries.
 */
async function rotateBackCutPng(
  cutLayer: Uint8Array,
  frame: QrFrame,
  placement: QrPlacement,
  posterWidth: number,
  posterHeight: number,
  regionMask: { data: Uint8Array; width: number; height: number },
): Promise<Uint8Array> {
  const output = new Uint8Array(posterWidth * posterHeight * 4)
  for (let row = 0; row < posterHeight; row++) {
    for (let column = 0; column < posterWidth; column++) {
      if (!regionMask.data[row * regionMask.width + column]) continue
      const local = posterToPlatePoint(column + 0.5, row + 0.5, placement)
      const wx = Math.floor(local.x - frame.left)
      const wy = Math.floor(local.y - frame.top)
      if (wx < 0 || wy < 0 || wx >= frame.width || wy >= frame.height) continue
      const offset = (wy * frame.width + wx) * 4
      if (cutLayer[offset + 3]! === 0) continue
      const outOffset = (row * posterWidth + column) * 4
      for (let channel = 0; channel < 4; channel++) output[outOffset + channel] = cutLayer[offset + channel]!
    }
  }
  return rgbaToPng(output, posterWidth, posterHeight)
}

/**
 * Geometry of the marker-only light band, in poster pixels: beside each 7x7 finder marker, the two
 * arms that run along its outer edges plus the diagonal corner block, all whole cells on the module
 * lattice. The arms span the finder footprint exactly — the separator inside the code grid already
 * carries its own light row and column — so the band is three small Ls rather than a quiet zone
 * around the code.
 */
export function markerBandRects(
  codeGrid: BoundingBox,
  qrModules: number,
  pitch: number,
  marginModules: 1,
): { arms: BoundingBox[]; cornerBlocks: BoundingBox[] } {
  const marginPixels = marginModules * pitch
  const markerPixels = MARKER_MODULES * pitch
  const last = qrModules - MARKER_MODULES
  const origins = [
    { column: 0, row: 0 },
    { column: last, row: 0 },
    { column: 0, row: last },
  ]
  const arms: BoundingBox[] = []
  const cornerBlocks: BoundingBox[] = []
  for (const { column, row } of origins) {
    const markerX = codeGrid.x + column * pitch
    const markerY = codeGrid.y + row * pitch
    const outerX = column === 0 ? codeGrid.x - marginPixels : codeGrid.x + codeGrid.width
    const outerY = row === 0 ? codeGrid.y - marginPixels : codeGrid.y + codeGrid.height
    arms.push({ x: markerX, y: outerY, width: markerPixels, height: marginPixels })
    arms.push({ x: outerX, y: markerY, width: marginPixels, height: markerPixels })
    cornerBlocks.push({ x: outerX, y: outerY, width: marginPixels, height: marginPixels })
  }
  return { arms, cornerBlocks }
}

/**
 * Byte offset of the normalized QR pixel that sits at the same position inside the placement box.
 * Every plate cell lies in that box — the code grid plus at most the profile's quiet zone — so the
 * arms read the QR's own light margin and the grid reads the code itself.
 */
function qrSourceOffset(placement: QrPlacement, column: number, row: number): number {
  return ((row - placement.y) * placement.size + column - placement.x) * 4
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}
