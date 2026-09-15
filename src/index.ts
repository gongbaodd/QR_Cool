export { compositePoster } from './composite.js'
export { QrPosterError } from './errors.js'
export { buildManualRegionMask, detectRegionMask } from './mask.js'
export { boxIsInsideMask, placeQr } from './placement.js'
export { preparePoster } from './prepare.js'
export { decodeQrBuffer, decodeQrRaw, decodeQrRawDetailed, generateQrFromContent, inspectAntfuQr, normalizeQr, resolveQrSource } from './qr.js'
export type { DecodedQr, GeneratedQr, ResolvedQrSource } from './qr.js'
export type {
  BoundingBox,
  CompositePosterInputs,
  PreparePosterOptions,
  PrepareResult,
  PosterInputOptions,
  QrBoxInput,
  QrInputOptions,
  QrMetadata,
  QrPlacement,
  QrSourceTrim,
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
  PATTERN_QUIET_ZONE_MODULES,
  buildPosterPattern,
  countMarkerModules,
  createPatternText,
  generatePatternPreview,
  renderRoundedPattern,
  renderPosterPattern,
  selectPatternVersion,
  stripMarkerModules,
} from './pattern.js'
export type {
  PatternRenderOptions,
  PatternRenderWindow,
  PosterPattern,
  PosterPatternLattice,
  PosterPatternOptions,
} from './pattern.js'
export type { PatternPreviewOptions, PatternPreviewResult, PatternReport } from './types.js'

export {
  CUT_KEEP_RULE,
  CUT_RADIUS,
  CUT_SMOOTH_TOLERANCE,
  buildCutPath,
  buildCutSvg,
  buildShapeSelection,
  cleanMaskSelection,
  collapseCollinearPoints,
  cutMinLoopArea,
  filletLoop,
  generatePatternCut,
  polygonArea,
  renderCutBorderCoverage,
  renderCutCoverage,
  renderCutPng,
  simplifyClosedLoop,
  traceMaskContours,
} from './pattern-cut.js'
export type { CutPath, CutPathOptions, CutPathStats, CutSvgOptions } from './pattern-cut.js'
export type { PatternCutOptions, PatternCutReport, PatternCutResult } from './types.js'

export { assemblePoster } from './assemble.js'
export type { AssemblePosterOptions, AssembleReport, AssembleResult } from './types.js'

export {
  buildModuleLattice,
  buildModulePath,
  computePlateModules,
  computeRimModules,
  computeSafeArea,
  moduleBlock,
  moduleCellIndex,
  renderModuleCoverage,
} from './module-cut.js'
export type { ModuleLattice, ModuleWindow, PlateModules, SafeArea } from './module-cut.js'
