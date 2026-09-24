/**
 * Environment-agnostic prepare/assemble pipeline for the editor. This is a
 * faithful decomposition of the former `src/server/editor.ts` orchestration;
 * server specifics (sharp metadata checks, multipart bounds) are replaced by
 * the shared `png-guard` header checks and the injected `Imaging` backend.
 *
 * Keep this module independent of Worker, React, HTTP, and Node: it takes the
 * `Imaging` implementation as an argument instead of importing a backend.
 */

import { assembleResolved, markerBandRects } from '@/core/assemble'
import { renderRegionMask } from '@/core/artifacts'
import {
  buildPosterSvg,
  dimensionsAtPitch,
  resizeAreaPremultiplied,
  resizeRegionMaskConservative,
} from '@/core/export-sizes'
import { decodePng, rgbaToPng } from '@/core/image'
import { buildManualRegionMask, detectRegionMask } from '@/core/mask'
import { placeQr, findClosestSquare } from '@/core/placement'
import {
  generateQrFromContent,
  decodeQrRawDetailed,
  inspectAntfuQr,
  normalizeQr,
  transparentQrBackground,
} from '@/core/qr'
import { DEFAULT_PALETTE, paletteGuard, type QrPalette } from '@/core/palette'
import { buildModuleLattice, computeSafeArea, computePlateModules, computeRegionBands } from '@/core/module-cut'
import { selectPatternVersion } from '@/core/pattern'
import { qrWorkingFrame, sampleMaskIntoQrFrame, assertFrameHoldsPlacement } from '@/core/rotate'
import { regionPixelBounds } from '@/core/rotate'
import { QrPosterError } from '@/core/errors'
import type { Imaging } from '@/core/imaging/types'
import type { LoadedPng } from '@/core/image'
import type { QrMetadata, QrPlacement, RegionMask, ResolvedLayout, AssembleReport } from '@/core/types'
import { parsePngHeader } from '@/lib/editor/png-guard'
import { contentSchema, recenterPlacement } from '@/lib/editor/schema'
import type { Placement, Settings } from '@/lib/editor/schema'
import type { EngineInput, PreparedPayload, AssemblePayload, RasterExportPayload } from './types'

/** Builds a Blob with the mime type implied by the artifact name (PNG/SVG/JSON). */
export function bytesToBlob(name: string, bytes: Uint8Array): Blob {
  const type = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : 'image/png'
  return new Blob([new Uint8Array(bytes)], { type })
}

export const engineDefaults: Settings = {
  seed: 0,
  qrMargin: 1,
  plateCorners: 'texture',
  regionMargin: false,
  rimModules: 1,
  rimRounded: false,
  ecc: 'M',
  pixelStyle: 'dot',
  finderMarkers: {
    tl: { style: 'rounded', shape: 'circle', inner: 'circle' },
    tr: { style: 'rounded', shape: 'circle', inner: 'circle' },
    bl: { style: 'rounded', shape: 'circle', inner: 'circle' },
  },
  markerSub: 'square',
  colors: { ...DEFAULT_PALETTE },
}

/** Client-side replacement for the old sharp-metadata `readImage`. */
export { normalizeQr }

export async function readImage(imaging: Imaging, bytes: Uint8Array, name: string): Promise<LoadedPng> {
  parsePngHeader(bytes, name) // signature, IHDR, acTL, byte and megapixel limits
  try {
    return await decodePng(bytes, `${name}.png`, name)
  } catch {
    throw new QrPosterError('INVALID_INPUT', `Use a single-frame PNG with at most ${4_000_000 / 1e6} megapixels.`)
  }
}

/** Same whole-square constraint and module geometry as assembly; no raster rendering needed. */
export function validatePlacement({
  regionMask,
  qrMetadata,
  placement,
  settings,
}: {
  regionMask: RegionMask
  qrMetadata: QrMetadata
  placement: Placement
  settings: Settings
}) {
  const p = placeQr(regionMask, qrMetadata.totalModules, placement)
  const pitch = p.modulePixels
  /**
   * A rotated placement is validated in the QR's upright frame: the region mask is sampled into
   * the working frame, and the lattice, safe area, rim, upright plate, and pattern version all
   * see that size (doc/plan/rotated-mask-fill.md). The upright path keeps the poster canvas.
   */
  const rotated = p.rotation !== 0
  const frame = rotated ? qrWorkingFrame(p, regionPixelBounds(regionMask)) : undefined
  const canvasWidth = frame?.width ?? regionMask.width
  const canvasHeight = frame?.height ?? regionMask.height
  if (frame) assertFrameHoldsPlacement(frame, p, regionMask.width, regionMask.height)
  const origin = frame?.qr ?? { x: p.x, y: p.y }
  const mask = frame
    ? sampleMaskIntoQrFrame(regionMask.data, regionMask.width, regionMask.height, frame, p)
    : regionMask.data
  selectPatternVersion(pitch, canvasWidth, canvasHeight, pitch)
  const lattice = buildModuleLattice(canvasWidth, canvasHeight, pitch, origin)
  const safe = computeSafeArea(mask, canvasWidth, canvasHeight, lattice)
  const { margin, rim } = computeRegionBands(safe.safe, lattice, settings.rimModules, settings.regionMargin)
  const grid = {
    x: origin.x + 2 * pitch,
    y: origin.y + 2 * pitch,
    width: qrMetadata.qrModules * pitch,
    height: qrMetadata.qrModules * pitch,
  }
  const { arms, cornerBlocks } = markerBandRects(grid, qrMetadata.qrModules, pitch, settings.qrMargin)
  const corners = settings.plateCorners === 'texture'
  // Generation is upright, so rotated placements keep the 0° plate semantics: code grid plus
  // finder arms, with the corner hand-back applied in the QR's frame instead of being skipped.
  const plate = computePlateModules(
    lattice,
    [grid, ...arms, ...(corners ? [] : cornerBlocks)],
    corners ? cornerBlocks : [],
  )
  if (!safe.safe.some((cell, i) => cell && !margin[i] && !rim[i] && !plate.cells[i]))
    throw new QrPosterError(
      'QR_LAYOUT_INVALID',
      'No decorative texture fits beside this QR. Reduce its size or choose a larger region.',
    )
  return p
}

/* ------------------------------ cached stages ------------------------------ */

/** The decoded poster and its region: the expensive, source-bound half of resolveBuffers. */
export interface PreparedSource {
  poster: LoadedPng
  maskInput?: LoadedPng
  regionMask: RegionMask
}

export async function prepareSource(
  imaging: Imaging,
  posterBytes: Uint8Array,
  maskBytes?: Uint8Array,
): Promise<PreparedSource> {
  const poster = await readImage(imaging, posterBytes, 'poster')
  const maskInput = maskBytes ? await readImage(imaging, maskBytes, 'mask') : undefined
  const regionMask = maskInput
    ? buildManualRegionMask(maskInput, poster.width, poster.height)
    : detectRegionMask(poster)
  return {
    poster,
    ...(maskInput ? { maskInput } : {}),
    regionMask,
  }
}

/** The content-bound half: the generated QR, its decode round trip, and metadata. */
export interface QrBundle {
  qrSource: LoadedPng
  decoded: ResolvedLayout['decoded']
  qrMetadata: QrMetadata
}

export async function resolveQr(imaging: Imaging, input: EngineInput): Promise<QrBundle> {
  contentSchema.parse(input.content)
  const settings = { ...engineDefaults, ...input.settings }
  const palette: QrPalette = { ...engineDefaults.colors, ...settings.colors }
  const guard = paletteGuard(palette)
  if (!guard.ok)
    throw new QrPosterError(
      'COLOR_INVALID',
      `Invalid pattern colors: ${guard.issues.map((issue) => issue.message).join(' ')}`,
    )
  const generated = await generateQrFromContent(
    input.content,
    settings.ecc,
    settings.pixelStyle,
    undefined,
    undefined,
    undefined,
    settings.markerSub,
    settings.finderMarkers,
    palette,
  )
  const qrSource = generated.image
  const decoded = {
    ...decodeQrRawDetailed(qrSource.data, qrSource.width, qrSource.height),
    version: generated.version,
  }
  if (decoded.text !== input.content)
    throw new QrPosterError('QR_TEXT_MISMATCH', 'Generated QR did not preserve the entered text.')
  const qrMetadata = inspectAntfuQr(qrSource, input.content, generated.version)
  return { qrSource, decoded, qrMetadata }
}

/** Verbatim placement/recentering/fit logic from the former `resolveBuffers`. */
export function applyPlacement({
  source,
  qr,
  input,
  settings,
  unchecked = false,
}: {
  source: PreparedSource
  qr: QrBundle
  input: Pick<EngineInput, 'placement' | 'previousTotalModules'>
  settings: Settings
  unchecked?: boolean
}): { layout: ResolvedLayout; validation: string | null; bestPlacement: Placement } {
  const { regionMask } = source
  const qrMetadata = qr.qrMetadata
  const initialPlacement = suggestPlacement(regionMask, qrMetadata.totalModules)
  const previous = input.placement
  let requested = previous
  if (previous && input.previousTotalModules && input.previousTotalModules !== qrMetadata.totalModules) {
    requested = recenterPlacement(previous, input.previousTotalModules, qrMetadata.totalModules)
  }
  let validation: string | null = null
  let placement
  if (requested && unchecked) {
    placement = requested
  } else if (requested) {
    try {
      placement = validatePlacement({ regionMask, qrMetadata, placement: requested, settings })
    } catch (e) {
      validation = e instanceof Error ? e.message : 'Invalid placement.'
      placement = {
        ...requested,
        modulePixels: requested.size / qrMetadata.totalModules,
        totalModules: qrMetadata.totalModules,
        mode: 'manual' as const,
        artPaddingModules: 0,
      }
    }
  } else if (unchecked) {
    placement = {
      ...initialPlacement,
      modulePixels: initialPlacement.size / qrMetadata.totalModules,
      totalModules: qrMetadata.totalModules,
      mode: 'auto' as const,
      artPaddingModules: 0,
    }
  } else {
    const largest = placeQr(regionMask, qrMetadata.totalModules)
    for (let pitch = largest.modulePixels; pitch >= 4; pitch--) {
      try {
        const size = qrMetadata.totalModules * pitch
        const point = findClosestSquare(regionMask, size)
        placement = validatePlacement({ regionMask, qrMetadata, placement: { ...point, size, rotation: 0 }, settings })
        placement.mode = 'auto'
        break
      } catch (e) {
        if (!(e instanceof QrPosterError)) throw e
      }
    }
    if (!placement)
      throw new QrPosterError(
        'QR_LAYOUT_INVALID',
        'This region cannot fit the QR and decorative texture. Use shorter text or a larger black region.',
      )
    // Auto-place searches only upright placements.
    placement.rotation = 0
  }
  const bestPlacement = findBestInsetPlacement(regionMask, qrMetadata.totalModules, placement)
  const normalizedQr = validation ? qr.qrSource.file : undefined
  return {
    layout: {
      poster: source.poster,
      qrSource: qr.qrSource,
      qrImage: qr.qrSource,
      ...(source.maskInput ? { maskInput: source.maskInput } : {}),
      regionMask,
      decoded: qr.decoded,
      qrMetadata,
      placement,
      // Filled by the caller after any async normalize step.
      ...(normalizedQr !== undefined ? { normalizedQr } : {}),
    } as ResolvedLayout,
    validation,
    bestPlacement,
  }
}

function findBestInsetPlacement(regionMask: RegionMask, totalModules: number, fallback: Placement): Placement {
  try {
    const placement = placeQr(regionMask, totalModules)
    return { x: placement.x, y: placement.y, size: placement.size, rotation: placement.rotation }
  } catch (error) {
    if (error instanceof QrPosterError) {
      return {
        ...fallback,
        x: Math.round(regionMask.centroid.x - fallback.size / 2),
        y: Math.round(regionMask.centroid.y - fallback.size / 2),
      }
    }
    throw error
  }
}

function suggestPlacement(regionMask: RegionMask, totalModules: number): Placement {
  const bounds = regionMask.bounds
  const pitch = Math.max(4, Math.floor(Math.min(bounds.width, bounds.height) / totalModules))
  const size = pitch * totalModules
  return {
    x: Math.round(bounds.x + (bounds.width - size) / 2),
    y: Math.round(bounds.y + (bounds.height - size) / 2),
    size,
    rotation: 0,
  }
}

/** Straight composition of the three stages — the uncached path, used by tests and scripts. */
export async function resolveBuffers(imaging: Imaging, input: EngineInput) {
  const source = await prepareSource(imaging, input.posterBytes, input.maskBytes)
  const qr = await resolveQr(imaging, input)
  const settings = { ...engineDefaults, ...input.settings }
  const { layout, validation } = applyPlacement({ source, qr, input, settings })
  if (!validation) layout.normalizedQr = await normalizeQr(qr.qrSource, layout.placement.size)
  return { layout, validation }
}

export async function toPreparedPayload(
  imaging: Imaging,
  layout: ResolvedLayout,
  validation: string | null,
  palette: QrPalette = DEFAULT_PALETTE,
  bestPlacement: Placement = layout.placement,
): Promise<PreparedPayload> {
  const { poster, regionMask, qrMetadata, placement } = layout
  const overlay = new Uint8Array(poster.width * poster.height * 4)
  for (let i = 0; i < regionMask.data.length; i++) if (regionMask.data[i]) overlay.set([75, 224, 182, 95], i * 4)
  return {
    width: poster.width,
    height: poster.height,
    mask: bytesToBlob('mask.png', await renderRegionMask(regionMask)),
    overlay: bytesToBlob('overlay.png', await rgbaToPng(overlay, poster.width, poster.height)),
    // The upright reusable QR preview is independent of its editable placement size.
    qr: bytesToBlob('qr.png', await transparentQrBackground(layout.qrSource.file, palette)),
    qrMetadata: { totalModules: qrMetadata.totalModules, version: qrMetadata.version },
    placement: { x: placement.x, y: placement.y, size: placement.size, rotation: placement.rotation },
    bestPlacement,
    validation,
  }
}

/** Identical request merge and verification gate as the former `assembleFromBuffers`. */
export async function assemblePayload(
  imaging: Imaging,
  input: EngineInput & {
    placement: Placement
    seed: number
    qrMargin: 1
    plateCorners: Settings['plateCorners']
    regionMargin?: boolean
    rimModules?: number
    rimRounded?: boolean
    ecc?: Settings['ecc']
    pixelStyle?: Settings['pixelStyle']
    finderMarkers?: Settings['finderMarkers']
    markerSub?: Settings['markerSub']
    colors?: Settings['colors']
  },
): Promise<AssemblePayload> {
  const flat = {
    seed: input.seed,
    qrMargin: input.qrMargin,
    plateCorners: input.plateCorners,
    regionMargin: input.regionMargin ?? input.settings?.regionMargin ?? engineDefaults.regionMargin,
    rimModules: input.rimModules ?? input.settings?.rimModules ?? engineDefaults.rimModules,
    rimRounded: input.rimRounded ?? input.settings?.rimRounded ?? engineDefaults.rimRounded,
    ecc: input.ecc ?? input.settings?.ecc ?? engineDefaults.ecc,
    pixelStyle: input.pixelStyle ?? input.settings?.pixelStyle ?? engineDefaults.pixelStyle,
    finderMarkers: input.finderMarkers ?? input.settings?.finderMarkers ?? engineDefaults.finderMarkers,
    markerSub: input.markerSub ?? input.settings?.markerSub ?? engineDefaults.markerSub,
    colors: input.colors ?? input.settings?.colors ?? engineDefaults.colors,
  }
  const { layout, validation } = await resolveBuffers(imaging, {
    ...input,
    previousTotalModules: undefined,
    settings: flat,
  })
  if (validation) throw new QrPosterError('QR_LAYOUT_INVALID', validation)
  const result = await assembleResolved(layout, {
    seed: flat.seed,
    qrMargin: flat.qrMargin,
    radius: flat.plateCorners === 'light' ? 0 : layout.placement.modulePixels * 2,
    regionMargin: flat.regionMargin,
    rimModules: flat.rimModules,
    rimRounded: flat.rimRounded,
    pixelStyle: flat.pixelStyle,
    transparentBlank: input.transparentBlank ?? false,
    palette: flat.colors,
  })
  if (!result.report.qualified)
    throw new QrPosterError(
      'VERIFICATION_FAILED',
      `Pixel verification failed (${result.report.verification.checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', ')}). Adjust the placement and try again.`,
      4,
    )
  const artifacts = Object.fromEntries(
    Object.entries(result.artifacts).map(([name, bytes]) => [name, bytesToBlob(name, bytes)]),
  )
  artifacts['poster.svg'] = bytesToBlob(
    'poster.svg',
    new TextEncoder().encode(
      buildPosterSvg(result.artifacts['poster.png']!, layout.poster.width, layout.poster.height),
    ),
  )
  return {
    report: result.report as AssembleReport,
    artifacts,
  }
}

export async function assembleRasterVariant(
  imaging: Imaging,
  original: ResolvedLayout,
  settings: Settings,
  originalPlacement: QrPlacement,
  targetPitch: number,
  transparentBlank: boolean,
): Promise<RasterExportPayload> {
  const originalPitch = originalPlacement.modulePixels
  if (!Number.isInteger(targetPitch) || targetPitch < 4 || targetPitch >= originalPitch)
    throw new QrPosterError('INVALID_INPUT', 'Choose a smaller export with modules of at least 4px.')

  const dimensions = dimensionsAtPitch(original.poster.width, original.poster.height, originalPitch, targetPitch)
  const regionMask = resizeRegionMaskConservative(original.regionMask, dimensions.width, dimensions.height)
  const scale = targetPitch / originalPitch
  const size = original.qrMetadata.totalModules * targetPitch
  const requested = {
    x: Math.round((originalPlacement.x + originalPlacement.size / 2) * scale - size / 2),
    y: Math.round((originalPlacement.y + originalPlacement.size / 2) * scale - size / 2),
    size,
    rotation: originalPlacement.rotation,
  }
  const placement = validatePlacement({ regionMask, qrMetadata: original.qrMetadata, placement: requested, settings })
  const posterData = resizeAreaPremultiplied(original.poster, dimensions.width, dimensions.height)
  const posterFile = await imaging.encodePngRgba(posterData, dimensions.width, dimensions.height)
  const poster = {
    path: `poster-${dimensions.width}x${dimensions.height}.png`,
    file: posterFile,
    data: posterData,
    ...dimensions,
    sha256: await imaging.sha256Hex(posterFile),
  }
  const normalizedQr = await normalizeQr(original.qrSource, size)
  const { maskInput: _maskInput, ...withoutMaskInput } = original
  const layout: ResolvedLayout = {
    ...withoutMaskInput,
    poster,
    regionMask,
    placement,
    normalizedQr,
  }
  const result = await assembleResolved(layout, {
    seed: settings.seed,
    qrMargin: settings.qrMargin,
    radius: settings.plateCorners === 'light' ? 0 : targetPitch * 2,
    regionMargin: settings.regionMargin,
    rimModules: settings.rimModules,
    rimRounded: settings.rimRounded,
    pixelStyle: settings.pixelStyle,
    transparentBlank,
    palette: settings.colors,
  })
  if (!result.report.qualified)
    throw new QrPosterError('VERIFICATION_FAILED', 'This raster size did not pass pixel verification.', 4)
  const png = result.artifacts['poster.png']!
  return {
    poster: bytesToBlob(`poster-${dimensions.width}x${dimensions.height}.png`, png),
    ...dimensions,
    modulePixels: targetPitch,
    bytes: png.byteLength,
  }
}
