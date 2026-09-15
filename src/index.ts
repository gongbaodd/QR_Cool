export { compositePoster } from './composite.js'
export { QrPosterError } from './errors.js'
export { buildManualRegionMask, detectRegionMask } from './mask.js'
export { boxIsInsideMask, placeQr } from './placement.js'
export { preparePoster } from './prepare.js'
export { decodeQrBuffer, decodeQrRaw, decodeQrRawDetailed, inspectAntfuQr, normalizeQr } from './qr.js'
export type {
  BoundingBox,
  CompositePosterInputs,
  PreparePosterOptions,
  PrepareResult,
  QrBoxInput,
  QrMetadata,
  QrPlacement,
  RegionMask,
  ReportV1,
  VerificationResult,
} from './types.js'

export { generatePoster } from './generate.js'
export type { GeneratePosterOptions, GenerateResult, ReportV2 } from './types.js'
