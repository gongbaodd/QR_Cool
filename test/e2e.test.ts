import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { QrPosterError } from '../src/errors.js'
import { boxIsInsideMask } from '../src/placement.js'
import { preparePoster } from '../src/prepare.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('real fixture dry run', () => {
  it('prepares all diagnostic artifacts and verifies the stylized QR', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-test-'))
    temporaryDirectories.push(outputDir)
    const result = await preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
    })

    expect(result.report.qualified).toBe(true)
    expect(result.report.qr.decodedText).toBe('https://www.instagram.com/grandpasbeehaven/')
    expect(result.report.qr.version).toBe(5)
    expect(result.report.qr.qrModules).toBe(37)
    expect(result.report.qr.totalModules).toBe(41)
    expect(result.report.qr.sourceModulePixels).toBe(20)
    expect(result.report.region.source).toBe('auto')
    expect(result.report.region.area).toBeGreaterThan(100_000)
    expect(result.report.region.area).toBeLessThan(150_000)
    expect(result.report.verification.checks.every(check => check.passed)).toBe(true)

    const names = (await readdir(outputDir)).sort()
    expect(names).toEqual([
      'before-ai.png',
      'edit-mask.png',
      'layout-preview.png',
      'qr.png',
      'region-mask.png',
      'report.json',
    ])
    expect(names).not.toContain('poster.png')
    const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
    expect(report.schemaVersion).toBe(1)
    expect(report.dryRun).toBe(true)

    const poster = await sharp(resolve('source/poster.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const beforeAi = await sharp(join(outputDir, 'before-ai.png')).ensureAlpha().raw().toBuffer()
    let changedOutsideQr = 0
    const { x, y, size } = result.report.placement
    for (let row = 0; row < poster.info.height; row++) {
      for (let column = 0; column < poster.info.width; column++) {
        if (column >= x && column < x + size && row >= y && row < y + size)
          continue
        const offset = (row * poster.info.width + column) * 4
        for (let channel = 0; channel < 4; channel++) {
          if (poster.data[offset + channel] !== beforeAi[offset + channel])
            changedOutsideQr++
        }
      }
    }
    expect(changedOutsideQr).toBe(0)

    const editMask = await sharp(join(outputDir, 'edit-mask.png')).ensureAlpha().raw().toBuffer()
    expect(editMask[((y + 1) * poster.info.width + x + 1) * 4 + 3]).toBe(255)
    expect(editMask[0 * 4 + 3]).toBe(255)
    let transparentEditablePixels = 0
    for (let index = 3; index < editMask.length; index += 4) {
      if (editMask[index] === 0)
        transparentEditablePixels++
    }
    expect(transparentEditablePixels).toBe(result.report.region.area - size * size)
  })

  it('places the QR box entirely within the detected mask', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-test-'))
    temporaryDirectories.push(outputDir)
    const result = await preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
    })
    const report = result.report
    const maskPng = await readFile(join(outputDir, 'region-mask.png'))
    const { data, info } = await sharp(maskPng).extractChannel(0).raw().toBuffer({ resolveWithObject: true })
    const mask = {
      width: info.width,
      height: info.height,
      data: new Uint8Array(data),
      source: report.region.source,
      area: report.region.area,
      bounds: report.region.bounds,
      centroid: report.region.centroid,
    } as const
    expect(boxIsInsideMask(mask, report.placement.x, report.placement.y, report.placement.size)).toBe(true)
  })

  it('rejects an expected text mismatch and existing artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-test-'))
    temporaryDirectories.push(outputDir)
    await expect(preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
      expectedText: 'https://example.com/',
    })).rejects.toMatchObject({ code: 'QR_TEXT_MISMATCH', exitCode: 2 })

    await preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
    })
    await expect(preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
    })).rejects.toBeInstanceOf(QrPosterError)
    await expect(preparePoster({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      dryRun: true,
    })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS', exitCode: 2 })
  })
})
