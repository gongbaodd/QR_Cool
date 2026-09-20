import sharp from 'sharp'
import { randomFillSync } from 'node:crypto'
import { prepareEditor, assembleFromBuffers } from '../src/server/editor'
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
const prepared = await prepareEditor({ posterBytes, content: 'https://example.com/qr' })
const preparationMs = performance.now() - started
const assemblyStarted = performance.now()
const result = await assembleFromBuffers({
  posterBytes,
  content: 'https://example.com/qr',
  placement: prepared.placement,
  seed: 42,
  qrMargin: 1,
  plateCorners: 'texture',
})
const envelope = JSON.stringify({
  artifacts: Object.fromEntries(
    Object.entries(result.artifacts).map(([name, data]) => [name, Buffer.from(data).toString('base64')]),
  ),
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
