import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCutPath,
  buildShapeSelection,
  generatePatternCut,
} from '../src/pattern-cut.js'
import { loadPng } from '../src/image.js'
import { generatePatternPreview } from '../src/pattern.js'
import { preparePoster } from '../src/prepare.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qr-cool-cut-'))
  temporaryDirectories.push(path)
  return path
}

type MaskStyle = 'transparent-kept' | 'dark-kept'

async function writeMask(
  path: string,
  width: number,
  height: number,
  isInside: (x: number, y: number) => boolean,
  style: MaskStyle,
): Promise<void> {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const inside = isInside(x, y)
      if (style === 'transparent-kept') {
        data[offset] = 255
        data[offset + 1] = 255
        data[offset + 2] = 255
        data[offset + 3] = inside ? 0 : 255
      }
      else {
        const value = inside ? 0 : 255
        data[offset] = value
        data[offset + 1] = value
        data[offset + 2] = value
        data[offset + 3] = 255
      }
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path)
}

/** A deterministic black-on-white checkerboard with a white border, used as cuttable artwork. */
async function writePattern(path: string, width: number, height: number): Promise<void> {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const dark = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0
      const value = dark ? 0 : 255
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path)
}

function selection(width: number, height: number, isInside: (x: number, y: number) => boolean): Uint8Array {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data[y * width + x] = isInside(x, y) ? 1 : 0
  return data
}

describe('outline tracing and filleting', () => {
  it('turns a rectangle into one loop with four rounded corners', () => {
    const path = buildCutPath(selection(200, 200, (x, y) => x >= 40 && x < 120 && y >= 40 && y < 90), 200, 200)
    expect(path.stats.loopsTraced).toBe(1)
    expect(path.stats.loopsKept).toBe(1)
    expect(path.stats.holes).toBe(0)
    expect(path.stats.specksDropped).toBe(0)
    // The traced pixel border has one vertex per unit step before simplification.
    expect(path.stats.verticesTraced).toBe(2 * (80 + 50))
    expect(path.stats.verticesSimplified).toBe(4)
    expect(path.stats.area).toBe(80 * 50)
    expect(path.stats.bounds).toEqual({ x: 40, y: 40, width: 80, height: 50 })
    expect(path.d.match(/M/g)).toHaveLength(1)
    expect(path.d.match(/A/g)).toHaveLength(4)
    expect(path.d.endsWith('Z')).toBe(true)
  })

  it('keeps a rectangular hole as a second even-odd subpath', () => {
    const isInside = (x: number, y: number): boolean => {
      const outer = x >= 40 && x < 160 && y >= 40 && y < 140
      const hole = x >= 80 && x < 120 && y >= 80 && y < 110
      return outer && !hole
    }
    const path = buildCutPath(selection(200, 200, isInside), 200, 200)
    expect(path.stats.loopsTraced).toBe(2)
    expect(path.stats.loopsKept).toBe(2)
    expect(path.stats.holes).toBe(1)
    expect(path.stats.area).toBe(120 * 100 - 40 * 30)
    expect(path.d.match(/M/g)).toHaveLength(2)
    expect(path.d.match(/A/g)).toHaveLength(8)
  })

  it('drops loops smaller than the fillet area as specks', () => {
    const isInside = (x: number, y: number): boolean =>
      (x >= 40 && x < 160 && y >= 40 && y < 140) || (x >= 180 && x < 182 && y >= 180 && y < 182)
    const path = buildCutPath(selection(200, 200, isInside), 200, 200)
    expect(path.stats.loopsTraced).toBe(2)
    expect(path.stats.loopsKept).toBe(1)
    expect(path.stats.specksDropped).toBe(1)
    expect(path.stats.area).toBe(120 * 100)
  })

  it('clamps the fillet on a feature narrower than the radius', () => {
    const path = buildCutPath(selection(200, 200, (x, y) => x >= 10 && x < 18 && y >= 10 && y < 70), 200, 200, { radius: 5 })
    const arcs = [...path.d.matchAll(/A([\d.]+),([\d.]+)/g)].map(match => Number(match[1]))
    expect(arcs).toHaveLength(4)
    // An 8px-wide bar caps the tangent at 4px, so the arc radius cannot reach the requested 5px.
    expect(Math.max(...arcs)).toBeLessThanOrEqual(4)
    expect(Math.max(...arcs)).toBeGreaterThan(3.9)
    expect(path.stats.radiusClamped).toBe(true)
    expect(path.d).not.toMatch(/NaN/)
    expect(path.stats.area).toBe(8 * 60)
  })

  it('reports when smoothing leaves nothing to cut', () => {
    // A 3px bar cannot survive a 3px smoothing tolerance; the error points at the knobs.
    expect(() => buildCutPath(selection(200, 200, (x, y) => x >= 10 && x < 13 && y >= 10 && y < 60), 200, 200))
      .toThrowError(/does not select any cut shape that survives a 3px smoothing tolerance/)
  })

  it('accepts both mask conventions as the same shape', async () => {
    const directory = await temporaryDirectory()
    const isInside = (x: number, y: number): boolean => x >= 40 && x < 160 && y >= 40 && y < 140
    const transparentMask = join(directory, 'edit-style.png')
    const darkMask = join(directory, 'region-style.png')
    await writeMask(transparentMask, 200, 200, isInside, 'transparent-kept')
    await writeMask(darkMask, 200, 200, isInside, 'dark-kept')

    const transparent = buildShapeSelection(await loadPng(transparentMask, 'mask'))
    const dark = buildShapeSelection(await loadPng(darkMask, 'mask'))
    expect(transparent).toEqual(dark)
  })
})

describe('pattern cut mode', () => {
  it('writes a self-contained SVG and a transparent PNG without resampling the pattern', async () => {
    const directory = await temporaryDirectory()
    const patternPath = join(directory, 'pattern.png')
    const maskPath = join(directory, 'mask.png')
    const outputDir = join(directory, 'out')
    await writePattern(patternPath, 200, 200)
    await writeMask(maskPath, 200, 200, (x, y) => x >= 40 && x < 160 && y >= 30 && y < 150, 'transparent-kept')

    const result = await generatePatternCut({ inputPath: patternPath, maskPath, outputDir })
    expect((await readdir(outputDir)).sort()).toEqual(['pattern-cut.png', 'pattern-cut.svg', 'report.json'])
    expect(result.report.schemaVersion).toBe(4)
    expect(result.report.mode).toBe('pattern-cut')
    expect(result.report.cut).toEqual({ radius: 5, smoothTolerance: 3, keep: 'transparent-or-dark', minLoopArea: 25 })
    expect(result.report.shape.loopsKept).toBe(1)

    const written = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
    expect(written.schemaVersion).toBe(4)
    expect(written.artifacts.pngSha256).toBe(result.report.artifacts.pngSha256)

    const source = await sharp(patternPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const cut = await sharp(join(outputDir, 'pattern-cut.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(cut.info.width).toBe(200)
    expect(cut.info.height).toBe(200)

    let outside = 0
    let interior = 0
    let edge = 0
    let mismatches = 0
    for (let y = 0; y < cut.info.height; y++) {
      for (let x = 0; x < cut.info.width; x++) {
        const offset = (y * cut.info.width + x) * 4
        const alpha = cut.data[offset + 3]!
        if (alpha === 0) {
          outside++
          continue
        }
        if (alpha < 255) {
          edge++
          continue
        }
        interior++
        const sourceOffset = (y * source.info.width + x) * 3
        if (cut.data[offset] !== source.data[sourceOffset]
          || cut.data[offset + 1] !== source.data[sourceOffset + 1]
          || cut.data[offset + 2] !== source.data[sourceOffset + 2])
          mismatches++
      }
    }
    expect(outside).toBeGreaterThan(0)
    expect(edge).toBeGreaterThan(0)
    // Every pixel strictly inside the cut keeps the original pattern bits.
    expect(interior).toBeGreaterThan(100 * 120)
    expect(mismatches).toBe(0)

    const svg = await readFile(join(outputDir, 'pattern-cut.svg'), 'utf8')
    expect(svg).toContain('<clipPath id="pattern-cut">')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain(`clip-path="url(#pattern-cut)"`)
    const payload = /base64,([A-Za-z0-9+/=]+)"/.exec(svg)?.[1]
    expect(payload).toBeDefined()
    expect(Buffer.from(payload!, 'base64').equals(await readFile(patternPath))).toBe(true)
  })

  it('is reproducible and protects existing artifacts', async () => {
    const directory = await temporaryDirectory()
    const patternPath = join(directory, 'pattern.png')
    const maskPath = join(directory, 'mask.png')
    const outputDir = join(directory, 'out')
    await writePattern(patternPath, 200, 200)
    await writeMask(maskPath, 200, 200, (x, y) => x >= 40 && x < 160 && y >= 30 && y < 150, 'dark-kept')

    const first = await generatePatternCut({ inputPath: patternPath, maskPath, outputDir })
    await expect(generatePatternCut({ inputPath: patternPath, maskPath, outputDir }))
      .rejects.toMatchObject({ code: 'OUTPUT_EXISTS', exitCode: 2 })
    const repeated = await generatePatternCut({ inputPath: patternPath, maskPath, outputDir, force: true })
    expect(repeated.report.artifacts.svgSha256).toBe(first.report.artifacts.svgSha256)
    expect(repeated.report.artifacts.pngSha256).toBe(first.report.artifacts.pngSha256)
  })

  it('rejects a mask that does not match the pattern or selects nothing', async () => {
    const directory = await temporaryDirectory()
    const patternPath = join(directory, 'pattern.png')
    await writePattern(patternPath, 200, 200)

    const smallMask = join(directory, 'small.png')
    await writeMask(smallMask, 100, 100, () => true, 'transparent-kept')
    await expect(generatePatternCut({ inputPath: patternPath, maskPath: smallMask, outputDir: join(directory, 'a') }))
      .rejects.toMatchObject({ code: 'MASK_INVALID', exitCode: 2 })

    const emptyMask = join(directory, 'empty.png')
    await writeMask(emptyMask, 200, 200, () => false, 'transparent-kept')
    await expect(generatePatternCut({ inputPath: patternPath, maskPath: emptyMask, outputDir: join(directory, 'b') }))
      .rejects.toMatchObject({ code: 'MASK_INVALID', exitCode: 2 })
  })

  it('cuts the real poster pattern with the generated edit mask', async () => {
    const preparedDir = await temporaryDirectory()
    const patternDir = await temporaryDirectory()
    const outputDir = await temporaryDirectory()
    const infix = { inputPath: resolve('source/poster.png'), qrPath: resolve('test/fixtures/qr.png') }

    await preparePoster({ ...infix, outputDir: preparedDir, dryRun: true })
    await generatePatternPreview({ ...infix, outputDir: patternDir, seed: 1 })
    const result = await generatePatternCut({
      inputPath: join(patternDir, 'pattern.png'),
      maskPath: join(preparedDir, 'edit-mask.png'),
      outputDir,
    })

    // The blob plus its QR-box hole, with the jagged mask edge's specks removed.
    expect(result.report.shape.loopsKept).toBe(2)
    expect(result.report.shape.holes).toBe(1)
    expect(result.report.shape.specksDropped).toBeGreaterThan(0)
    expect(result.report.shape.bounds).toEqual({ x: 169, y: 104, width: 379, height: 420 })
    expect(result.report.shape.area).toBeGreaterThan(80_000)
    expect(result.report.shape.area).toBeLessThan(90_000)
    expect(result.report.warnings.some(warning => warning.includes('dropped as specks'))).toBe(true)

    const source = await sharp(join(patternDir, 'pattern.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const cut = await sharp(join(outputDir, 'pattern-cut.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(cut.info.width).toBe(688)
    expect(cut.info.height).toBe(566)

    const mask = await loadPng(join(preparedDir, 'edit-mask.png'), 'mask')
    const selected = buildShapeSelection(mask)
    const deepInside = erode(selected, mask.width, mask.height, 12)

    let sampled = 0
    let mismatches = 0
    for (let y = 0; y < cut.info.height; y++) {
      for (let x = 0; x < cut.info.width; x++) {
        const index = y * cut.info.width + x
        if (deepInside[index] !== 1)
          continue
        const offset = index * 4
        if (cut.data[offset + 3] !== 255) {
          mismatches++
          continue
        }
        sampled++
        const sourceOffset = index * 3
        if (cut.data[offset] !== source.data[sourceOffset]
          || cut.data[offset + 1] !== source.data[sourceOffset + 1]
          || cut.data[offset + 2] !== source.data[sourceOffset + 2])
          mismatches++
      }
    }
    expect(sampled).toBeGreaterThan(40_000)
    expect(mismatches).toBe(0)
  })

  it('keeps a radius of zero as plain polygon corners', async () => {
    const directory = await temporaryDirectory()
    const patternPath = join(directory, 'pattern.png')
    const maskPath = join(directory, 'mask.png')
    await writePattern(patternPath, 200, 200)
    await writeMask(maskPath, 200, 200, (x, y) => x >= 40 && x < 160 && y >= 30 && y < 150, 'transparent-kept')
    const result = await generatePatternCut({
      inputPath: patternPath,
      maskPath,
      outputDir: join(directory, 'out'),
      radius: 0,
    })
    expect(result.report.cut.radius).toBe(0)
    expect(result.report.shape.area).toBe(120 * 120)
  })

  it('rejects a negative radius before touching the output directory', async () => {
    const directory = await temporaryDirectory()
    const patternPath = join(directory, 'pattern.png')
    const maskPath = join(directory, 'mask.png')
    await writePattern(patternPath, 200, 200)
    await writeMask(maskPath, 200, 200, () => true, 'transparent-kept')
    await expect(generatePatternCut({
      inputPath: patternPath,
      maskPath,
      outputDir: join(directory, 'out'),
      radius: -1,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 })
  })
})

/** Separable box erosion, used to pick pixels safely away from the cut edge. */
function erode(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(source.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1
      for (let dx = -radius; dx <= radius && keep === 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= width || source[y * width + nx] !== 1)
          keep = 0
      }
      horizontal[y * width + x] = keep
    }
  }
  const output = new Uint8Array(source.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1
      for (let dy = -radius; dy <= radius && keep === 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height || horizontal[ny * width + x] !== 1)
          keep = 0
      }
      output[y * width + x] = keep
    }
  }
  return output
}
