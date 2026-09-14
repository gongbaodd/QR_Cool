#!/usr/bin/env node
import process from 'node:process'
import { Command, CommanderError } from 'commander'
import { QrPosterError } from './errors.js'
import { preparePoster } from './prepare.js'
import type { QrBoxInput } from './types.js'

interface CliOptions {
  dryRun: true
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
  .description('Prepare masks, QR placement, previews, and a verification report without calling an image API.')
  .version('0.1.0')
  .requiredOption('--dry-run', 'required safety flag; this version never calls an image API')
  .requiredOption('--input <path>', 'painted poster PNG')
  .requiredOption('--qr <path>', 'qrcode.antfu.me-compatible QR PNG')
  .requiredOption('--out-dir <path>', 'directory for dry-run artifacts')
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
    const result = await preparePoster({
      inputPath: options.input,
      qrPath: options.qr,
      outputDir: options.outDir,
      dryRun: true,
      ...(options.text !== undefined ? { expectedText: options.text } : {}),
      ...(options.mask !== undefined ? { maskPath: options.mask } : {}),
      ...(options.qrBox !== undefined ? { qrBox: parseQrBox(options.qrBox) } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
    })
    const { report } = result
    process.stdout.write([
      `Dry-run artifacts written to ${result.outputDir}`,
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
