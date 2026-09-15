import { QrPosterError } from './errors.js'
import { loadPng } from './image.js'
import type { LoadedPng } from './image.js'
import { buildManualRegionMask, detectRegionMask } from './mask.js'
import { placeQr } from './placement.js'
import { decodeQrRawDetailed, inspectAntfuQr, normalizeQr, resolveQrSource } from './qr.js'
import type { DecodedQr } from './qr.js'
import type { QrBoxInput, QrMetadata, QrPlacement, RegionMask } from './types.js'

export interface LayoutInput {
  inputPath: string
  qrPath: string
  maskPath?: string
  qrBox?: QrBoxInput
  expectedText?: string
}

export interface ResolvedLayout {
  /** The poster exactly as supplied. */
  poster: LoadedPng
  /** The QR file exactly as supplied, kept for input reporting. */
  qrSource: LoadedPng
  /** The QR image placement uses: the input, or a code grid re-padded with a quiet zone. */
  qrImage: LoadedPng
  maskInput?: LoadedPng
  regionMask: RegionMask
  decoded: DecodedQr
  qrMetadata: QrMetadata
  placement: QrPlacement
  normalizedQr: Buffer
}

/**
 * Resolves everything a poster mode needs before it draws: the detected or supplied painted region,
 * the decoded QR, its metadata, the placement box, and the normalized QR that is overlaid verbatim.
 */
export async function resolveLayout(options: LayoutInput): Promise<ResolvedLayout> {
  const poster = await loadPng(options.inputPath, 'poster input')
  const qrSource = await loadPng(options.qrPath, 'QR input')
  const maskInput = options.maskPath ? await loadPng(options.maskPath, 'region mask') : undefined
  const regionMask = maskInput
    ? buildManualRegionMask(maskInput, poster.width, poster.height)
    : detectRegionMask(poster)

  const decoded = decodeQrRawDetailed(qrSource.data, qrSource.width, qrSource.height)
  if (options.expectedText !== undefined && decoded.text !== options.expectedText) {
    throw new QrPosterError(
      'QR_TEXT_MISMATCH',
      `QR content does not match --text. Decoded ${JSON.stringify(decoded.text)}.`,
    )
  }

  const resolved = await resolveQrSource(qrSource, decoded.version)
  const qrMetadata = inspectAntfuQr(resolved.image, decoded.text, decoded.version)
  if (resolved.quietZoneSource === 'added')
    qrMetadata.quietZoneSource = 'added'
  if (resolved.trim)
    qrMetadata.sourceTrim = resolved.trim

  const placement = placeQr(regionMask, qrMetadata.totalModules, options.qrBox)
  const normalizedQr = await normalizeQr(resolved.image, placement.size)
  return {
    poster,
    qrSource,
    qrImage: resolved.image,
    ...(maskInput ? { maskInput } : {}),
    regionMask,
    decoded,
    qrMetadata,
    placement,
    normalizedQr,
  }
}
