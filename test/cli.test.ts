import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qr-cool-cli-'))
  temporaryDirectories.push(path)
  return path
}

interface CliRun {
  status: number | null
  stdout: string
}

/** Runs the CLI through tsx, using the same `-- <mode>` path the pnpm script documents. */
function runCli(args: string[]): CliRun {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('src/cli.ts'), '--', ...args],
    { cwd: resolve('.'), encoding: 'utf8' },
  )
  if (result.error)
    throw result.error
  return { status: result.status, stdout: result.stdout ?? '' }
}

/**
 * Some sandboxes refuse to start child processes, which would fail every case here for reasons
 * unrelated to the CLI. Probe once and skip the suite when spawning is unavailable.
 */
const spawnAvailable = ((): boolean => {
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: resolve('.') })
  return probe.error === undefined
})()

async function writeFixtures(directory: string): Promise<{ pattern: string, mask: string }> {
  const pattern = join(directory, 'pattern.png')
  const mask = join(directory, 'mask.png')
  const patternData = Buffer.alloc(120 * 120 * 4)
  const maskData = Buffer.alloc(120 * 120 * 4)
  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 120; x++) {
      const index = (y * 120 + x) * 4
      const dark = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0
      const value = dark ? 0 : 255
      patternData[index] = value
      patternData[index + 1] = value
      patternData[index + 2] = value
      patternData[index + 3] = 255
      const inside = x >= 20 && x < 100 && y >= 20 && y < 100
      maskData[index] = 255
      maskData[index + 1] = 255
      maskData[index + 2] = 255
      maskData[index + 3] = inside ? 0 : 255
    }
  }
  await sharp(patternData, { raw: { width: 120, height: 120, channels: 4 } }).png().toFile(pattern)
  await sharp(maskData, { raw: { width: 120, height: 120, channels: 4 } }).png().toFile(mask)
  return { pattern, mask }
}

describe.skipIf(!spawnAvailable)('cli pattern cut mode', () => {
  it('cuts a pattern without a QR input', async () => {
    const directory = await temporaryDirectory()
    const { pattern, mask } = await writeFixtures(directory)
    const outDir = join(directory, 'out')
    const result = runCli(['--pattern-cut', '--input', pattern, '--cut-mask', mask, '--out-dir', outDir])
    expect(result.status).toBe(0)
    expect((await readdir(outDir)).sort()).toEqual(['pattern-cut.png', 'pattern-cut.svg', 'report.json'])
  }, 60_000)

  it('requires --cut-mask', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    const result = runCli(['--pattern-cut', '--input', pattern, '--out-dir', join(directory, 'out')])
    expect(result.status).toBe(2)
  }, 60_000)

  it('rejects two modes in one run', async () => {
    const directory = await temporaryDirectory()
    const { pattern, mask } = await writeFixtures(directory)
    const result = runCli([
      '--pattern-cut',
      '--dry-run',
      '--input', pattern,
      '--cut-mask', mask,
      '--out-dir', join(directory, 'out'),
    ])
    expect(result.status).toBe(2)
  }, 60_000)

  it('still requires --qr for the poster modes', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    const result = runCli(['--dry-run', '--input', pattern, '--out-dir', join(directory, 'out')])
    expect(result.status).toBe(2)
  }, 60_000)

  it('rejects cut options outside the cut mode', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    const result = runCli([
      '--dry-run',
      '--input', pattern,
      '--qr', pattern,
      '--cut-radius', '4',
      '--out-dir', join(directory, 'out'),
    ])
    expect(result.status).toBe(2)
  }, 60_000)
})

describe.skipIf(!spawnAvailable)('cli assemble mode', () => {
  it('assembles the poster from the repository sources', async () => {
    const directory = await temporaryDirectory()
    const outDir = join(directory, 'out')
    const result = runCli([
      '--assemble',
      '--input', resolve('source/poster.png'),
      '--qr', resolve('source/qr.png'),
      '--out-dir', outDir,
      '--seed', '1',
      '--cut-radius', '4',
      '--cut-smooth', '2',
    ])
    expect(result.status).toBe(0)
    expect((await readdir(outDir)).sort()).toEqual([
      'pattern-cut.png',
      'pattern-cut.svg',
      'poster.png',
      'qr.png',
      'region-mask.png',
      'report.json',
    ])
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'))
    expect(report.cut.radius).toBe(4)
    expect(report.cut.smoothTolerance).toBe(2)
    expect(report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(report.qr.overlay).toEqual({
      quietZoneModules: 1,
      crop: { left: 5, top: 5, size: 195 },
      x: 254,
      y: 206,
    })
    // The plate follows --cut-radius, so the 4px fillet above rounds its corners by four pixels.
    expect(report.qrPlate).toEqual({
      marginModules: 1,
      radius: 4,
      path: 'rounded-rect',
      box: { x: 254, y: 206, width: 195, height: 195 },
      cornerTexturePixels: 4,
    })
    expect(report.shape.holes).toBe(1)
    expect(report.cut.border).toEqual({ width: 20, color: '#000000', side: 'inside' })
    expect(result.stdout).toMatch(/QR plate: rounded 195px window, 4px corners, 4 texture pixel\(s\)/)
  }, 120_000)

  it('rejects options that do not belong to assembly', async () => {
    const directory = await temporaryDirectory()
    const { pattern, mask } = await writeFixtures(directory)
    const shared = ['--assemble', '--input', pattern, '--qr', pattern, '--out-dir', join(directory, 'out')]

    expect(runCli([...shared, '--module-pixels', '20']).status).toBe(2)
    expect(runCli([...shared, '--cut-mask', mask]).status).toBe(2)
    expect(runCli(['--pattern-cut', '--assemble', '--input', pattern, '--cut-mask', mask, '--out-dir', join(directory, 'two')]).status).toBe(2)
  }, 120_000)

  it('still rejects seeds and cut options outside the modes that accept them', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    expect(runCli(['--dry-run', '--input', pattern, '--qr', pattern, '--seed', '1', '--out-dir', join(directory, 'a')]).status).toBe(2)
    expect(runCli(['--pattern-cut', '--input', pattern, '--cut-mask', pattern, '--seed', '1', '--out-dir', join(directory, 'b')]).status).toBe(2)
  }, 120_000)
})
