#!/usr/bin/env node
import process from 'node:process'
import { Command, CommanderError } from 'commander'
import { QrPosterError } from './errors.js'
import { generatePoster } from './generate.js'
import { generatePatternCut } from './pattern-cut.js'
import { generatePatternPreview } from './pattern.js'
import { preparePoster } from './prepare.js'
import type { QrBoxInput } from './types.js'

interface CliOptions {
  dryRun?: boolean
  generate?: boolean
  patternPreview?: boolean
  patternCut?: boolean
  generatedImage?: string
  model?: string
  prompt?: string
  modulePixels?: string
  seed?: string
  cutMask?: string
  cutRadius?: string
  cutSmooth?: string
  input: string
  qr?: string
  outDir: string
  text?: string
  mask?: string
  qrBox?: string
  force?: boolean
}

const program = new Command()
  .name('qr-poster')
  .description('Prepare, generate, or preview artistic QR poster artwork.')
  .version('0.1.0')
  .option('--dry-run', 'prepare previews without network calls')
  .option('--generate', 'generate artwork using Qwen (paid API call)')
  .option('--generated-image <path>', 'recompose saved artwork offline')
  .option('--pattern-preview', 'write a poster-sized marker-free QR pattern texture')
  .option('--pattern-cut', 'cut a pattern PNG with a mask and write a rounded SVG plus PNG')
  .option('--model <name>', 'Qwen image model (default: qwen-image-2.0)')
  .option('--prompt <text>', 'QR pattern style instruction')
  .option('--module-pixels <n>', 'pattern module pitch in pixels (default: the placed QR pitch)')
  .option('--seed <n>', 'seed for the pattern random text line')
  .option('--cut-mask <path>', 'cut shape mask PNG: transparent or dark pixels are kept')
  .option('--cut-radius <px>', 'corner fillet radius for --pattern-cut (default: 5)')
  .option('--cut-smooth <px>', 'outline simplification tolerance for --pattern-cut (default: 3)')
  .requiredOption('--input <path>', 'painted poster PNG, or the pattern PNG for --pattern-cut')
  .option('--qr <path>', 'qrcode.antfu.me-compatible QR PNG (not used by --pattern-cut)')
  .requiredOption('--out-dir <path>', 'directory for artifacts')
  .option('--text <value>', 'expected QR content; mismatch is an error')
  .option('--mask <path>', 'optional white-on-black/transparent region mask PNG')
  .option('--qr-box <x,y,size>', 'manual QR protection box in poster pixels')
  .option('--force', 'overwrite known artifact files')
  .showHelpAfterError()
  .exitOverride()

async function main(): Promise<void> {
  try {
    const argv = process.argv[2] === '--'
      ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
      : process.argv
    await program.parseAsync(argv)
    const options = program.opts<CliOptions>()
    const modes = [
      options.dryRun,
      options.generate,
      options.patternPreview,
      options.patternCut,
      options.generatedImage !== undefined,
    ]
    if (modes.filter(Boolean).length !== 1) {
      throw new QrPosterError(
        'INVALID_INPUT',
        'Specify exactly one of --dry-run, --generate, --pattern-preview, --pattern-cut, or --generated-image.',
      )
    }
    if (!options.generate && (options.model !== undefined || options.prompt !== undefined))
      throw new QrPosterError('INVALID_INPUT', '--model and --prompt require generation mode.')
    if (!options.patternPreview && (options.modulePixels !== undefined || options.seed !== undefined))
      throw new QrPosterError('INVALID_INPUT', '--module-pixels and --seed require --pattern-preview.')
    const cutOptions = [options.cutMask, options.cutRadius, options.cutSmooth]
    if (!options.patternCut && cutOptions.some(value => value !== undefined))
      throw new QrPosterError('INVALID_INPUT', '--cut-mask, --cut-radius, and --cut-smooth require --pattern-cut.')
    if (options.generate) {
      try { process.loadEnvFile() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new QrPosterError('INVALID_INPUT', 'Could not load .env.') }
    }
    const base = {
      inputPath: options.input,
      outputDir: options.outDir,
      ...(options.text !== undefined ? { expectedText: options.text } : {}),
      ...(options.mask !== undefined ? { maskPath: options.mask } : {}),
      ...(options.qrBox !== undefined ? { qrBox: parseQrBox(options.qrBox) } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
    }
    if (options.patternCut) {
      if (options.cutMask === undefined)
        throw new QrPosterError('INVALID_INPUT', '--cut-mask is required for --pattern-cut.')
      const result = await generatePatternCut({
        ...base,
        maskPath: options.cutMask,
        ...(options.cutRadius !== undefined ? { radius: parsePositiveNumber('--cut-radius', options.cutRadius) } : {}),
        ...(options.cutSmooth !== undefined ? { smoothTolerance: parsePositiveNumber('--cut-smooth', options.cutSmooth) } : {}),
      })
      const { report } = result
      process.stdout.write([
        `Pattern cut written to ${result.outputDir}`,
        `Shape: ${report.shape.loopsKept} loop(s), ${report.shape.holes} hole(s), ${report.shape.specksDropped} speck(s) dropped`,
        `Corners: ${report.cut.radius}px fillet, ${report.cut.smoothTolerance}px smoothing`,
        `Artifacts: ${report.artifacts.svg}, ${report.artifacts.png}`,
        '',
      ].join('\n'))
      return
    }
    const common = { ...base, qrPath: requireQr(options.qr) }
    if (options.patternPreview) {
      const result = await generatePatternPreview({
        ...common,
        ...(options.modulePixels !== undefined ? { modulePixels: parsePositiveInteger('--module-pixels', options.modulePixels) } : {}),
        ...(options.seed !== undefined ? { seed: parsePositiveInteger('--seed', options.seed) } : {}),
      })
      const { report } = result
      process.stdout.write([
        `Pattern written to ${result.outputDir}`,
        `Region: ${report.region.area} pixels (${report.region.source})`,
        `Pattern: version ${report.pattern.version}, ${report.pattern.modulePixels}px/module (${report.pitchSource}), seed ${report.pattern.seed}`,
        `Random text: ${report.pattern.textLength} characters`,
        `Removed modules: ${report.pattern.removedTypes.join(', ')} (${report.pattern.refilledModules} cells refilled with ${report.pattern.markerRefill})`,
        '',
      ].join('\n'))
      return
    }
    const result = options.dryRun
      ? await preparePoster({ ...common, dryRun: true })
      : await generatePoster({ ...common,
          ...(options.model !== undefined ? { model: options.model } : {}),
          ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
          ...(options.generatedImage !== undefined ? { generatedImagePath: options.generatedImage } : {}),
        })
    const { report } = result
    process.stdout.write([
      `${options.dryRun ? 'Dry-run artifacts' : 'Poster and report'} written to ${result.outputDir}`,
      `Region: ${report.region.area} pixels (${report.region.source})`,
      `QR: version ${report.qr.version}, ${report.placement.modulePixels}px/module, box ${report.placement.x},${report.placement.y},${report.placement.size}`,
      `Verification: ${report.qualified ? 'passed' : 'failed'}`,
      '',
    ].join('\n'))
    if (!report.qualified)
      process.exitCode = 4
  }
  catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')
        process.exitCode = 0
      else
        process.exitCode = 2
      return
    }
    if (error instanceof QrPosterError) {
      process.stderr.write(`${error.code}: ${error.message}\n`)
      process.exitCode = error.exitCode
      return
    }
    process.stderr.write(`UNEXPECTED_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function parseQrBox(value: string): QrBoxInput {
  const parts = value.split(',')
  if (parts.length !== 3)
    throw new QrPosterError('QR_LAYOUT_INVALID', '--qr-box must use x,y,size syntax.')
  const numbers = parts.map(part => Number(part.trim()))
  if (!numbers.every(Number.isInteger))
    throw new QrPosterError('QR_LAYOUT_INVALID', '--qr-box values must be integers.')
  return { x: numbers[0]!, y: numbers[1]!, size: numbers[2]! }
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new QrPosterError('INVALID_INPUT', `${flag} must be a positive integer.`)
  return parsed
}

function parsePositiveNumber(flag: string, value: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new QrPosterError('INVALID_INPUT', `${flag} must be zero or a positive number.`)
  return parsed
}

function requireQr(value: string | undefined): string {
  if (value === undefined)
    throw new QrPosterError('INVALID_INPUT', '--qr is required unless --pattern-cut is used.')
  return value
}

await main()
