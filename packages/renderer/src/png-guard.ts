/**
 * Client-side upload guards with the same semantics as the old server `readImage`:
 * PNG signature, dimensions from IHDR, single-frame (no `acTL` animation chunks),
 * and the byte/megapixel limits. Parses the header bytes only — no full decode.
 */

import { MAX_IMAGE_BYTES, MAX_PIXELS } from './schema'

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const TYPE_IHDR = Uint8Array.from([73, 72, 68, 82])
const TYPE_ACTL = Uint8Array.from([97, 99, 84, 76])

export type GuardCode = 'PNG_INVALID' | 'UPLOAD_LIMIT'

/** Thrown with the exact codes the editor UI maps to field errors. */
export class PngGuardError extends Error {
  readonly code: GuardCode
  readonly field: string

  constructor(code: GuardCode, message: string, field: string) {
    super(message)
    this.name = 'PngGuardError'
    this.code = code
    this.field = field
  }
}

export interface PngHeaderInfo {
  width: number
  height: number
}

function matches(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  for (let index = 0; index < expected.length; index++) if (bytes[offset + index] !== expected[index]) return false
  return true
}

export function parsePngHeader(bytes: Uint8Array, field: string): PngHeaderInfo {
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new PngGuardError('UPLOAD_LIMIT', 'Each PNG must be 10 MiB or smaller.', field)
  if (bytes.length < 33 || !matches(bytes, 0, PNG_SIGNATURE))
    throw new PngGuardError('PNG_INVALID', 'Choose a valid PNG image.', field)
  if (!matches(bytes, 12, TYPE_IHDR)) throw new PngGuardError('PNG_INVALID', 'Choose a valid PNG image.', field)

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20) // IHDR data starts at byte 16: width then height
  if (width === 0 || height === 0) throw new PngGuardError('PNG_INVALID', 'Choose a valid PNG image.', field)
  if (width * height > MAX_PIXELS)
    throw new PngGuardError('PNG_INVALID', `Use a single-frame PNG with at most ${MAX_PIXELS / 1e6} megapixels.`, field)

  // An acTL chunk marks the file as animated (APNG); parity with the old `pages !== 1` check.
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    if (offset + 12 + length > bytes.length) break
    if (matches(bytes, offset + 4, TYPE_ACTL))
      throw new PngGuardError(
        'PNG_INVALID',
        `Use a single-frame PNG with at most ${MAX_PIXELS / 1e6} megapixels.`,
        field,
      )
    offset += 12 + length // length + type + data + CRC
  }
  return { width, height }
}
