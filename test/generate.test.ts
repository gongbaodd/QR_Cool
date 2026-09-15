import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePoster } from '../src/generate.js'

const dirs: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'qr-generate-')); dirs.push(dir)
  return { inputPath: 'source/poster.png', qrPath: 'test/fixtures/qr.png', outputDir: join(dir, 'output'), dir }
}

describe('generation pipeline', () => {
  it('recomposes offline and verifies final QR and every protected pixel', async () => {
    const options = await setup()
    const image = join(options.dir, 'background.png')
    await sharp({ create: { width: 688, height: 576, channels: 3, background: '#faf0dd' } }).png().toFile(image)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { report } = await generatePoster({ ...options, generatedImagePath: image })
    expect(fetcher).not.toHaveBeenCalled()
    expect(report.status).toBe('generated')
    expect(report.qualified).toBe(true)
    expect(report.verification.checks.filter(check => check.name.startsWith('poster') || check.name.endsWith('Pixels'))).toHaveLength(5)
    expect(await sharp(join(options.outputDir, 'poster.png')).metadata()).toMatchObject({ width: 688, height: 566 })
    expect(report.phoneScan).toBe('untested')
    await expect(generatePoster({ ...options, generatedImagePath: image })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' })
  })
  it('generates with padded references and saves request metadata', async () => {
    const options = await setup()
    const artwork = await sharp({ create: { width: 688, height: 576, channels: 3, background: '#faf0dd' } }).png().toBuffer()
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ request_id: 'test-request', usage: { image_count: 1 }, output: { choices: [{ message: { content: [{ image: 'https://example.com/art.png' }] } }] } })).mockResolvedValueOnce(new Response(artwork))
    vi.stubGlobal('fetch', fetcher)
    const { report } = await generatePoster({ ...options, apiKey: 'test-secret' })
    expect(report.qualified).toBe(true)
    expect(report.generation.requestId).toBe('test-request')
    expect(report.artifacts.patternReference).toBe('pattern-reference.png')
    const crop = await sharp(join(options.outputDir, 'pattern-reference.png')).raw().toBuffer()
    const expectedCrop = await sharp(join(options.outputDir, 'qr.png')).extract({ left: 70, top: 70, width: 65, height: 65 }).raw().toBuffer()
    expect(crop).toEqual(expectedCrop)
    const body = JSON.parse(fetcher.mock.calls[0]![1].body)
    for (const item of body.input.messages[0].content.filter((_item: unknown, index: number) => index === 0 || index === 2)) {
      const input = Buffer.from(item.image.split(',')[1], 'base64')
      expect(await sharp(input).metadata()).toMatchObject({ width: 688, height: 576 })
    }
    expect(await readFile(join(options.outputDir, 'report.json'), 'utf8')).not.toContain('test-secret')
    const aiPoster = Buffer.from(body.input.messages[0].content[2].image.split(',')[1], 'base64')
    const protectedPixels = await sharp(aiPoster).extract({ left: 249, top: 201, width: 205, height: 205 }).removeAlpha().raw().toBuffer()
    expect(protectedPixels.every(value => value === 255)).toBe(true)
    const reference = Buffer.from(body.input.messages[0].content[1].image.split(',')[1], 'base64')
    expect(await sharp(reference).metadata()).toMatchObject({ width: 688, height: 576 })
    const referenceCrop = await sharp(reference).extract({ left: 0, top: 0, width: 65, height: 65 }).removeAlpha().raw().toBuffer()
    expect(referenceCrop).toEqual(await sharp(join(options.outputDir, 'pattern-reference.png')).removeAlpha().raw().toBuffer())
    const referencePixels = await sharp(reference).removeAlpha().raw().toBuffer()
    // One unscaled crop: the only non-white block in the reference is the 65x65 sample at the origin.
    let minX = 688, minY = 576, maxX = -1, maxY = -1
    for (let y = 0; y < 576; y++) {
      for (let x = 0; x < 688; x++) {
        const offset = (y * 688 + x) * 3
        if (referencePixels[offset] === 255 && referencePixels[offset + 1] === 255 && referencePixels[offset + 2] === 255)
          continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    expect({ minX, minY, maxX, maxY }).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 64 })
    expect(await readFile(join(options.outputDir, 'reference-canvas.png'))).toEqual(reference)
    expect(report.artifacts.referenceCanvas).toBe('reference-canvas.png')
    expect(report.generation.prompt).toBe(body.input.messages[0].content[3].text)
    expect(report.placement).toMatchObject({ x: 249, y: 201, size: 205 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('retains raw artwork and failure report for wrong dimensions', async () => {
    const options = await setup()
    const image = join(options.dir, 'wrong.png')
    await sharp({ create: { width: 512, height: 512, channels: 3, background: 'white' } }).png().toFile(image)
    await expect(generatePoster({ ...options, generatedImagePath: image })).rejects.toThrow('Unexpected generated geometry')
    expect(await readFile(join(options.outputDir, 'ai-raw.png'))).toEqual(await readFile(image))
    const report = JSON.parse(await readFile(join(options.outputDir, 'report.json'), 'utf8'))
    expect(report.status).toBe('generation_failed')
    expect(report.qualified).toBe(false)
  })
})
