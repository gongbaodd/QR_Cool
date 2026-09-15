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
  stderr: string
}

const QR_CONTENT = 'https://www.instagram.com/grandpasbeehaven/'

/** Runs the CLI through tsx, using the same `-- <mode>` path the pnpm script documents. */
function runCli(args: string[]): CliRun {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('src/cli.ts'), '--', ...args],
    { cwd: resolve('.'), encoding: 'utf8' },
  )
  if (result.error)
    throw result.error
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
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

  it('requires --content for the poster modes', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    const result = runCli(['--dry-run', '--input', pattern, '--out-dir', join(directory, 'out')])
    expect(result.status).toBe(2)
  }, 60_000)

  it('rejects invalid content and the removed QR flags', async () => {
    const directory = await temporaryDirectory()
    const base = ['--dry-run', '--input', resolve('source/poster.png'), '--out-dir']
    expect(runCli([...base, join(directory, 'blank'), '--content', '   ']).status).toBe(2)
    expect(runCli([...base, join(directory, 'multiline'), '--content', 'first\nsecond']).status).toBe(2)
    expect(runCli([...base, join(directory, 'large'), '--content', 'x'.repeat(5_000)]).status).toBe(2)
    expect(runCli([...base, join(directory, 'qr'), '--qr', resolve('source/qr.png')]).status).toBe(2)
    expect(runCli([...base, join(directory, 'text'), '--text', 'test']).status).toBe(2)
  }, 60_000)

  it('generates QR inputs for dry-run and pattern-preview', async () => {
    const directory = await temporaryDirectory()
    for (const [mode, outDir] of [
      ['--dry-run', join(directory, 'dry')],
      ['--pattern-preview', join(directory, 'pattern')],
    ] as const) {
      const result = runCli([
        mode,
        '--input', resolve('source/poster.png'),
        '--content', QR_CONTENT,
        '--out-dir', outDir,
        ...(mode === '--pattern-preview' ? ['--seed', '1'] : []),
      ])
      expect(result.status).toBe(0)
      const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'))
      expect(report.inputs.qr.path).toBe('<generated>')
      expect(report.inputs.qr).toMatchObject({ width: 740, height: 740 })
      if (mode === '--dry-run')
        expect(report.qr.decodedText).toBe(QR_CONTENT)
    }
  }, 120_000)

  it('rejects --content for pattern-cut', async () => {
    const directory = await temporaryDirectory()
    const { pattern, mask } = await writeFixtures(directory)
    const result = runCli([
      '--pattern-cut',
      '--input', pattern,
      '--cut-mask', mask,
      '--content', 'unused',
      '--out-dir', join(directory, 'out'),
    ])
    expect(result.status).toBe(2)
  }, 60_000)

  it('rejects cut options outside the cut mode', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    const result = runCli([
      '--dry-run',
      '--input', pattern,
      '--content', 'test',
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
      '--content', QR_CONTENT,
      '--out-dir', outDir,
      '--seed', '1',
      '--cut-radius', '4',
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
    expect(report.schemaVersion).toBe(8)
    expect(report.cut.radius).toBe(4)
    expect(report.cut.modulePixels).toBe(7)
    expect(report.cut.lattice).toEqual({ x: 2, y: 6 })
    expect(report.cut.rim).toEqual({ modules: 4, style: 'cell' })
    expect(report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    expect(report.qr.overlay).toEqual({
      band: 'markers',
      quietZoneModules: 1,
      markerModules: 7,
      crop: { left: 14, top: 14, size: 231 },
      x: 219,
      y: 188,
    })
    // Any positive --cut-radius hands the corner block beside each of the three markers to the
    // texture; the light band is the two 7-cell arms beside each finder marker.
    expect(report.qrPlate).toEqual({
      band: 'markers',
      marginModules: 1,
      marginPixels: 7,
      markerModules: 7,
      bandCells: 42,
      box: { x: 219, y: 188, width: 231, height: 231 },
      holeModules: 1131,
      cornerModules: 3,
      cornerTexturePixels: 147,
    })
    expect(report.cut.plateCornerModules).toBe(3)
    expect(result.stdout).toMatch(/QR plate: code grid 231px in a 1131 module hole, 42 light cell\(s\) beside the markers/)
    expect(result.stdout).toMatch(/Cut: 7px modules on lattice 2,6, 1262 module\(s\) drawn/)
  }, 120_000)

  it('accepts a deeper --qr-margin and rejects fractional, zero, and oversized values', async () => {
    const directory = await temporaryDirectory()
    const outDir = join(directory, 'out')
    const result = runCli([
      '--assemble',
      '--input', resolve('source/poster.png'),
      '--content', QR_CONTENT,
      '--out-dir', outDir,
      '--seed', '1',
      '--qr-margin', '2',
    ])
    expect(result.status).toBe(0)
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'))
    expect(report.qrPlate.marginModules).toBe(2)
    expect(report.qrPlate.marginPixels).toBe(14)
    expect(report.qrPlate.bandCells).toBe(84)
    expect(report.qrPlate.holeModules).toBe(1173)
    expect(report.qrPlate.cornerModules).toBe(12)
    expect(report.qrPlate.cornerTexturePixels).toBe(588)
    expect(result.stdout).toMatch(/84 light cell\(s\) beside the markers \(14px = 2 module deep\)/)
    // A fraction is rejected rather than rounded, zero leaves no light band at all, and the profile's
    // two-module quiet zone is the cap.
    for (const [index, qrMargin] of ['0', '0.4', '3'].entries()) {
      expect(runCli([
        '--assemble',
        '--input', resolve('source/poster.png'),
        '--content', QR_CONTENT,
        '--qr-margin', qrMargin,
        '--out-dir', join(directory, `bad-${index}`),
      ]).status).toBe(2)
    }
    expect(runCli(['--dry-run', '--input', resolve('source/poster.png'), '--content', QR_CONTENT, '--qr-margin', '0.4', '--out-dir', join(directory, 'two')]).status).toBe(2)
  }, 120_000)

  it('rejects options that do not belong to assembly', async () => {
    const directory = await temporaryDirectory()
    const { pattern, mask } = await writeFixtures(directory)
    const shared = ['--assemble', '--input', pattern, '--content', 'test', '--out-dir', join(directory, 'out')]

    expect(runCli([...shared, '--module-pixels', '20']).status).toBe(2)
    expect(runCli([...shared, '--cut-mask', mask]).status).toBe(2)
    // The assembled cut is module-aligned, so there is no traced outline to simplify.
    expect(runCli([...shared, '--cut-smooth', '2']).status).toBe(2)
    expect(runCli(['--pattern-cut', '--assemble', '--input', pattern, '--cut-mask', mask, '--out-dir', join(directory, 'two')]).status).toBe(2)
  }, 120_000)

  it('still rejects seeds and cut options outside the modes that accept them', async () => {
    const directory = await temporaryDirectory()
    const { pattern } = await writeFixtures(directory)
    expect(runCli(['--dry-run', '--input', pattern, '--content', 'test', '--seed', '1', '--out-dir', join(directory, 'a')]).status).toBe(2)
    expect(runCli(['--pattern-cut', '--input', pattern, '--cut-mask', pattern, '--seed', '1', '--out-dir', join(directory, 'b')]).status).toBe(2)
  }, 120_000)
})
