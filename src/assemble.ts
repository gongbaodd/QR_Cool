import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { renderRegionMask } from './artifacts.js'
import { QrPosterError } from './errors.js'
import { decodePng, rgbaToPng } from './image.js'
import { resolveLayout } from './layout.js'
import { PATTERN_ALPHABET, PATTERN_ECC, PATTERN_MARKER_REFILL, PATTERN_PIXEL_STYLE, renderPosterPattern } from './pattern.js'
import {
  buildCutPath,
  buildCutSvg,
  cleanMaskSelection,
  cutMinLoopArea,
  renderCutBorderCoverage,
  renderCutCoverage,
} from './pattern-cut.js'
import { verifyQrVariant } from './qr.js'
import type { AssemblePosterOptions, AssembleReport, AssembleResult, VerificationCheck } from './types.js'

/** Quiet-zone modules the QR input profile carries; the overlay keeps one of them as a light margin. */
const QUIET_ZONE_MODULES = 2 as const
/** Light margin modules composited around the code grid, so the QR reads as one block with the texture. */
const OVERLAY_MARGIN_MODULES = 1 as const
/** Mask cleanup disc radius in module pitches, so pixel jags smaller than a module disappear. */
const CLEAN_MODULES = 1 as const
/** Douglas-Peucker tolerance in module pitches for the traced outline. */
const SMOOTH_MODULES = 1 as const
/** Corner fillet radius in module pitches. */
const FILLET_MODULES = 2 as const
/** Black band drawn inside the cut edge, in module pitches. */
const BORDER_MODULES = 4 as const
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
 * Assembles the finished poster offline: the marker-free texture is rendered at the placed pitch,
 * cut to the painted region with filleted corners, composited over the original pixels, and covered
 * by the exact normalized QR. Pixels outside the region and the whole alpha channel are preserved,
 * so nothing is ever punched transparent and only the region interior changes.
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
  if (options.smoothTolerance !== undefined && (!Number.isFinite(options.smoothTolerance) || options.smoothTolerance < 0))
    throw new QrPosterError('INVALID_INPUT', '--cut-smooth must be zero or a positive number.')

  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const { poster, qrSource, maskInput, regionMask, decoded, qrMetadata, placement, normalizedQr }
    = await resolveLayout(options)
  const { width, height } = poster

  const radius = options.radius ?? FILLET_MODULES * placement.modulePixels
  const smoothTolerance = options.smoothTolerance ?? SMOOTH_MODULES * placement.modulePixels
  const cleanRadius = CLEAN_MODULES * placement.modulePixels
  const borderWidth = BORDER_MODULES * placement.modulePixels

  const rendered = await renderPosterPattern({
    width,
    height,
    modulePixels: placement.modulePixels,
    alignTo: { x: placement.x, y: placement.y },
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  })
  const render = await decodePng(rendered.png, 'pattern.png', 'rendered pattern')

  const rawSelection = new Uint8Array(regionMask.data.length)
  for (let index = 0; index < rawSelection.length; index++)
    rawSelection[index] = regionMask.data[index] ? 1 : 0
  const selection = cleanMaskSelection(rawSelection, width, height, cleanRadius)
  const cut = buildCutPath(selection, width, height, { radius, smoothTolerance })
  const coverage = await renderCutCoverage(cut.d, width, height)
  const borderCoverage = await renderCutBorderCoverage(cut.d, width, height, borderWidth)
  const cutSvg = buildCutSvg(cut.d, width, height, render.file, { borderWidth })

  // The written cut layer is exactly what the composition applies: the filleted shape clipped to
  // the painted region, with the black border along the inside of the edge and the antialiased
  // coverage that makes both blends smooth.
  const cutLayer = new Uint8Array(width * height * 4)
  for (let index = 0; index < regionMask.data.length; index++) {
    const offset = index * 4
    cutLayer[offset] = render.data[offset]!
    cutLayer[offset + 1] = render.data[offset + 1]!
    cutLayer[offset + 2] = render.data[offset + 2]!
    if (!regionMask.data[index])
      continue
    const border = borderCoverage[index]! / 255
    if (border > 0) {
      for (let channel = 0; channel < 3; channel++)
        cutLayer[offset + channel] = Math.round(cutLayer[offset + channel]! * (1 - border))
    }
    const cover = coverage[index]! / 255
    // Either layer painting here makes the pixel visible; both are inside the painted region.
    cutLayer[offset + 3] = Math.round(255 * (1 - (1 - cover) * (1 - border)))
  }
  const cutPng = await rgbaToPng(cutLayer, width, height)

  const output = Uint8Array.from(poster.data)
  for (let index = 0; index < regionMask.data.length; index++) {
    const cover = coverage[index]!
    const border = borderCoverage[index]!
    if (!regionMask.data[index] || (cover === 0 && border === 0))
      continue
    const offset = index * 4
    // Blend the antialiased edge into the artwork underneath; the alpha channel never changes.
    if (cover > 0) {
      const weight = cover / 255
      for (let channel = 0; channel < 3; channel++) {
        output[offset + channel] = Math.round(
          render.data[offset + channel]! * weight + output[offset + channel]! * (1 - weight),
        )
      }
    }
    // The black border follows the mask silhouette, not the QR, and sits on top of the texture.
    if (border > 0) {
      const weight = border / 255
      for (let channel = 0; channel < 3; channel++)
        output[offset + channel] = Math.round(output[offset + channel]! * (1 - weight))
    }
  }

  // The QR keeps a single quiet-zone module and drops the rest: the 39-module window (code grid plus
  // a 5px light margin) is copied verbatim, so the texture stops one module short of the code instead
  // of wrapping it in a wide white square. Half the profile margin is enough for the local decoders
  // on this fixture but not a promise for a phone camera, so the poster stays unverified.
  const qrRaw = await sharp(normalizedQr)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const { x, y, size } = placement
  const overlayInset = (QUIET_ZONE_MODULES - OVERLAY_MARGIN_MODULES) * placement.modulePixels
  const overlaySize = size - overlayInset * 2
  const overlayX = x + overlayInset
  const overlayY = y + overlayInset
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const insideQr = column >= overlayX && column < overlayX + overlaySize
        && row >= overlayY && row < overlayY + overlaySize
      if (!insideQr)
        continue
      const target = (row * width + column) * 4
      const source = ((row - overlayY + overlayInset) * size + column - overlayX + overlayInset) * 4
      for (let channel = 0; channel < 4; channel++)
        output[target + channel] = qrRaw[source + channel]!
    }
  }

  let outsidePassed = true
  let qrPassed = true
  let alphaPassed = true
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const offset = index * 4
      const insideQr = column >= overlayX && column < overlayX + overlaySize
        && row >= overlayY && row < overlayY + overlaySize
      for (let channel = 0; channel < 4; channel++) {
        const value = output[offset + channel]!
        if (!regionMask.data[index] && value !== poster.data[offset + channel]!)
          outsidePassed = false
        if (insideQr && value !== qrRaw[((row - overlayY + overlayInset) * size + column - overlayX + overlayInset) * 4 + channel]!)
          qrPassed = false
      }
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
    { name: 'alphaPreserved', passed: alphaPassed },
  ]
  const qualified = checks.every(check => check.passed)

  const minLoopArea = cutMinLoopArea(radius)
  const warnings: string[] = []
  warnings.push(
    `The QR quiet zone was trimmed to ${OVERLAY_MARGIN_MODULES} module in the composited overlay, so the `
    + 'assembled poster is not decode-verified; only the QR input and the geometry checks ran.',
  )
  if (placement.modulePixels < 6)
    warnings.push(`The normalized QR uses ${placement.modulePixels}px modules; 6px or larger is preferred.`)
  if (cut.stats.specksDropped > 0)
    warnings.push(`${cut.stats.specksDropped} mask loop(s) smaller than ${minLoopArea}px² were dropped as specks.`)
  if (cut.stats.radiusClamped)
    warnings.push(`The ${radius}px fillet was clamped on features narrower than twice the radius.`)
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
    schemaVersion: 5,
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
        path: normalizedPath(options.qrPath),
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
      normalizedModulePixels: placement.modulePixels,
      overlay: {
        quietZoneModules: OVERLAY_MARGIN_MODULES,
        crop: { left: overlayInset, top: overlayInset, size: overlaySize },
        x: overlayX,
        y: overlayY,
      },
    },
    placement,
    pattern: {
      seed: rendered.seed,
      alphabet: PATTERN_ALPHABET,
      textLength: rendered.text.length,
      textSha256: sha256(rendered.text),
      ecc: PATTERN_ECC,
      version: rendered.version,
      qrModules: rendered.qrModules,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules: rendered.totalModules,
      modulePixels: placement.modulePixels,
      pixelStyle: PATTERN_PIXEL_STYLE,
      alignment: {
        alignedToQr: true,
        phase: { x: rendered.crop.left % placement.modulePixels, y: rendered.crop.top % placement.modulePixels },
      },
      removedTypes: [...REMOVED_TYPES],
      markerRefill: PATTERN_MARKER_REFILL,
      refilledModules: rendered.refilledModules,
      codeSize: rendered.codeSize,
      canvas: { width, height },
      crop: rendered.crop,
    },
    cut: {
      radius,
      smoothTolerance,
      cleanRadius,
      border: { width: borderWidth, color: '#000000', side: 'inside' },
      keep: 'region-mask',
      minLoopArea,
      edgeBlend: 'coverage-over-original',
    },
    shape: cut.stats,
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
