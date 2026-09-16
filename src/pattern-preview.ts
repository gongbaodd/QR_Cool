import { access, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveLayout } from './layout.js'
import { QrPosterError } from './errors.js'
import { renderPosterPattern, PATTERN_ALPHABET, PATTERN_ECC, PATTERN_PIXEL_STYLE, PATTERN_MARKER_REFILL, PATTERN_QUIET_ZONE_MODULES } from './pattern.js'
import type { PatternPreviewOptions, PatternPreviewResult, PatternReport } from './types.js'
const QUIET_ZONE_MODULES = PATTERN_QUIET_ZONE_MODULES
const REMOVED_TYPES = ['Position', 'Alignment'] as const
const ARTIFACT_NAMES = {pattern:'pattern.png',report:'report.json'} as const
export async function generatePatternPreview(options: PatternPreviewOptions): Promise<PatternPreviewResult> {
  const startedAt = Date.now()
  const outputDir = resolve(options.outputDir)
  await ensureOutputsAvailable(outputDir, options.force ?? false)
  await mkdir(outputDir, { recursive: true })

  const { poster, qrSource, maskInput, regionMask, placement } = await resolveLayout(options)

  const modulePixels = options.modulePixels ?? placement.modulePixels
  if (!Number.isInteger(modulePixels) || modulePixels < 1)
    throw new QrPosterError('INVALID_INPUT', '--module-pixels must be a positive integer.')

  const rendered = await renderPosterPattern({
    width: poster.width,
    height: poster.height,
    modulePixels,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  })
  await writeFile(join(outputDir, ARTIFACT_NAMES.pattern), rendered.png)

  const warnings: string[] = []
  if (modulePixels < 6)
    warnings.push(`The pattern uses ${modulePixels}px modules; rounded cells below 6px are heavily antialiased.`)

  const report: PatternReport = {
    schemaVersion: 3,
    mode: 'pattern-preview',
    status: 'generated',
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
        path: qrSource.path === '<generated>' ? qrSource.path : normalizedPath(qrSource.path),
        sha256: qrSource.sha256,
        width: qrSource.width,
        height: qrSource.height,
      },
      ...(maskInput ? { mask: { path: normalizedPath(options.maskPath!), sha256: maskInput.sha256 } } : {}),
    },
    region: {
      source: regionMask.source,
      area: regionMask.area,
      bounds: regionMask.bounds,
      centroid: regionMask.centroid,
      ...(regionMask.detection ? { detection: regionMask.detection } : {}),
    },
    placement,
    pitchSource: options.modulePixels === undefined ? 'placement' : 'override',
    pattern: {
      seed: rendered.seed,
      alphabet: PATTERN_ALPHABET,
      textLength: rendered.text.length,
      textSha256: sha256(rendered.text),
      ecc: PATTERN_ECC,
      version: rendered.version,
      qrModules: rendered.qrModules,
      quietZoneModules: QUIET_ZONE_MODULES,
      totalModules: rendered.totalModules,
      modulePixels,
      pixelStyle: PATTERN_PIXEL_STYLE,
      removedTypes: [...REMOVED_TYPES],
      markerRefill: PATTERN_MARKER_REFILL,
      refilledModules: rendered.refilledModules,
      codeSize: rendered.codeSize,
      canvas: { width: poster.width, height: poster.height },
      crop: rendered.crop,
    },
    artifacts: { pattern: ARTIFACT_NAMES.pattern, patternSha256: sha256(rendered.png) },
    warnings,
  }
  await writeFile(join(outputDir, ARTIFACT_NAMES.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, outputDir }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedPath(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
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
