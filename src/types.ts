export interface ImageDimensions {
  width: number
  height: number
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface RegionMask extends ImageDimensions {
  /** Row-major binary coverage: 0 is outside, 255 is inside M. */
  data: Uint8Array
  source: 'auto' | 'file'
  area: number
  bounds: BoundingBox
  centroid: Point
  detection?: {
    strongBlackThreshold: number
    tolerantLumaThreshold: number
    separationRadius: number
    densityThreshold: number
    candidateAreas: number[]
    dominanceRatio: number | null
  }
}

export interface QrMetadata extends ImageDimensions {
  decodedText: string
  version: number
  qrModules: number
  quietZoneModules: 2
  totalModules: number
  sourceModulePixels: number
  quietZoneLightRatio: number
  /** `added` when the input was a bare code grid and the two-module margin was rebuilt locally. */
  quietZoneSource?: 'added'
  /** Trimmed-away margin of a code-grid input, in source pixels. */
  sourceTrim?: QrSourceTrim
}

export interface QrSourceTrim {
  left: number
  top: number
  right: number
  bottom: number
  modulePixels: number
}

export interface QrPlacement {
  x: number
  y: number
  size: number
  modulePixels: number
  totalModules: number
  mode: 'auto' | 'manual'
  artPaddingModules: number
}

export interface VerificationCheck {
  name:
    | 'sourceQr'
    | 'normalizedQr'
    | 'beforeAi'
    | 'halfScale'
    | 'jpeg80'
    | 'poster'
    | 'posterHalfScale'
    | 'posterJpeg80'
    | 'outsideRegionPixels'
    | 'qrPixels'
    | 'qrPlateCorners'
    | 'alphaPreserved'
  passed: boolean
  decodedText?: string
  decoder?: 'zxing' | 'jsqr'
  version?: number
  error?: string
}

export interface VerificationResult {
  expectedText: string
  checks: VerificationCheck[]
  qualified: boolean
  /** Checks that a mode deliberately does not run, so a qualified report stays honest. */
  skippedChecks?: VerificationCheck['name'][]
}

export interface ReportV1 {
  schemaVersion: 1
  status: 'prepared' | 'verification_failed'
  qualified: boolean
  dryRun: true
  createdAt: string
  durationMs: number
  inputs: {
    poster: { path: string; sha256: string; width: number; height: number }
    qr: { path: string; sha256: string; width: number; height: number }
    mask?: { path: string; sha256: string }
  }
  region: {
    source: 'auto' | 'file'
    area: number
    bounds: BoundingBox
    centroid: Point
    detection?: RegionMask['detection']
  }
  qr: QrMetadata & {
    normalizedSize: number
    normalizedModulePixels: number
  }
  placement: QrPlacement
  artifacts: Record<'regionMask' | 'qr' | 'layoutPreview' | 'editMask' | 'beforeAi', string>
  verification: VerificationResult
  warnings: string[]
}

export interface QrBoxInput {
  x: number
  y: number
  size: number
}

export interface PreparePosterOptions {
  inputPath: string
  qrPath: string
  outputDir: string
  dryRun: true
  expectedText?: string
  maskPath?: string
  qrBox?: QrBoxInput
  force?: boolean
}

export interface PrepareResult {
  report: ReportV1
  outputDir: string
}

export interface CompositePosterInputs {
  original: Buffer
  generated: Buffer
  regionMask: RegionMask
  qr: Buffer
  placement: QrPlacement
}

export interface GeneratePosterOptions extends Omit<PreparePosterOptions, 'dryRun'> {
  apiKey?: string
  baseUrl?: string
  model?: string
  prompt?: string
  generatedImagePath?: string
}

export interface ReportV2 extends Omit<ReportV1, 'schemaVersion' | 'status' | 'dryRun' | 'artifacts'> {
  schemaVersion: 2
  status: 'generated' | 'verification_failed' | 'generation_failed'
  dryRun: false
  artifacts: ReportV1['artifacts'] & { aiRaw?: string; poster?: string; patternReference?: string; referenceCanvas?: string }
  generation: {
    source: 'qwen' | 'file'
    model: string
    prompt: string
    canvas: ImageDimensions
    durationMs: number
    requestId?: string
    usage?: unknown
    error?: string
  }
  phoneScan: 'untested'
}

export interface GenerateResult {
  report: ReportV2
  outputDir: string
}

export interface PatternPreviewOptions {
  inputPath: string
  qrPath: string
  outputDir: string
  /** Module pitch in poster pixels; defaults to the pitch the pipeline places on the poster. */
  modulePixels?: number
  /** Seed for the random text line; defaults to a fresh random seed per run. */
  seed?: number
  maskPath?: string
  qrBox?: QrBoxInput
  expectedText?: string
  force?: boolean
}

export interface PatternReport {
  schemaVersion: 3
  mode: 'pattern-preview'
  status: 'generated'
  createdAt: string
  durationMs: number
  inputs: ReportV1['inputs']
  region: ReportV1['region']
  placement: QrPlacement
  pitchSource: 'placement' | 'override'
  pattern: {
    seed: number
    alphabet: string
    textLength: number
    textSha256: string
    ecc: 'M'
    version: number
    qrModules: number
    quietZoneModules: 2
    totalModules: number
    modulePixels: number
    pixelStyle: 'rounded'
    removedTypes: Array<'Position' | 'Alignment'>
    /** Dropped marker cells are refilled with seeded random bits, never left light. */
    markerRefill: 'seeded-random'
    refilledModules: number
    codeSize: number
    canvas: ImageDimensions
    crop: { left: number, top: number }
  }
  artifacts: {
    pattern: string
    patternSha256: string
  }
  warnings: string[]
}

export interface PatternPreviewResult {
  report: PatternReport
  outputDir: string
}

export interface PatternCutOptions {
  /** Rendered pattern PNG to cut, poster-sized. */
  inputPath: string
  /** Same-size mask PNG: transparent or dark pixels select the cut shape. */
  maskPath: string
  outputDir: string
  /** Corner fillet radius in pixels; defaults to 5. */
  radius?: number
  /** Douglas-Peucker tolerance in pixels for the traced outline; defaults to 3. */
  smoothTolerance?: number
  force?: boolean
}

export interface PatternCutReport {
  schemaVersion: 4
  mode: 'pattern-cut'
  status: 'generated'
  createdAt: string
  durationMs: number
  inputs: {
    pattern: { path: string, sha256: string, width: number, height: number }
    mask: { path: string, sha256: string, width: number, height: number }
  }
  cut: {
    radius: number
    smoothTolerance: number
    /** A mask pixel selects the shape when it is transparent or dark. */
    keep: 'transparent-or-dark'
    minLoopArea: number
  }
  shape: {
    loopsTraced: number
    loopsKept: number
    specksDropped: number
    verticesTraced: number
    verticesSimplified: number
    holes: number
    /** Area of the simplified cut polygon before corner rounding. */
    area: number
    radiusClamped: boolean
    bounds: BoundingBox
  }
  artifacts: {
    svg: string
    svgSha256: string
    png: string
    pngSha256: string
  }
  warnings: string[]
}

export interface PatternCutResult {
  report: PatternCutReport
  outputDir: string
}

export interface AssemblePosterOptions {
  inputPath: string
  qrPath: string
  outputDir: string
  expectedText?: string
  maskPath?: string
  qrBox?: QrBoxInput
  /** Seed for the pattern random text line; defaults to a fresh random seed per run. */
  seed?: number
  /** Corner fillet radius for the cut edge in pixels; defaults to two module pitches (10px here). */
  radius?: number
  /** Douglas-Peucker tolerance for the cut outline in pixels; defaults to one module pitch (5px here). */
  smoothTolerance?: number
  force?: boolean
}

export interface AssembleReport {
  schemaVersion: 6
  mode: 'assemble'
  status: 'generated' | 'verification_failed'
  qualified: boolean
  createdAt: string
  durationMs: number
  inputs: ReportV1['inputs']
  region: ReportV1['region']
  qr: ReportV1['qr'] & {
    /** The pixels actually composited: the code grid plus a one-module light margin. */
    overlay: {
      quietZoneModules: 1
      crop: { left: number, top: number, size: number }
      x: number
      y: number
    }
  }
  placement: QrPlacement
  pattern: PatternReport['pattern'] & {
    /** The texture window is phase-locked to the placed QR, so both share one module lattice. */
    alignment: {
      alignedToQr: boolean
      phase: { x: number, y: number }
    }
  }
  cut: {
    radius: number
    smoothTolerance: number
    /** Disc radius of the mask cleanup applied before tracing, in pixels. */
    cleanRadius: number
    /** Pure-black band drawn along the inside of the cut edge. */
    border: {
      width: number
      color: '#000000'
      side: 'inside'
    }
    /** The cut shape is the detected or supplied painted region itself. */
    keep: 'region-mask'
    minLoopArea: number
    /** The cut edge is blended into the original pixels by its coverage; nothing outside the region changes. */
    edgeBlend: 'coverage-over-original'
  }
  /** The rounded white plate the texture is cut around and the QR is drawn in. */
  qrPlate: {
    /** Light margin modules kept around the code grid inside the plate. */
    marginModules: 1
    /** Corner radius of the plate in pixels; follows the effective `--cut-radius`. */
    radius: number
    path: 'rounded-rect'
    box: BoundingBox
    /** Window pixels the rounding leaves as texture instead of the QR's own light margin. */
    cornerTexturePixels: number
  }
  shape: PatternCutReport['shape']
  artifacts: {
    poster: string
    posterSha256: string
    regionMask: string
    qr: string
    qrSha256: string
    patternCutPng: string
    patternCutPngSha256: string
    patternCutSvg: string
    patternCutSvgSha256: string
  }
  verification: VerificationResult
  phoneScan: 'untested'
  warnings: string[]
}

export interface AssembleResult {
  report: AssembleReport
  outputDir: string
}
