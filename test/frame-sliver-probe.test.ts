import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { createEditorEngine } from '@mahu-qr/renderer/engine'
import { nodeImaging } from '@mahu-qr/renderer/core/imaging/node'
import { prepareSource } from '@mahu-qr/renderer/engine/pipeline'
import {
  localPointInPlate,
  posterToPlatePoint,
  qrWorkingFrame,
  regionPixelBounds,
  rotatedFootprintBounds,
} from '@mahu-qr/renderer/core/rotate'
import type { EditorEngineApi, EngineOutcome } from '@mahu-qr/renderer/engine'

const posterBytes = new Uint8Array(await readFile('source/poster.png'))
const content = 'https://example.com/qr'
const makeEngine = (): Promise<EditorEngineApi> => createEditorEngine(nodeImaging)

function assertOk<T>(outcome: EngineOutcome<T>): T {
  if (!outcome.ok) throw new Error(`Expected engine success, got: ${JSON.stringify(outcome)}`)
  return outcome.value
}

describe('probe: working frame vs writable poster pixels', () => {
  it.each([15, 30, 45, 60, 90])('counts region pixels the %s° frame drops', async (rotation) => {
    const session = await makeEngine()
    const prepared = assertOk(await session.prepare({ posterBytes, content }, 1))
    const modules = prepared.qrMetadata.totalModules
    const centreX = prepared.placement.x + prepared.placement.size / 2
    const centreY = prepared.placement.y + prepared.placement.size / 2
    let sizeFactor = rotation === 90 ? 1 : 0.7
    let placement = prepared.placement
    for (;;) {
      const size = Math.floor((prepared.placement.size * sizeFactor) / modules) * modules
      placement = {
        x: Math.max(0, Math.round(centreX - size / 2)),
        y: Math.max(0, Math.round(centreY - size / 2)),
        size,
        rotation,
      }
      const attempt = assertOk(await session.prepare({ posterBytes, content, placement }, 2))
      if (!attempt.validation) break
      sizeFactor -= 0.05
      if (sizeFactor <= 0.2) throw new Error('no rotated placement fits the fixture region')
    }

    // Rebuild the same state the engine caches: poster size, region mask, final placement.
    const { poster, regionMask } = await prepareSource(nodeImaging, posterBytes)
    void poster

    const p = placement
    const bounds = regionPixelBounds({ data: regionMask.data, width: regionMask.width, height: regionMask.height })
    const frame = qrWorkingFrame(p, bounds)
    const { fitsMask } = await import('@mahu-qr/renderer/schema')
    const directFits = fitsMask(regionMask.data, regionMask.width, regionMask.height, p)
    // Reimplement the fitsMask rotated loop to find the first pixel it should reject on.
    let firstViolation: string | undefined
    {
      const fp = rotatedFootprintBounds(p, regionMask.width, regionMask.height)
      outer: for (let y = fp.top; y < fp.bottom; y++) {
        for (let x = fp.left; x < fp.right; x++) {
          const local = posterToPlatePoint(x + 0.5, y + 0.5, p)
          if (!localPointInPlate(local.x, local.y, p.size)) continue
          if (!regionMask.data[y * regionMask.width + x]) {
            firstViolation = JSON.stringify({ x, y, local: { x: local.x, y: local.y } })
            break outer
          }
        }
      }
    }
    // Cross-check: the mask's own stats vs my regionPixelBounds scan, plus raw pixel probes.
    const maskValueAt = (x: number, y: number) => regionMask.data[y * regionMask.width + x]
    let scanX1 = 0
    let scanArea = 0
    for (let y = 0; y < regionMask.height; y++)
      for (let x = 0; x < regionMask.width; x++)
        if (maskValueAt(x, y)) {
          scanArea++
          scanX1 = Math.max(scanX1, x + 1)
        }
    const corners = [
      posterToPlatePoint(bounds.x0, bounds.y0, p),
      posterToPlatePoint(bounds.x1, bounds.y0, p),
      posterToPlatePoint(bounds.x1, bounds.y1, p),
      posterToPlatePoint(bounds.x0, bounds.y1, p),
    ]
    const size = p.size
    let insideSquareAndRegion = 0
    let dropped = 0
    let droppedInPlateInset = 0
    let qrBoxClippedX = frame.qr.x < 0 || frame.qr.x + size > frame.width
    let qrBoxClippedY = frame.qr.y < 0 || frame.qr.y + size > frame.height
    for (let row = 0; row < regionMask.height; row++) {
      for (let column = 0; column < regionMask.width; column++) {
        if (!regionMask.data[row * regionMask.width + column]) continue
        const local = posterToPlatePoint(column + 0.5, row + 0.5, p)
        if (!(local.x >= 0 && local.y >= 0 && local.x < size && local.y < size)) continue
        insideSquareAndRegion++
        const wx = Math.floor(local.x - frame.left)
        const wy = Math.floor(local.y - frame.top)
        const inFrame = wx >= 0 && wy >= 0 && wx < frame.width && wy < frame.height
        if (!inFrame) {
          dropped++
          // Inside the plate hole's outer bound (2-module quiet zone inset): must be QR pixels.
          if (
            local.x >= frame.qr.x + 2 * p.modulePixels &&
            local.y >= frame.qr.y + 2 * p.modulePixels &&
            local.x < frame.qr.x + size - 2 * p.modulePixels &&
            local.y < frame.qr.y + size - 2 * p.modulePixels
          )
            droppedInPlateInset++
        }
      }
    }
    console.log(
      JSON.stringify({
        rotation,
        placement: p,
        autoPlacement: prepared.placement,
        directFits,
        firstViolation,
        maskStatsBounds: regionMask.bounds,
        maskStatsArea: regionMask.area,
        myScan: { area: scanArea, x1: scanX1 },
        probePixels: {
          '300,300': maskValueAt(300, 300),
          '200,300': maskValueAt(200, 300),
          '240,300': maskValueAt(240, 300),
        },
        regionBounds: bounds,
        poster: { width: regionMask.width, height: regionMask.height },
        mappedCorners: corners.map((c) => ({ x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 })),
        frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
        qrBoxClippedX,
        qrBoxClippedY,
        insideSquareAndRegion,
        droppedOutsideFrame: dropped,
        droppedInsidePlateInset: droppedInPlateInset,
      }),
    )
    expect(true).toBe(true)
  })
})
