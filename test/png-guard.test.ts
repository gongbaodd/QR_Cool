/**
 * PNG upload guards (migration step 2): parse-only checks with the exact codes the
 * editor maps to field errors — the client equivalent of the old server `readImage`.
 */

import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PngGuardError, parsePngHeader } from '@/lib/editor/png-guard'

describe('png upload guard', () => {
  it('accepts the fixtures and reports dimensions', () => {
    for (const name of ['source/poster.png', 'test/fixtures/qr.png']) {
      const bytes = readFileSync(name)
      expect(parsePngHeader(bytes, 'poster')).toEqual({
        width: name.includes('poster') ? 688 : 820,
        height: name.includes('poster') ? 566 : 820,
      })
    }
  })

  it('rejects non-PNG bytes', () => {
    expect(() => parsePngHeader(Uint8Array.from([1, 2, 3]), 'poster')).toThrow(PngGuardError)
    try {
      parsePngHeader(Uint8Array.from([1, 2, 3]), 'poster')
    } catch (error) {
      expect(error).toMatchObject({ code: 'PNG_INVALID', field: 'poster' })
    }
  })

  it('rejects truncated but valid-signature headers', () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0])
    expect(() => parsePngHeader(bytes, 'poster')).toThrow(PngGuardError)
  })

  it('rejects oversized uploads without decoding them', () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    try {
      parsePngHeader(bytes, 'poster')
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'UPLOAD_LIMIT', field: 'poster' })
    }
  })

  it('rejects APNG files via the acTL chunk scan', async () => {
    // A single-frame still of an animation is hard to craft without an APNG encoder;
    // splice a synthetic acTL chunk into a minimal PNG copy instead.
    const base = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'white' } })
      .png()
      .toBuffer()
    const actl = Uint8Array.from([
      0,
      0,
      0,
      4, // length = 4
      97,
      99,
      84,
      76, // 'acTL'
      0,
      0,
      0,
      1, // numFrames = 1
      0,
      0,
      0,
      0, // numPlays
      0,
      0,
      0,
      0, // CRC (zeros; the guard doesn't verify CRCs)
    ])
    const bytes = new Uint8Array(base.length + actl.length)
    bytes.set(base.subarray(0, 33), 0) // everything through the IHDR chunk end
    bytes.set(actl, 33)
    bytes.set(base.subarray(33), 33 + actl.length)
    expect(() => parsePngHeader(bytes, 'poster')).toThrow(/single-frame/)
  })

  it('rejects zero dimensions', () => {
    // IHDR with zero width: craft the header bytes manually.
    const bytes = new Uint8Array(33)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    bytes.set([0, 0, 0, 13], 8)
    bytes.set([73, 72, 68, 82], 12)
    bytes.set([0, 0, 0, 0], 16)
    bytes.set([0, 0, 0, 5], 20)
    expect(() => parsePngHeader(bytes, 'poster')).toThrow(/valid PNG/)
  })
})
