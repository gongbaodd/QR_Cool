import { QrPosterError } from './errors.js'
import { loadPng } from './image.js'
import type { LoadedPng } from './image.js'
import { buildManualRegionMask, detectRegionMask } from './mask.js'
import { placeQr } from './placement.js'
import {
  decodeQrRawDetailed,
  generateQrFromContent,
  inspectAntfuQr,
  normalizeQr,
  resolveQrSource,
} from './qr.js'
import type { DecodedQr } from './qr.js'
import type { QrBoxInput, QrInputOptions, QrMetadata, QrPlacement, RegionMask } from './types.js'

export type LayoutInput = QrInputOptions & {
  inputPath: string
  maskPath?: string
  qrBox?: QrBoxInput
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
  const hasContent = typeof options.content === 'string'
  const hasQrPath = typeof options.qrPath === 'string'
  if (hasContent === hasQrPath) {
    throw new QrPosterError(
      'INVALID_INPUT',
      'Supply exactly one QR source: content or qrPath.',
    )
  }
  if (hasContent && options.expectedText !== undefined)
    throw new QrPosterError('INVALID_INPUT', 'expectedText is only valid with qrPath.')

  const poster = await loadPng(options.inputPath, 'poster input')
  const generated = hasContent ? await generateQrFromContent(options.content!) : undefined
  const qrSource = generated?.image ?? await loadPng(options.qrPath!, 'QR input')
  const maskInput = options.maskPath ? await loadPng(options.maskPath, 'region mask') : undefined
  const regionMask = maskInput
    ? buildManualRegionMask(maskInput, poster.width, poster.height)
    : detectRegionMask(poster)

  const decodedResult = decodeQrRawDetailed(qrSource.data, qrSource.width, qrSource.height)
  const decoded: DecodedQr = generated && decodedResult.version === undefined
    ? { ...decodedResult, version: generated.version }
    : decodedResult
  if (options.expectedText !== undefined && decoded.text !== options.expectedText) {
    throw new QrPosterError(
      'QR_TEXT_MISMATCH',
      `QR content does not match --text. Decoded ${JSON.stringify(decoded.text)}.`,
    )
  }

  const resolved = generated
    ? { source: qrSource, image: qrSource, quietZoneSource: 'source' as const }
    : await resolveQrSource(qrSource, decoded.version)
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
