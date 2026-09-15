#!/usr/bin/env node
import process from 'node:process'
import { Command, CommanderError } from 'commander'
import { QrPosterError } from './errors.js'
import { generatePoster } from './generate.js'
import { preparePoster } from './prepare.js'
import type { QrBoxInput } from './types.js'

interface CliOptions {
  dryRun?: boolean
  generate?: boolean
  generatedImage?: string
  model?: string
  prompt?: string
  input: string
  qr: string
  outDir: string
  text?: string
  mask?: string
  qrBox?: string
  force?: boolean
}

const program = new Command()
  .name('qr-poster')
  .description('Prepare or generate an artistic QR poster with Qwen.')
  .version('0.1.0')
  .option('--dry-run', 'prepare previews without network calls')
  .option('--generate', 'generate artwork using Qwen (paid API call)')
  .option('--generated-image <path>', 'recompose saved artwork offline')
  .option('--model <name>', 'Qwen image model (default: qwen-image-2.0)')
  .option('--prompt <text>', 'QR pattern style instruction')
  .requiredOption('--input <path>', 'painted poster PNG')
  .requiredOption('--qr <path>', 'qrcode.antfu.me-compatible QR PNG')
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
    if ([options.dryRun, options.generate, options.generatedImage !== undefined].filter(Boolean).length !== 1)
      throw new QrPosterError('INVALID_INPUT', 'Specify exactly one of --dry-run, --generate, or --generated-image.')
    if (options.dryRun && (options.model !== undefined || options.prompt !== undefined))
      throw new QrPosterError('INVALID_INPUT', '--model and --prompt require generation mode.')
    if (options.generate) {
      try { process.loadEnvFile() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new QrPosterError('INVALID_INPUT', 'Could not load .env.') }
    }
    const common = {
      inputPath: options.input,
      qrPath: options.qr,
      outputDir: options.outDir,
      ...(options.text !== undefined ? { expectedText: options.text } : {}),
      ...(options.mask !== undefined ? { maskPath: options.mask } : {}),
      ...(options.qrBox !== undefined ? { qrBox: parseQrBox(options.qrBox) } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
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

await main()
