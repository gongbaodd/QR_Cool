/**
 * Pure-TS pixel operations shared by pixel-writing backends. The sharp backend keeps its
 * own native compositing so its bytes stay bit-identical; these helpers implement the same
 * document semantics for browser-style backends (exact integer arithmetic, no resampling
 * ambiguity beyond the documented nearest-neighbor tie rule).
 */

import type { RawImage } from './types'

/** Flattens alpha over an opaque white background: `out = c*a/255 + 255*(1 - a/255)`, truncated. */
export function flattenOverWhite(data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!
    output[offset] = Math.trunc((data[offset]! * alpha + 255 * (255 - alpha)) / 255)
    output[offset + 1] = Math.trunc((data[offset + 1]! * alpha + 255 * (255 - alpha)) / 255)
    output[offset + 2] = Math.trunc((data[offset + 2]! * alpha + 255 * (255 - alpha)) / 255)
    output[offset + 3] = 255
  }
  return output
}

/**
 * Standard source-over blend of full-size unpremultiplied RGBA overlay rasters over an
 * opaque base. Alpha compositing uses the same blend libvips performs; differences stay
 * limited to SVG antialiasing, which the renderers already treat as free.
 */
export function compositeOver(base: RawImage, overlays: RawImage[]): Uint8Array {
  const output = Uint8Array.from(base.data)
  for (const overlay of overlays) {
    if (overlay.width !== base.width || overlay.height !== base.height)
      throw new RangeError(
        `Overlay ${overlay.width}x${overlay.height} does not match base ${base.width}x${base.height}.`,
      )
    for (let offset = 0; offset < output.length; offset += 4) {
      const sourceAlpha = overlay.data[offset + 3]!
      if (sourceAlpha === 0) continue
      const destinationAlpha = output[offset + 3]!
      const weight = sourceAlpha * 255 + destinationAlpha * (255 - sourceAlpha)
      output[offset + 3] = Math.trunc(weight / 255)
      for (let channel = 0; channel < 3; channel++) {
        const source = overlay.data[offset + channel]!
        const destination = output[offset + channel]!
        const value = (source * sourceAlpha * 255 + destination * destinationAlpha * (255 - sourceAlpha)) / weight
        output[offset + channel] = weight > 0 ? Math.trunc(value) : 0
      }
    }
  }
  return output
}

/**
 * Integer nearest-neighbor resample. Exactly deterministic (no kernel ambiguity): the output
 * pixel picks `floor((x + 0.5) * input / output)` per axis, which is libvips' nearest rule
 * for fractional shrink factors.
 */
export function resizeNearest(raw: RawImage, width: number, height: number): Uint8Array {
  if (raw.width === width && raw.height === height) return Uint8Array.from(raw.data)
  const output = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceY = Math.floor(((y + 0.5) * raw.height) / height)
    const sourceRow = sourceY * raw.width
    const targetRow = y * width
    for (let x = 0; x < width; x++) {
      const sourceX = Math.floor(((x + 0.5) * raw.width) / width)
      const source = (sourceRow + sourceX) * 4
      const target = (targetRow + x) * 4
      for (let channel = 0; channel < 4; channel++) output[target + channel] = raw.data[source + channel]!
    }
  }
  return output
}

/** Copies a subrectangle without resampling. */
export function cropRgba(raw: RawImage, x: number, y: number, width: number, height: number): Uint8Array {
  if (x < 0 || y < 0 || x + width > raw.width || y + height > raw.height)
    throw new RangeError(`Crop ${width}x${height}+${x}+${y} does not fit ${raw.width}x${raw.height}.`)
  const output = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const source = ((y + row) * raw.width + x) * 4
    output.set(raw.data.subarray(source, source + width * 4), row * width * 4)
  }
  return output
}
