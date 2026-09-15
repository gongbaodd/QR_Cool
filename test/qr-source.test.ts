import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPng } from '../src/image.js'
import { resolveLayout } from '../src/layout.js'
import { inspectAntfuQr, resolveQrSource } from '../src/qr.js'

const EXPECTED_TEXT = 'https://www.instagram.com/grandpasbeehaven/'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qr-cool-qr-source-'))
  temporaryDirectories.push(path)
  return path
}

describe('QR source resolution', () => {
  it('leaves a conforming square input untouched', async () => {
    const source = await loadPng(resolve('test/fixtures/qr.png'), 'QR input')
    const resolved = await resolveQrSource(source, 5)
    expect(resolved.quietZoneSource).toBe('source')
    expect(resolved.image).toBe(source)
    expect(resolved.trim).toBeUndefined()
  })

  it('rebuilds the missing quiet zone of the trimmed source/qr.png', async () => {
    const source = await loadPng(resolve('source/qr.png'), 'QR input')
    expect(source.width).toBe(753)
    expect(source.height).toBe(748)

    const resolved = await resolveQrSource(source, 5)
    expect(resolved.quietZoneSource).toBe('added')
    expect(resolved.trim).toEqual({ left: 8, top: 5, right: 5, bottom: 3, modulePixels: 20 })
    expect(resolved.image.width).toBe(820)
    expect(resolved.image.height).toBe(820)

    // The code grid is copied 1:1 and the rebuilt margin matches the square fixture exactly.
    const fixture = await loadPng(resolve('test/fixtures/qr.png'), 'QR input')
    expect(Buffer.from(resolved.image.data).equals(Buffer.from(fixture.data))).toBe(true)

    const metadata = inspectAntfuQr(resolved.image, EXPECTED_TEXT, 5)
    expect(metadata.version).toBe(5)
    expect(metadata.qrModules).toBe(37)
    expect(metadata.totalModules).toBe(41)
    expect(metadata.sourceModulePixels).toBe(20)
    expect(metadata.quietZoneLightRatio).toBe(1)
  })

  it('recovers a square code grid that carries no margin at all', async () => {
    const source = await loadPng(resolve('test/fixtures/qr.png'), 'QR input')
    const bare = await sharp(source.file)
      .extract({ left: 40, top: 40, width: 740, height: 740 })
      .png()
      .toBuffer()
    const bareImage = await loadPng(await writeTemporaryPng(bare), 'QR input')
    const resolved = await resolveQrSource(bareImage, 5)
    expect(resolved.quietZoneSource).toBe('added')
    expect(resolved.trim).toEqual({ left: 0, top: 0, right: 0, bottom: 0, modulePixels: 20 })
    expect(Buffer.from(resolved.image.data).equals(Buffer.from(source.data))).toBe(true)
  })

  it('reports the rebuilt margin through the shared layout', async () => {
    const layout = await resolveLayout({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('source/qr.png'),
    })
    expect(layout.qrMetadata.quietZoneSource).toBe('added')
    expect(layout.qrMetadata.sourceTrim).toEqual({ left: 8, top: 5, right: 5, bottom: 3, modulePixels: 20 })
    expect(layout.qrSource.width).toBe(753)
    expect(layout.placement.modulePixels).toBe(5)
  })

  it('rejects a crop whose grid cannot be recovered', async () => {
    const source = await loadPng(resolve('test/fixtures/qr.png'), 'QR input')
    const clipped = await sharp(source.file)
      .extract({ left: 41, top: 43, width: 745, height: 741 })
      .png()
      .toBuffer()
    const clippedImage = await loadPng(await writeTemporaryPng(clipped), 'QR input')
    await expect(resolveQrSource(clippedImage, 5)).rejects.toMatchObject({ code: 'QR_INVALID', exitCode: 2 })
  })
})

async function writeTemporaryPng(buffer: Buffer): Promise<string> {
  const directory = await temporaryDirectory()
  const path = join(directory, 'qr.png')
  await sharp(buffer).png().toFile(path)
  return path
}
