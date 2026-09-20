import sharp from 'sharp'
import { randomFillSync } from 'node:crypto'
import { createEditorEngine } from '../src/lib/editor/engine'
import { nodeImaging } from '../src/core/imaging/node'
import { MAX_PIXELS } from '../src/lib/editor/schema'
const side = Math.floor(Math.sqrt(MAX_PIXELS))
const pixels = randomFillSync(Buffer.alloc(side * side * 3))
const posterBytes = await sharp(pixels, { raw: { width: side, height: side, channels: 3 } })
  .composite([
    {
      input: await sharp({
        create: { width: Math.floor(side * 0.8), height: Math.floor(side * 0.8), channels: 4, background: 'black' },
      })
        .png()
        .toBuffer(),
      left: Math.floor(side * 0.1),
      top: Math.floor(side * 0.1),
    },
  ])
  .png()
  .toBuffer()
const started = performance.now()
const session = await createEditorEngine(nodeImaging)
const prepareOutcome = await session.prepare({ posterBytes, content: 'https://example.com/qr' }, 1)
if (!prepareOutcome.ok) throw new Error(`prepare failed: ${JSON.stringify(prepareOutcome)}`)
const prepared = prepareOutcome.value
const preparationMs = performance.now() - started
const assemblyStarted = performance.now()
const assembleOutcome = await session.assemble(
  {
    posterBytes,
    content: 'https://example.com/qr',
    placement: prepared.placement,
    seed: 42,
    qrMargin: 1,
    plateCorners: 'texture',
  },
  1,
)
if (!assembleOutcome.ok) throw new Error(`assemble failed: ${JSON.stringify(assembleOutcome)}`)
const result = assembleOutcome.value
const artifacts: Record<string, string> = {}
for (const [name, data] of Object.entries(result.artifacts))
  artifacts[name] = Buffer.from(await data.arrayBuffer()).toString('base64')
const envelope = JSON.stringify({
  artifacts,
  report: result.report,
})
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      dimensions: [side, side],
      pixels: side * side,
      preparationMs: Math.round(preparationMs),
      assemblyMs: Math.round(performance.now() - assemblyStarted),
      responseMiB: +(Buffer.byteLength(envelope) / 1048576).toFixed(2),
      peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
      qualified: result.report.qualified,
    },
    null,
    2,
  ),
)
