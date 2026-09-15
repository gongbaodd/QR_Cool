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

export {
  PATTERN_ALPHABET,
  PATTERN_ECC,
  PATTERN_MARKER_REFILL,
  PATTERN_PIXEL_STYLE,
  countMarkerModules,
  createPatternText,
  generatePatternPreview,
  renderRoundedPattern,
  selectPatternVersion,
  stripMarkerModules,
} from './pattern.js'
export type { PatternRenderOptions, PatternRenderWindow } from './pattern.js'
export type { PatternPreviewOptions, PatternPreviewResult, PatternReport } from './types.js'

export {
  CUT_KEEP_RULE,
  CUT_RADIUS,
  CUT_SMOOTH_TOLERANCE,
  buildCutPath,
  buildCutSvg,
  buildShapeSelection,
  collapseCollinearPoints,
  filletLoop,
  generatePatternCut,
  polygonArea,
  renderCutPng,
  simplifyClosedLoop,
  traceMaskContours,
} from './pattern-cut.js'
export type { CutPath, CutPathOptions, CutPathStats } from './pattern-cut.js'
export type { PatternCutOptions, PatternCutReport, PatternCutResult } from './types.js'
