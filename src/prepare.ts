import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { renderBeforeAi, renderEditMask, renderLayoutPreview, renderRegionMask } from './artifacts.js'
import { QrPosterError } from './errors.js'
import { resolveLayout } from './layout.js'
import { verifyQrVariant } from './qr.js'
import type { PreparePosterOptions, PrepareResult, ReportV1, VerificationCheck } from './types.js'

const ARTIFACT_NAMES = {
  regionMask: 'region-mask.png',
  qr: 'qr.png',
  layoutPreview: 'layout-preview.png',
  editMask: 'edit-mask.png',
  beforeAi: 'before-ai.png',
  report: 'report.json',
} as const

export async function preparePoster(options: PreparePosterOptions): Promise<PrepareResult> {
  try {
    return await preparePosterImpl(options)
  }
  catch (error) {
    if (error instanceof QrPosterError)
      throw error
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      error instanceof Error ? error.message : 'Image processing failed.',
      3,
      { cause: error },
    )
  }
}

async function preparePosterImpl(options: PreparePosterOptions): Promise<PrepareResult> {
  const startedAt = Date.now()
  if (!options.dryRun)
    throw new QrPosterError('INVALID_INPUT', 'This version only supports --dry-run.')

  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const { poster, qrSource, maskInput, regionMask, decoded: decodedSource, qrMetadata, placement, normalizedQr }
    = await resolveLayout(options)
  const decodedText = decodedSource.text

  const sourceCheck: VerificationCheck = {
    name: 'sourceQr',
    passed: true,
    decodedText,
    decoder: decodedSource.decoder,
    ...(decodedSource.version !== undefined ? { version: decodedSource.version } : {}),
  }
  const normalizedCheck = await verifyQrVariant('normalizedQr', normalizedQr, decodedText)
  const beforeAi = await renderBeforeAi(poster, normalizedQr, placement)
  const beforeAiCheck = await verifyQrVariant('beforeAi', beforeAi, decodedText)
  const halfScale = await sharp(beforeAi)
    .resize(Math.max(1, Math.round(poster.width / 2)), Math.max(1, Math.round(poster.height / 2)), { fit: 'fill' })
    .png()
    .toBuffer()
  const halfScaleCheck = await verifyQrVariant('halfScale', halfScale, decodedText)
  const jpeg80 = await sharp(beforeAi).jpeg({ quality: 80 }).toBuffer()
  const jpegCheck = await verifyQrVariant('jpeg80', jpeg80, decodedText)
  const checks = [sourceCheck, normalizedCheck, beforeAiCheck, halfScaleCheck, jpegCheck]
  const qualified = checks.every(check => check.passed)

  const regionMaskPng = await renderRegionMask(regionMask)
  const layoutPreview = await renderLayoutPreview(poster, regionMask, placement)
  const editMask = await renderEditMask(regionMask, placement)
  const artifactBuffers = {
    regionMask: regionMaskPng,
    qr: normalizedQr,
    layoutPreview,
    editMask,
    beforeAi,
  }
  await Promise.all(Object.entries(artifactBuffers).map(([key, buffer]) =>
    writeFile(join(outputDir, ARTIFACT_NAMES[key as keyof typeof artifactBuffers]), buffer)))

  const warnings: string[] = []
  if (placement.modulePixels < 6)
    warnings.push(`The normalized QR uses ${placement.modulePixels}px modules; 6px or larger is preferred.`)
  for (const check of checks) {
    if (!check.passed)
      warnings.push(`${check.name} verification failed${check.error ? `: ${check.error}` : '.'}`)
  }

  const artifacts = {
    regionMask: ARTIFACT_NAMES.regionMask,
    qr: ARTIFACT_NAMES.qr,
    layoutPreview: ARTIFACT_NAMES.layoutPreview,
    editMask: ARTIFACT_NAMES.editMask,
    beforeAi: ARTIFACT_NAMES.beforeAi,
  }
  const report: ReportV1 = {
    schemaVersion: 1,
    status: qualified ? 'prepared' : 'verification_failed',
    qualified,
    dryRun: true,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputs: {
      poster: {
        path: normalizedPath(options.inputPath),
        sha256: poster.sha256,
        width: poster.width,
        height: poster.height,
      },
      qr: {
        path: normalizedPath(options.qrPath),
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(maskInput
        ? { mask: { path: normalizedPath(options.maskPath!), sha256: maskInput.sha256 } }
        : {}),
    },
    region: {
      source: regionMask.source,
      area: regionMask.area,
      bounds: regionMask.bounds,
      centroid: regionMask.centroid,
      ...(regionMask.detection ? { detection: regionMask.detection } : {}),
    },
    qr: {
      ...qrMetadata,
      normalizedSize: placement.size,
      normalizedModulePixels: placement.modulePixels,
    },
    placement,
    artifacts,
    verification: { expectedText: decodedText, checks, qualified },
    warnings,
  }
  await writeFile(join(outputDir, ARTIFACT_NAMES.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, outputDir }
}

async function ensureOutputsAvailable(outputDir: string, force: boolean): Promise<void> {
  if (force)
    return
  const collisions: string[] = []
  for (const name of Object.values(ARTIFACT_NAMES)) {
    try {
      await access(join(outputDir, name))
      collisions.push(name)
    }
    catch {
      // Missing is the expected state.
    }
  }
  if (collisions.length > 0) {
    throw new QrPosterError(
      'OUTPUT_EXISTS',
      `Refusing to overwrite existing output files: ${collisions.join(', ')}. Use --force to replace them.`,
    )
  }
}

function normalizedPath(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
}
