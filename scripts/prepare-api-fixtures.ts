import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { browserImaging, installBrowserImaging } from '@mahu-qr/renderer/core/imaging/browser'
import { createEditorEngine } from '@mahu-qr/renderer/engine'
import { engineDefaults } from '@mahu-qr/renderer/engine/pipeline'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, 'test/api/fixtures')
const expectedRoot = path.join(fixtureRoot, 'expected')
const generatedRoot = path.join(root, 'output/api-tests/fixtures')
const resvgWasm = await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))
const pngWasm = await readFile(require.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
await installBrowserImaging({ resvgWasm, pngWasm })
await mkdir(expectedRoot, { recursive: true })
await mkdir(generatedRoot, { recursive: true })

const width = 360
const height = 320
const recipeSettings = {
  ...engineDefaults,
  seed: 0x4d414855,
  regionMargin: true,
  rimModules: 2,
  colors: { pixel: '#172b4d', marker: '#172b4d', background: '#ffffff' },
}
const content = 'https://example.com/mahu-qr-worker-api'

async function makeInputs(transparent: boolean) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = 250
      rgba[offset + 1] = 246
      rgba[offset + 2] = 239
      rgba[offset + 3] = transparent ? 0 : 255
    }
  }
  const poster = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .composite(
      transparent
        ? []
        : [
            {
              input: Buffer.from(
                `<svg width="${width}" height="${height}"><rect x="24" y="24" width="312" height="272" rx="4" fill="#101211"/><path d="M36 36h288v248H36z" fill="#fdf8f2"/></svg>`,
              ),
            },
          ],
    )
    .png()
    .toBuffer()
  const maskData = Buffer.alloc(width * height * 4)
  for (let y = 40; y < height - 40; y++) {
    for (let x = 40; x < width - 40; x++) {
      const offset = (y * width + x) * 4
      maskData[offset] = 255
      maskData[offset + 1] = 255
      maskData[offset + 2] = 255
      maskData[offset + 3] = 255
    }
  }
  const mask = await sharp(maskData, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return { poster, mask }
}

async function makeFixture(name: string, options: { transparent?: boolean; rotation?: number } = {}) {
  const { poster, mask } = await makeInputs(options.transparent ?? false)
  const engine = await createEditorEngine(browserImaging)
  const input = { posterBytes: new Uint8Array(poster), maskBytes: new Uint8Array(mask), content }
  const prepared = await engine.prepare(input, 1)
  if (!prepared.ok) throw new Error(`${name}: preparation failed: ${prepared.error.message}`)
  const placement = { ...prepared.value.placement, rotation: options.rotation ?? 0 }
  const assembled = await engine.assemble(
    {
      ...input,
      placement,
      transparentBlank: options.transparent ?? false,
      seed: recipeSettings.seed,
      qrMargin: 1,
      plateCorners: recipeSettings.plateCorners,
      regionMargin: recipeSettings.regionMargin,
      rimModules: recipeSettings.rimModules,
      rimRounded: recipeSettings.rimRounded,
      ecc: recipeSettings.ecc,
      pixelStyle: recipeSettings.pixelStyle,
      finderMarkers: recipeSettings.finderMarkers,
      markerSub: recipeSettings.markerSub,
      colors: recipeSettings.colors,
    },
    1,
  )
  if (!assembled.ok) throw new Error(`${name}: assembly failed: ${assembled.error.message}`)
  if (!assembled.value.recipe) throw new Error(`${name}: recipe export failed: ${assembled.value.recipeError}`)

  const recipe = Buffer.from(await assembled.value.recipe.arrayBuffer())
  const recipeObject = JSON.parse(recipe.toString('utf8')) as { source: { width: number; height: number } }
  await writeFile(
    path.join(fixtureRoot, `${name}.recipe.json`),
    `${JSON.stringify(JSON.parse(recipe.toString()), null, 2)}\n`,
  )

  const hashes: Record<string, string> = {}
  for (const artifact of ['poster.png', 'qr.png'] as const) {
    const blob = assembled.value.artifacts[artifact]
    if (!blob) throw new Error(`${name}: missing ${artifact}`)
    const bytes = Buffer.from(await blob.arrayBuffer())
    const filename = `${name}.${artifact}`
    await writeFile(path.join(expectedRoot, filename), bytes)
    hashes[artifact] = await browserImaging.sha256Hex(new Uint8Array(bytes))
  }
  return { name, width: recipeObject.source.width, height: recipeObject.source.height, hashes }
}

const fixtures = [
  await makeFixture('baseline'),
  await makeFixture('transparent', { transparent: true }),
  await makeFixture('rotated', { rotation: 90 }),
]
await writeFile(path.join(expectedRoot, 'manifest.json'), `${JSON.stringify(fixtures, null, 2)}\n`)

const baseline = JSON.parse(await readFile(path.join(fixtureRoot, 'baseline.recipe.json'), 'utf8')) as {
  schemaVersion: number
  rendererVersion: string
  content: string
  source: { poster: { data: string; sha256: string }; regionMask: unknown; width: number; height: number }
  placement: { x: number }
  settings: { colors: { pixel: string; marker: string; background: string } }
}
const invalidPng = Buffer.from('not a PNG image')
const invalidPngRecipe = {
  ...baseline,
  source: {
    ...baseline.source,
    poster: {
      mimeType: 'image/png',
      encoding: 'base64',
      sha256: await browserImaging.sha256Hex(new Uint8Array(invalidPng)),
      data: invalidPng.toString('base64'),
    },
  },
}
const invalidCases = {
  'invalid-digest.recipe.json': { ...baseline, content: `${baseline.content}/tampered` },
  'invalid-schema.recipe.json': { ...baseline, schemaVersion: 99 },
  'invalid-renderer.recipe.json': { ...baseline, rendererVersion: 'mahu-qr-renderer-99' },
  'invalid-unknown-field.recipe.json': { ...baseline, unknownField: true },
  'invalid-required-field.recipe.json': Object.fromEntries(
    Object.entries(baseline).filter(([key]) => key !== 'content'),
  ),
  'invalid-content.recipe.json': { ...baseline, content: 'line one\nline two' },
  'invalid-base64.recipe.json': {
    ...baseline,
    source: {
      ...baseline.source,
      poster: { ...baseline.source.poster, data: '***not-base64***' },
    },
  },
  'invalid-dimensions.recipe.json': { ...baseline, source: { ...baseline.source, width: baseline.source.width - 1 } },
  'invalid-png.recipe.json': invalidPngRecipe,
  'invalid-placement.recipe.json': { ...baseline, placement: { ...baseline.placement, x: -100_000 } },
  'invalid-color.recipe.json': {
    ...baseline,
    settings: { ...baseline.settings, colors: { pixel: '#000000', marker: '#000000', background: '#000001' } },
  },
  'oversized-image.recipe.json': {
    ...baseline,
    source: { ...baseline.source, poster: { ...baseline.source.poster, data: 'A'.repeat(14 * 1024 * 1024) } },
  },
  'oversized-dimensions.recipe.json': {
    ...baseline,
    source: { ...baseline.source, width: 4_000_001, height: 1 },
  },
}
for (const [filename, value] of Object.entries(invalidCases))
  await writeFile(
    path.join(filename.startsWith('oversized-') ? generatedRoot : fixtureRoot, filename),
    `${JSON.stringify(value)}\n`,
  )
await writeFile(path.join(fixtureRoot, 'invalid-utf8.bin'), Buffer.from([0xc3, 0x28]))
await writeFile(
  path.join(generatedRoot, 'oversized-request.json'),
  JSON.stringify({ body: 'x'.repeat(28 * 1024 * 1024) }),
)
console.log(`Prepared ${fixtures.length} browser-WASM fixtures in ${path.relative(root, fixtureRoot)}.`)
