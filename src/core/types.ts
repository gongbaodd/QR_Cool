import type { LoadedPng } from './image'
import type { DecodedQr } from './qr'

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
  /** Extra decorative modules reserved around the QR; retained for report compatibility. */
  artPaddingModules: number
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
    | 'moduleCut'
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

export interface PosterInputOptions {
  inputPath: string
  outputDir: string
  maskPath?: string
  qrBox?: QrBoxInput
  force?: boolean
}

/** Generate a QR from content, or retain the legacy QR PNG input for programmatic callers. */
export type QrInputOptions =
  | { content: string; qrPath?: never; expectedText?: never }
  | { content?: never; qrPath: string; expectedText?: string }

export type PreparePosterOptions = PosterInputOptions &
  QrInputOptions & {
    dryRun: true
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

export type GeneratePosterOptions = PosterInputOptions &
  QrInputOptions & {
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
  artifacts: ReportV1['artifacts'] & {
    aiRaw?: string
    poster?: string
    patternReference?: string
    referenceCanvas?: string
  }
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

export type PatternPreviewOptions = PosterInputOptions &
  QrInputOptions & {
    /** Module pitch in poster pixels; defaults to the pitch the pipeline places on the poster. */
    modulePixels?: number
    /** Seed for the random text line; defaults to a fresh random seed per run. */
    seed?: number
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
    pixelStyle: 'square' | 'rounded' | 'dot'
    removedTypes: Array<'Position' | 'Alignment'>
    /** Dropped marker cells are refilled with seeded random bits, never left light. */
    markerRefill: 'seeded-random'
    refilledModules: number
    codeSize: number
    canvas: ImageDimensions
    crop: { left: number; top: number }
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
    pattern: { path: string; sha256: string; width: number; height: number }
    mask: { path: string; sha256: string; width: number; height: number }
  }
  cut: {
    radius: number
    smoothTolerance: number
    /** A mask pixel selects the shape when it is transparent or dark. */
    keep: 'transparent-or-dark'
    minLoopArea: number
    /** Solid black band retained inside the letter outline, in pixels. */
    borderWidth: number
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

export type AssemblePosterOptions = PosterInputOptions &
  QrInputOptions & {
    /** Seed for the pattern random text line and the marker refill; defaults to a fresh seed per run. */
    seed?: number
    /** Depth of the light band kept beside each finder marker: one whole module. */
    qrMargin?: 1
    /**
     * Plate corner treatment: zero keeps the diagonal corner block beside each finder marker light,
     * and any positive value hands those three blocks to the texture. Defaults to two module pitches
     * (12px on the bundled version-5 fixture), which rounds the plate. The region silhouette is always
     * whole modules, so there is no fillet to size.
     */
    radius?: number
    /** Outer dark rim thickness in modules, 0 disables the rim. Range 0-5. */
    rimModules?: number
    /** When true the rim's outer corners are rounded with antialiased edges. */
    rimRounded?: boolean
    /** Not used by assembly: the cut is module-aligned rather than traced. Rejected when supplied. */
    smoothTolerance?: number
  }

export interface AssembleReport {
  schemaVersion: 8
  mode: 'assemble'
  status: 'generated' | 'verification_failed'
  qualified: boolean
  createdAt: string
  durationMs: number
  inputs: ReportV1['inputs']
  region: ReportV1['region']
  qr: ReportV1['qr'] & {
    /** The pixels actually composited: the code grid plus the light band beside the markers. */
    overlay: {
      /** The light band is kept beside the finder markers only. */
      band: 'markers'
      /** Depth of the light band beside each marker, in modules. */
      quietZoneModules: number
      /** Finder footprint each band arm spans, in modules. */
      markerModules: number
      /** Crop of the normalized QR the plate copies verbatim: the code grid, no quiet zone. */
      crop: { left: number; top: number; size: number }
      x: number
      y: number
    }
  }
  placement: QrPlacement
  pattern: PatternReport['pattern'] & {
    /**
     * The texture window is phase-locked to the placed QR, so both share one module lattice.
     * `phase` is the residual offset of the texture's module boundaries from the QR lattice:
     * `0,0` means they coincide.
     */
    alignment: {
      alignedToQr: boolean
      phase: { x: number; y: number }
    }
  }
  cut: {
    /** Poster-space module pitch the cut is quantized to; equals the placed QR pitch. */
    modulePixels: number
    /** Poster-space origin of the module lattice, in `[0, modulePixels)`. */
    lattice: { x: number; y: number }
    /** Requested `--cut-radius`; zero leaves the plate square, a positive value rounds it. */
    radius: number
    /** Modules whose whole pixel block is inside the painted region. */
    safeModules: number
    /** Modules the region covers only in part; the cut leaves them as the original artwork. */
    droppedPartialModules: number
    /** Region pixels inside those dropped modules. */
    droppedPartialPixels: number
    /** Modules the cut draws: safe modules minus the QR plate hole. */
    drawnModules: number
    /** Outer rings of drawn modules forced dark; rounded is antialiased. */
    rim: { modules: number; style: 'cell' | 'rounded-antialiased' }
    /** Modules of the plate handed back to the texture: the diagonal block at each marker corner. */
    plateCornerModules: number
    /** The cut shape is the detected or supplied painted region itself. */
    keep: 'region-mask'
    /** Whole modules replace the original pixels; antialiased blends the edge. */
    edgeBlend: 'cell-aligned-over-original' | 'antialiased'
  }
  /** The plate the texture is cut around and the QR is drawn in; all of it is whole modules. */
  qrPlate: {
    /** The light band is kept beside the finder markers only, never around the whole code. */
    band: 'markers'
    /** Depth of the light band beside each marker: one whole module. */
    marginModules: 1
    /** The band actually painted, in pixels: `marginModules * modulePixels`. */
    marginPixels: number
    /** Finder footprint each band arm spans, in modules. */
    markerModules: number
    /** Light cells the band keeps beside the three markers, corner blocks included. */
    bandCells: number
    /** The code grid the plate copies verbatim; the band sits outside it. */
    box: BoundingBox
    /** Modules the hole covers: code grid plus band, corner blocks already handed back. */
    holeModules: number
    /** Modules handed back to the texture, 0 when `--cut-radius` is zero. */
    cornerModules: number
    /** Pixels those modules leave as texture instead of the QR's own light band. */
    cornerTexturePixels: number
  }
  shape: {
    /** Canvas-pixel bounds of the drawn modules. */
    bounds: BoundingBox
    /** Pixels the drawn modules cover: texture plus rim. */
    area: number
    /** Modules the cut draws. */
    modules: number
    /** Drawn modules forced dark as the rim. */
    rimModules: number
    /** Drawn modules carrying the texture. */
    textureModules: number
  }
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
