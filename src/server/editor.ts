import sharp from 'sharp'
import { assembleResolved, markerBandRects } from '../assemble.js'
import { renderRegionMask } from '../artifacts.js'
import { decodePng, rgbaToPng } from '../image.js'
import { buildManualRegionMask, detectRegionMask } from '../mask.js'
import { placeQr, findClosestSquare } from '../placement.js'
import { generateQrFromContent, decodeQrRawDetailed, inspectAntfuQr, normalizeQr } from '../qr.js'
import { buildModuleLattice, computeSafeArea, computePlateModules, computeRimModules } from '../module-cut.js'
import { selectPatternVersion } from '../pattern.js'
import { QrPosterError } from '../errors.js'
import { MAX_IMAGE_BYTES, MAX_PIXELS, contentSchema } from '../lib/editor/schema.js'
import type { Placement, Settings } from '../lib/editor/schema.js'
import type { QrMetadata, RegionMask } from '../types.js'
import type { ResolvedLayout } from '../layout.js'

export interface BufferInput { posterBytes: Buffer; content: string; maskBytes?: Buffer; placement?: Placement; previousTotalModules?: number | undefined; settings?: Settings }
export class InputError extends Error {
  constructor(public code: string, message: string, public status: number, public field?: string) { super(message) }
}
export async function readImage(bytes: Buffer, name: string) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new InputError('UPLOAD_LIMIT', 'Each PNG must be 10 MiB or smaller.', 413, name)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new InputError('PNG_INVALID', 'Choose a valid PNG image.', 422, name)
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: true }).metadata()
    if (meta.format !== 'png' || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw new Error('format')
    if (meta.width * meta.height > MAX_PIXELS) throw new Error('limit')
    return await decodePng(bytes, `${name}.png`, name)
  } catch { throw new InputError('PNG_INVALID', `Use a single-frame PNG with at most ${MAX_PIXELS / 1e6} megapixels.`, 422, name) }
}

/** Same whole-square constraint and module geometry as assembly; no raster rendering needed. */
export function validatePlacement({ regionMask, qrMetadata, placement, settings }: { regionMask: RegionMask; qrMetadata: QrMetadata; placement: Placement; settings: Settings }) {
  const p = placeQr(regionMask, qrMetadata.totalModules, placement)
  const pitch = p.modulePixels
  selectPatternVersion(pitch, regionMask.width, regionMask.height, pitch)
  const lattice = buildModuleLattice(regionMask.width, regionMask.height, pitch, p)
  const safe = computeSafeArea(regionMask.data, regionMask.width, regionMask.height, lattice)
  const rim = computeRimModules(safe.safe, lattice, 4)
  const grid = { x: p.x + 2 * pitch, y: p.y + 2 * pitch, width: qrMetadata.qrModules * pitch, height: qrMetadata.qrModules * pitch }
  const { arms, cornerBlocks } = markerBandRects(grid, qrMetadata.qrModules, pitch, settings.qrMargin)
  const corners = settings.plateCorners === 'texture'
  const plate = computePlateModules(lattice, [grid, ...arms, ...(corners ? [] : cornerBlocks)], corners ? cornerBlocks : [])
  if (!safe.safe.some((cell, i) => cell && !rim[i] && !plate.cells[i])) throw new QrPosterError('QR_LAYOUT_INVALID', 'No decorative texture fits beside this QR. Reduce its size or choose a larger region.')
  return p
}
const defaults: Settings = { seed: 0, qrMargin: 1, plateCorners: 'texture' }
async function resolveBuffers(input: BufferInput): Promise<{ layout: ResolvedLayout; validation: string | null }> {
  contentSchema.parse(input.content)
  const poster = await readImage(input.posterBytes, 'poster')
  const maskInput = input.maskBytes ? await readImage(input.maskBytes, 'mask') : undefined
  const regionMask = maskInput ? buildManualRegionMask(maskInput, poster.width, poster.height) : detectRegionMask(poster)
  const generated = await generateQrFromContent(input.content)
  const qrSource = generated.image
  const decoded = { ...decodeQrRawDetailed(qrSource.data, qrSource.width, qrSource.height), version: generated.version }
  if (decoded.text !== input.content) throw new QrPosterError('QR_TEXT_MISMATCH', 'Generated QR did not preserve the entered text.')
  const qrMetadata = inspectAntfuQr(qrSource, input.content, generated.version)
  const settings = input.settings ?? defaults
  let requested = input.placement
  if (requested && input.previousTotalModules && input.previousTotalModules !== qrMetadata.totalModules) {
    const size = Math.max(4, Math.round(requested.size / input.previousTotalModules)) * qrMetadata.totalModules
    requested = { x: Math.round(requested.x + (requested.size - size) / 2), y: Math.round(requested.y + (requested.size - size) / 2), size }
  }
  let validation: string | null = null
  let placement
  if (requested) {
    try { placement = validatePlacement({ regionMask, qrMetadata, placement: requested, settings }) }
    catch (e) {
      validation = e instanceof Error ? e.message : 'Invalid placement.'
      placement = { ...requested, modulePixels: requested.size / qrMetadata.totalModules, totalModules: qrMetadata.totalModules, mode: 'manual' as const, artPaddingModules: 0 }
    }
  } else {
    const largest = placeQr(regionMask, qrMetadata.totalModules)
    for (let pitch = largest.modulePixels; pitch >= 4; pitch--) {
      try {
        const size = qrMetadata.totalModules * pitch
        const point = findClosestSquare(regionMask, size)
        placement = validatePlacement({ regionMask, qrMetadata, placement: { ...point, size }, settings })
        placement.mode = 'auto'
        break
      } catch (e) { if (!(e instanceof QrPosterError)) throw e }
    }
    if (!placement) throw new QrPosterError('QR_LAYOUT_INVALID', 'This region cannot fit the QR and decorative texture. Use shorter text or a larger black region.')
  }
  const normalizedQr = validation ? qrSource.file : await normalizeQr(qrSource, placement.size)
  return { layout: { poster, qrSource, qrImage: qrSource, ...(maskInput ? { maskInput } : {}), regionMask, decoded, qrMetadata, placement, normalizedQr }, validation }
}
export async function prepareEditor(input: BufferInput) {
  const { layout, validation } = await resolveBuffers(input)
  const { poster, regionMask, qrMetadata, placement, normalizedQr } = layout
  const overlay = new Uint8Array(poster.width * poster.height * 4)
  for (let i = 0; i < regionMask.data.length; i++) if (regionMask.data[i]) overlay.set([75, 224, 182, 95], i * 4)
  return { width: poster.width, height: poster.height, mask: (await renderRegionMask(regionMask)).toString('base64'), overlay: (await rgbaToPng(overlay, poster.width, poster.height)).toString('base64'), qr: normalizedQr.toString('base64'), qrMetadata, placement: { x: placement.x, y: placement.y, size: placement.size }, validation }
}
export async function assembleFromBuffers(input: BufferInput & { placement: Placement; seed: number; qrMargin: 1 | 2; plateCorners: Settings['plateCorners'] }) {
  const { layout, validation } = await resolveBuffers({ ...input, previousTotalModules: undefined, settings: { seed: input.seed, qrMargin: input.qrMargin, plateCorners: input.plateCorners } })
  if (validation) throw new QrPosterError('QR_LAYOUT_INVALID', validation)
  const result = await assembleResolved(layout, { seed: input.seed, qrMargin: input.qrMargin, radius: input.plateCorners === 'light' ? 0 : layout.placement.modulePixels * 2 })
  if (!result.report.qualified) throw new QrPosterError('VERIFICATION_FAILED', `Pixel verification failed (${result.report.verification.checks.filter(c => !c.passed).map(c => c.name).join(', ')}). Adjust the placement and try again.`, 4)
  return result
}
