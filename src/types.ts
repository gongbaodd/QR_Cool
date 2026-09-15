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
  name: 'sourceQr' | 'normalizedQr' | 'beforeAi' | 'halfScale' | 'jpeg80' | 'poster' | 'posterHalfScale' | 'posterJpeg80' | 'outsideRegionPixels' | 'qrPixels'
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
