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
  name: 'sourceQr' | 'normalizedQr' | 'beforeAi' | 'halfScale' | 'jpeg80'
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
