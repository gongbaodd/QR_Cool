import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { QrCodeDataType, encode } from 'uqr'
import { afterEach, describe, expect, it } from 'vitest'
import { QrPosterError } from '../src/errors.js'
import {
  PATTERN_ALPHABET,
  PATTERN_MARKER_REFILL,
  countMarkerModules,
  createPatternText,
  generatePatternPreview,
  renderRoundedPattern,
  renderPosterPattern,
  selectPatternVersion,
  stripMarkerModules,
} from '../src/pattern.js'
import { decodeQrBuffer } from '../src/qr.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function grayscale(path: string): Promise<{ data: Uint8Array, width: number, height: number, channels: number }> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: info.channels }
}

describe('pattern version selection', () => {
  it('picks the smallest version covering the poster at the placed pitch', () => {
    expect(selectPatternVersion(5, 688, 566)).toBe(30)
    expect(selectPatternVersion(20, 688, 566)).toBe(4)
    expect(selectPatternVersion(400, 688, 566)).toBe(1)
  })

  it('rejects a pitch no version can cover', () => {
    let error: unknown
    try {
      selectPatternVersion(3, 688, 566)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(QrPosterError)
    expect((error as QrPosterError).code).toBe('QR_LAYOUT_INVALID')
    expect((error as QrPosterError).message).toMatch(/cannot cover/)
  })
})

describe('poster pattern lattice alignment', () => {
  it('phase-locks the window to the placed QR lattice', async () => {
    const aligned = await renderPosterPattern({
      width: 688,
      height: 566,
      modulePixels: 5,
      seed: 1,
      alignTo: { x: 249, y: 201 },
    })
    // A module boundary sits at `k * pitch - offset`, so the window is phase-locked when
    // `offset + phase` is a whole number of modules: 11 + 249 and 69 + 201 are both divisible by 5.
    expect(aligned.crop).toEqual({ left: 11, top: 69 })
    expect((aligned.crop.left + 249) % 5).toBe(0)
    expect((aligned.crop.top + 201) % 5).toBe(0)
    expect(aligned.crop.left).toBeGreaterThanOrEqual(0)
    expect(aligned.crop.left + 688).toBeLessThanOrEqual(aligned.codeSize)
    expect(aligned.crop.top + 566).toBeLessThanOrEqual(aligned.codeSize)

    // Without a lattice to follow the window stays centered, exactly as the preview renders it.
    const centered = await renderPosterPattern({ width: 688, height: 566, modulePixels: 5, seed: 1 })
    expect(centered.crop).toEqual({ left: 10, top: 70 })
    expect(centered.png.equals(aligned.png)).toBe(false)
    expect(centered.seed).toBe(aligned.seed)
    expect(centered.text).toBe(aligned.text)
  })

  it('asks the generator for headroom so a tight canvas still phase-locks', async () => {
    const pattern = await renderPosterPattern({
      width: 700,
      height: 700,
      modulePixels: 5,
      seed: 1,
      alignTo: { x: 249, y: 201 },
    })
    // Version 30 covers 700px exactly at a 5px pitch. Alignment asks for one module of headroom, so
    // the window is still phase-locked instead of collapsing onto the only offset that fits.
    expect(pattern.codeSize).toBeGreaterThanOrEqual(700 + 5)
    expect((pattern.crop.left + 249) % 5).toBe(0)
    expect((pattern.crop.top + 201) % 5).toBe(0)
    expect(pattern.crop.left + 700).toBeLessThanOrEqual(pattern.codeSize)
    expect(pattern.crop.top + 700).toBeLessThanOrEqual(pattern.codeSize)
  })
})

describe('rounded pattern geometry', () => {
  it('draws only the included modules when given an include mask', async () => {
    const matrix = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) => (row + column) % 2 === 0))
    const png = await renderRoundedPattern(matrix, 5, {
      marginModules: 0,
      include: (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2),
    })
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(20)
    expect(info.height).toBe(20)

    // A dark module keeps its cell, a light module keeps its cell white, and every dropped module
    // is fully transparent even where a dark neighbour would have drawn a wedge.
    let opaque = 0
    for (let index = 0; index < info.width * info.height; index++) {
      if (data[index * 4 + 3] === 255)
        opaque++
    }
    expect(opaque).toBe(2 * 25)
    const cellAlpha = (x: number, y: number): number => data[(y * 5 + 2) * info.width * 4 + (x * 5 + 2) * 4 + 3]!
    expect(cellAlpha(1, 1)).toBe(255)
    expect(cellAlpha(2, 2)).toBe(255)
    expect(cellAlpha(0, 0)).toBe(0)
    expect(cellAlpha(3, 3)).toBe(0)
  })

  it('reproduces the reference qrcode.antfu.me rendering', async () => {
    const pitch = 20
    const quietZone = 2
    const total = 41
    const reference = await grayscale(resolve('test/fixtures/qr.png'))
    const matrix: boolean[][] = []
    for (let row = 0; row < total; row++) {
      const values: boolean[] = []
      for (let column = 0; column < total; column++)
        values.push(reference.data[(row * pitch + pitch / 2) * reference.width + column * pitch + pitch / 2]! < 128)
      matrix.push(values)
    }

    const rendered = await renderRoundedPattern(matrix, pitch, { marginModules: 0 })
    const { data, info } = await sharp(rendered).greyscale().raw().toBuffer({ resolveWithObject: true })
    const darkAt = (x: number, y: number): boolean => reference.data[y * reference.width + x]! < 128
    const finderBlock = (x: number, y: number): boolean =>
      (x >= quietZone && x <= quietZone + 8 && y >= quietZone && y <= quietZone + 8)
      || (x >= total - quietZone - 9 && x <= total - quietZone - 1 && y >= quietZone && y <= quietZone + 8)
      || (x >= quietZone && x <= quietZone + 8 && y >= total - quietZone - 9 && y <= total - quietZone - 1)

    let compared = 0
    let edgeMismatch = 0
    let deepMismatch = 0
    for (let row = 0; row < total; row++) {
      for (let column = 0; column < total; column++) {
        if (finderBlock(column, row))
          continue
        for (let localY = 0; localY < pitch; localY++) {
          for (let localX = 0; localX < pitch; localX++) {
            compared++
            const x = column * pitch + localX
            const y = row * pitch + localY
            const expected = darkAt(x, y)
            if ((data[(y * info.width + x) * info.channels]! < 128) === expected)
              continue
            let nearEdge = false
            for (let offsetY = -2; offsetY <= 2 && !nearEdge; offsetY++) {
              for (let offsetX = -2; offsetX <= 2; offsetX++) {
                if (darkAt(x + offsetX, y + offsetY) !== expected) {
                  nearEdge = true
                  break
                }
              }
            }
            if (nearEdge)
              edgeMismatch++
            else
              deepMismatch++
          }
        }
      }
    }

    expect(deepMismatch / compared).toBeLessThan(0.001)
    expect(edgeMismatch / compared).toBeLessThan(0.02)
  })

  it('only bridges cells toward dark neighbours', async () => {
    const pitch = 20
    const isolated = await renderRoundedPattern([[true, false], [false, false]], pitch, { marginModules: 0 })
    const pair = await renderRoundedPattern([[true, true], [false, false]], pitch, { marginModules: 0 })
    const isolatedPixels = await sharp(isolated).greyscale().raw().toBuffer()
    const pairPixels = await sharp(pair).greyscale().raw().toBuffer()
    const darkCount = (buffer: Buffer): number => buffer.reduce((total, value) => total + (value < 128 ? 1 : 0), 0)
    // A lone module stays circular; a dark pair grows a connecting neck.
    expect(darkCount(isolatedPixels)).toBeLessThan(0.8 * pitch * pitch)
    expect(darkCount(pairPixels)).toBeGreaterThan(1.4 * pitch * pitch)
  })
})

describe('marker removal', () => {
  it('refills finder and alignment modules with seeded random cells but keeps timing cells', () => {
    const encoded = encode('https://www.instagram.com/grandpasbeehaven/', { ecc: 'M', border: 0 })
    const refilled = stripMarkerModules(encoded, 1)
    const isMarker = (x: number, y: number): boolean =>
      encoded.types[y]![x] === QrCodeDataType.Position || encoded.types[y]![x] === QrCodeDataType.Alignment
    const isTiming = (x: number, y: number): boolean => encoded.types[y]![x] === QrCodeDataType.Timing

    const markerCells: boolean[] = []
    const timingCells: Array<[boolean, boolean]> = []
    for (let y = 0; y < encoded.size; y++) {
      for (let x = 0; x < encoded.size; x++) {
        if (isMarker(x, y))
          markerCells.push(refilled[y]![x]!)
        else if (isTiming(x, y))
          timingCells.push([encoded.data[y]![x]!, refilled[y]![x]!])
      }
    }

    // Every dropped marker cell is a fresh random bit, not the original marker pixel and never a white hole.
    expect(markerCells).toHaveLength(countMarkerModules(encoded))
    const darkRatio = markerCells.filter(Boolean).length / markerCells.length
    expect(darkRatio).toBeGreaterThan(0.25)
    expect(darkRatio).toBeLessThan(0.75)

    // The refill is seeded: same seed reproduces it, a different seed does not.
    expect(stripMarkerModules(encoded, 1)).toEqual(refilled)
    expect(stripMarkerModules(encoded, 2)).not.toEqual(refilled)

    expect(timingCells.length).toBeGreaterThan(0)
    expect(timingCells.some(([encodedDark]) => encodedDark)).toBe(true)
    expect(timingCells.every(([encodedDark, keptDark]) => encodedDark === keptDark)).toBe(true)
  })

  it('renders a marker-free field with no white marker holes', async () => {
    const encoded = encode('pattern preview', { ecc: 'M', border: 0 })
    const pitch = 10
    const margin = 2
    const rendered = await renderRoundedPattern(stripMarkerModules(encoded, 9), pitch, { marginModules: margin })
    const { data, info } = await sharp(rendered).greyscale().raw().toBuffer({ resolveWithObject: true })
    for (const [originX, originY] of [[0, 0], [encoded.size - 7, 0], [0, encoded.size - 7]]) {
      let dark = 0
      let total = 0
      for (let y = 0; y < 7 * pitch; y++) {
        for (let x = 0; x < 7 * pitch; x++) {
          const px = (originX! + margin) * pitch + x
          const py = (originY! + margin) * pitch + y
          total++
          if (data[(py * info.width + px) * info.channels]! < 128)
            dark++
        }
      }
      const ratio = dark / total
      // Forcing marker cells white used to leave this whole area blank; the refill mixes cells.
      expect(ratio).toBeGreaterThan(0.2)
      expect(ratio).toBeLessThan(0.8)
    }
  })
})

describe('random text line', () => {
  it('fills the version data capacity and is seeded', () => {
    const text = createPatternText(30, 1)
    expect(text).toHaveLength(1370)
    expect([...text].every(character => PATTERN_ALPHABET.includes(character))).toBe(true)
    expect(createPatternText(30, 1)).toBe(text)
    expect(createPatternText(30, 2)).not.toBe(text)
  })

  it('round-trips through a decodable render when markers are kept', async () => {
    const text = createPatternText(4, 7)
    const encoded = encode(text, { ecc: 'M', minVersion: 4, maxVersion: 4, border: 0 })
    const png = await renderRoundedPattern(encoded.data, 12)
    expect(await decodeQrBuffer(png)).toBe(text)
  })
})

describe('pattern preview mode', () => {
  it('writes a poster-sized marker-free pattern with a report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-pattern-'))
    temporaryDirectories.push(outputDir)
    const result = await generatePatternPreview({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      seed: 1,
    })

    expect((await readdir(outputDir)).sort()).toEqual(['pattern.png', 'report.json'])
    const pattern = await sharp(join(outputDir, 'pattern.png')).metadata()
    expect(pattern.width).toBe(688)
    expect(pattern.height).toBe(566)
    expect(pattern.format).toBe('png')

    const { pattern: info } = result.report
    expect(info.seed).toBe(1)
    expect(info.version).toBe(24)
    expect(info.qrModules).toBe(113)
    expect(info.totalModules).toBe(117)
    expect(info.modulePixels).toBe(6)
    expect(info.codeSize).toBe(702)
    expect(info.crop).toEqual({ left: 6, top: 66 })
    expect(info.textLength).toBe(911)
    expect(info.removedTypes).toEqual(['Position', 'Alignment'])
    expect(info.markerRefill).toBe(PATTERN_MARKER_REFILL)
    expect(info.refilledModules).toBeGreaterThan(3 * 81)
    expect(info.pixelStyle).toBe('rounded')
    expect(result.report.pitchSource).toBe('placement')
    expect(result.report.placement).toMatchObject({ x: 218, y: 181, size: 246, modulePixels: 6, artPaddingModules: 0 })
    expect(result.report.region.source).toBe('auto')

    const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
    expect(report.schemaVersion).toBe(3)
    expect(report.mode).toBe('pattern-preview')
    expect(report.artifacts.patternSha256).toBe(result.report.artifacts.patternSha256)
  })

  it('is reproducible for a seed, varies by seed, and protects existing artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-pattern-'))
    temporaryDirectories.push(outputDir)
    const base = {
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
    }
    const first = await generatePatternPreview({ ...base, seed: 3 })
    await expect(generatePatternPreview({ ...base, seed: 3 })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS', exitCode: 2 })
    const repeated = await generatePatternPreview({ ...base, seed: 3, force: true })
    expect(repeated.report.artifacts.patternSha256).toBe(first.report.artifacts.patternSha256)
    const reseeded = await generatePatternPreview({ ...base, seed: 4, force: true })
    expect(reseeded.report.artifacts.patternSha256).not.toBe(first.report.artifacts.patternSha256)
  })

  it('honours an explicit module pitch', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-cool-pattern-'))
    temporaryDirectories.push(outputDir)
    const result = await generatePatternPreview({
      inputPath: resolve('source/poster.png'),
      qrPath: resolve('test/fixtures/qr.png'),
      outputDir,
      modulePixels: 20,
      seed: 5,
    })
    expect(result.report.pitchSource).toBe('override')
    expect(result.report.pattern.modulePixels).toBe(20)
    expect(result.report.pattern.version).toBe(4)
    const pattern = await sharp(join(outputDir, 'pattern.png')).metadata()
    expect(pattern.width).toBe(688)
    expect(pattern.height).toBe(566)
  })
})
