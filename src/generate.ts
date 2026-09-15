import { access, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { preparePoster } from './prepare.js'
import { compositePoster } from './composite.js'
import { loadPng, grayscaleToPng } from './image.js'
import { verifyQrVariant } from './qr.js'
import { QrPosterError } from './errors.js'
import { buildEditPrompt, DEFAULT_PROMPT, DEFAULT_QWEN_BASE_URL, DEFAULT_QWEN_MODEL, editWithQwen, validateQwenConfig } from './qwen.js'
import type { GeneratePosterOptions, GenerateResult, RegionMask, ReportV2 } from './types.js'

export async function generatePoster(options: GeneratePosterOptions): Promise<GenerateResult> {
  const started = Date.now()
  const outputDir = resolve(options.outputDir)
  const apiKey = options.apiKey ?? process.env.QWEN_API_KEY ?? ''
  const baseUrl = options.baseUrl ?? process.env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL
  const model = options.model ?? DEFAULT_QWEN_MODEL
  const prompt = options.prompt ?? DEFAULT_PROMPT
  if (!options.generatedImagePath) validateQwenConfig(apiKey, baseUrl, model)
  // Read offline artwork before --force can replace the same output path.
  const supplied = options.generatedImagePath ? await loadPng(options.generatedImagePath, 'generated image') : undefined
  for (const name of ['ai-raw.png', 'poster.png', 'pattern-reference.png', 'reference-canvas.png']) {
    let exists = false
    try { await access(join(outputDir, name)); exists = true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (exists && !options.force) throw new QrPosterError('OUTPUT_EXISTS', `Refusing to overwrite ${name}. Use --force to replace known outputs.`)
  }
  const prepared = await preparePoster({ ...options, dryRun: true })
  if (!prepared.report.qualified) throw new QrPosterError('VERIFICATION_FAILED', 'QR preparation failed verification; no generation was requested.', 4)
  const { report: initial } = prepared
  const { width, height } = initial.inputs.poster
  const canvas = { width: Math.ceil(width / 16) * 16, height: Math.ceil(height / 16) * 16 }
  const report: ReportV2 = {
    ...initial, schemaVersion: 2, dryRun: false, status: 'generation_failed', qualified: false,
    verification: { ...initial.verification, qualified: false },
    generation: { source: supplied ? 'file' : 'qwen', model, prompt: buildEditPrompt(prompt, initial.placement.modulePixels), canvas, durationMs: 0,
 }, phoneScan: 'untested',
  }
  const saveReport = () => writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const generationStarted = Date.now()
  try {
    if (options.force) {
      await rm(join(outputDir, 'poster.png'), { force: true })
      await rm(join(outputDir, 'ai-raw.png'), { force: true })
    }
    const original = await loadPng(options.inputPath, 'poster input')
    const region = await sharp(join(outputDir, 'region-mask.png')).extractChannel(0).raw().toBuffer()
    const mask: RegionMask = { width, height, data: region, source: initial.region.source, area: initial.region.area, bounds: initial.region.bounds, centroid: initial.region.centroid }
    const qr = await readFile(join(outputDir, 'qr.png'))
    const patternReference = await cropQrPattern(qr, initial.placement.totalModules, initial.placement.modulePixels)
    await writeFile(join(outputDir, 'pattern-reference.png'), patternReference)
    report.artifacts.patternReference = 'pattern-reference.png'
    const before = await readFile(join(outputDir, 'before-ai.png'))
    let generated: Buffer
    if (supplied) generated = supplied.file
    else {
      if (canvas.width * canvas.height < 512 * 512 || canvas.width * canvas.height > 2048 * 2048)
        throw new QrPosterError('INVALID_INPUT', 'Padded generation canvas must contain between 512² and 2048² pixels.')
      const editAlpha = await sharp(join(outputDir, 'edit-mask.png')).extractChannel(3).raw().toBuffer()
      const guide = await grayscaleToPng(Uint8Array.from(editAlpha, alpha => 255 - alpha), width, height)
      const paddedGuide = await sharp(guide).extend({ top: 0, left: 0, right: canvas.width - width, bottom: canvas.height - height, background: '#000000' }).png().toBuffer()
      // Hide the protected QR from the model so its finder circles cannot become fill references.
      const blankQr = await sharp({ create: { width: initial.placement.size, height: initial.placement.size, channels: 3, background: '#ffffff' } }).png().toBuffer()
      const aiInput = await sharp(before).composite([{ input: blankQr, left: initial.placement.x, top: initial.placement.y }]).png().toBuffer()
      const paddedPoster = await sharp(aiInput).extend({ top: 0, left: 0, right: canvas.width - width, bottom: canvas.height - height, extendWith: 'copy' }).png().toBuffer()
      if (paddedGuide.length > 10 * 1024 * 1024 || paddedPoster.length > 10 * 1024 * 1024)
        throw new QrPosterError('INVALID_INPUT', 'Qwen input images must not exceed 10 MB each.')
      const referenceCanvas = await sharp({ create: { ...canvas, channels: 3, background: '#ffffff' } }).composite([{ input: patternReference, gravity: 'northwest' }]).png().toBuffer()
      await writeFile(join(outputDir, 'reference-canvas.png'), referenceCanvas)
      report.artifacts.referenceCanvas = 'reference-canvas.png'
      const result = await editWithQwen({ apiKey, baseUrl, model, prompt, ...canvas, guide: paddedGuide, poster: paddedPoster, modulePixels: initial.placement.modulePixels, patternReference: referenceCanvas })
      generated = result.image
      if (result.requestId) report.generation.requestId = result.requestId
      if (result.usage !== undefined) report.generation.usage = result.usage
    }
    report.generation.durationMs = Date.now() - generationStarted
    await writeFile(join(outputDir, 'ai-raw.png'), generated)
    report.artifacts.aiRaw = 'ai-raw.png'
    const metadata = await sharp(generated).metadata()
    const padded = metadata.width === canvas.width && metadata.height === canvas.height
    const originalSize = supplied && metadata.width === width && metadata.height === height
    if (metadata.format !== 'png' || (!padded && !originalSize))
      throw new QrPosterError('IMAGE_PROCESSING_FAILED', `Unexpected generated geometry; expected ${canvas.width}x${canvas.height}${supplied ? ` or ${width}x${height}` : ''} PNG. Raw result retained.`, 3)
    const aligned = padded ? await sharp(generated).extract({ left: 0, top: 0, width, height }).png().toBuffer() : generated
    const poster = await compositePoster({ original: original.file, generated: aligned, regionMask: mask, qr, placement: initial.placement })
    await writeFile(join(outputDir, 'poster.png'), poster)
    report.artifacts.poster = 'poster.png'
    const expected = initial.qr.decodedText
    const half = await sharp(poster).resize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)), { fit: 'fill' }).png().toBuffer()
    const jpeg = await sharp(poster).jpeg({ quality: 80 }).toBuffer()
    const output = await sharp(poster).ensureAlpha().raw().toBuffer()
    const qrRaw = await sharp(qr).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer()
    let outsidePassed = true
    let qrPassed = true
    const { x, y, size } = initial.placement
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const index = row * width + col
        const insideQr = col >= x && col < x + size && row >= y && row < y + size
        for (let channel = 0; channel < 4; channel++) {
          if (!region[index] && output[index * 4 + channel] !== original.data[index * 4 + channel]) outsidePassed = false
          if (insideQr && output[index * 4 + channel] !== qrRaw[((row - y) * size + col - x) * 4 + channel]) qrPassed = false
        }
      }
    }
    report.verification.checks.push(
      await verifyQrVariant('poster', poster, expected),
      await verifyQrVariant('posterHalfScale', half, expected),
      await verifyQrVariant('posterJpeg80', jpeg, expected),
      { name: 'outsideRegionPixels', passed: outsidePassed },
      { name: 'qrPixels', passed: qrPassed },
    )
    report.qualified = report.verification.checks.every(check => check.passed)
    report.verification.qualified = report.qualified
    report.status = report.qualified ? 'generated' : 'verification_failed'
    report.durationMs = Date.now() - started
    await saveReport()
    return { report, outputDir }
  }
  catch (error) {
    report.generation.durationMs = Date.now() - generationStarted
    report.durationMs = Date.now() - started
    report.generation.error = error instanceof QrPosterError ? error.message : 'Image processing or file operation failed.'
    await saveReport()
    if (error instanceof QrPosterError) throw error
    throw new QrPosterError('IMAGE_PROCESSING_FAILED', report.generation.error, 3)
  }
}

/** Crop whole modules from the central third, away from the corner finder markers. */
export async function cropQrPattern(qr: Buffer, totalModules: number, modulePixels: number): Promise<Buffer> {
  const modules = Math.min(Math.floor(totalModules / 3), totalModules - 20)
  const start = Math.floor((totalModules - modules) / 2) * modulePixels
  return sharp(qr).extract({ left: start, top: start, width: modules * modulePixels, height: modules * modulePixels }).png().toBuffer()
}
