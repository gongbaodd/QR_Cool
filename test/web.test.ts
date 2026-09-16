import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { assembleFromBuffers, prepareEditor } from '../src/server/editor.js'
import { handleEditorRequest } from '../src/server/http.js'
import { initialState, reducer } from '../src/lib/editor/state.js'
import { MAX_BODY_BYTES } from '../src/lib/editor/schema.js'
const posterBytes = await readFile('source/poster.png')
const content = 'https://example.com/qr'
const settings = { seed: 42, qrMargin: 1 as const, plateCorners: 'texture' as const }
function request(data: unknown, poster = posterBytes, mask?: Buffer) {
  const form = new FormData()
  form.set('poster', new File([poster], 'poster.png'))
  if (mask) form.set('mask', new File([mask], 'mask.png'))
  form.set('data', JSON.stringify(data))
  return new Request('http://localhost/api/prepare', { method: 'POST', body: form })
}
describe('buffer engine migration', () => {
  it('preserves pre-refactor artifact bytes and logical input names', async () => {
    const prepared = await prepareEditor({ posterBytes, content })
    const result = await assembleFromBuffers({ posterBytes, content, placement: prepared.placement, ...settings })
    expect(result.report.artifacts.posterSha256).toBe('310916c86e2395514673ae3ae1045f8bfed5487317ff33d700dd66f179736dc3')
    expect(result.report.artifacts.qrSha256).toBe('df54a78ef51519a2f5cbf88910266f9df20f967fbdd5e3ccd92a79635ac479c2')
    expect(result.report.artifacts.patternCutPngSha256).toBe('b12c1d01da2b7a308b693aef06532c8c65c8bb2b9810777cef082d2ca685734a')
    expect(result.report.artifacts.patternCutSvgSha256).toBe('315d8de182da76e78c511845e5f134b3fd633c0fb6141ac49e443644db27f1b5')
    expect(result.report.inputs.poster.path).toBe('poster.png')
    expect(result.report.verification.checks.every(c => c.passed)).toBe(true)
    expect(result.report.schemaVersion).toBe(8)
  })
  it('preserves whitespace and refuses to move an invalid manual placement', async () => {
    const prepared = await prepareEditor({ posterBytes, content: '  hello  ' })
    const result = await assembleFromBuffers({ posterBytes, content: '  hello  ', placement: prepared.placement, ...settings })
    expect(result.report.verification.expectedText).toBe('  hello  ')
    await expect(assembleFromBuffers({ posterBytes, content, placement: { x: 0, y: 0, size: 145 }, ...settings })).rejects.toThrow()
  })
  it.each([1, 2] as const)('verifies both corner treatments with margin %i', async qrMargin => {
    for (const plateCorners of ['texture', 'light'] as const) {
      const p = await prepareEditor({ posterBytes, content })
      const r = await assembleFromBuffers({ posterBytes, content, placement: p.placement, ...settings, qrMargin, plateCorners })
      expect(r.report.qualified).toBe(true)
      expect(r.report.qrPlate.marginModules).toBe(qrMargin)
      expect(r.report.phoneScan).toBe('untested')
      expect(r.report.verification.skippedChecks).toEqual(['poster', 'posterHalfScale', 'posterJpeg80'])
    }
  })
})
describe('stateless routes', () => {
  it('prepares, assembles, and returns the exact engine PNG', async () => {
    const p = await handleEditorRequest(request({ revision: 8, content, settings }), 'prepare')
    expect(p.headers.get('cache-control')).toBe('no-store')
    const body = await p.json()
    expect(body.revision).toBe(8)
    expect(body.validation).toBeNull()
    const r = await handleEditorRequest(request({ revision: 8, content, settings, placement: body.placement }), 'assemble')
    expect(r.status).toBe(200)
    const result = await r.json()
    const engine = await assembleFromBuffers({ posterBytes, content, placement: body.placement, ...settings })
    expect(result.artifacts['poster.png']).toBe(engine.artifacts['poster.png']!.toString('base64'))
  })
  it.each(['', ' \t ', 'line\nline', 'x'.repeat(9000)])('rejects invalid content', async value => {
    const r = await handleEditorRequest(request({ revision: 3, content: value, settings }), 'prepare')
    expect(r.status).toBe(422)
    expect(await r.json()).toMatchObject({ revision: 3, field: 'content' })
  })
  it('rejects corrupt PNG, wrong mask size, and missing region', async () => {
    const white = await sharp({ create: { width: 30, height: 30, channels: 4, background: 'white' } }).png().toBuffer()
    for (const req of [request({ revision: 0, content, settings }, Buffer.from('bad')), request({ revision: 0, content, settings }, posterBytes, white), request({ revision: 0, content, settings }, white)]) {
      const r = await handleEditorRequest(req, 'prepare'); expect(r.status).toBe(422)
    }
  })
  it('bounds ingress before parsing, including chunked bodies', async () => {
    const r = await handleEditorRequest(new Request('http://localhost', { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: 'x' }), 'prepare')
    expect(r.status).toBe(413)
    const r2 = await handleEditorRequest(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(MAX_BODY_BYTES + 1) }), 'prepare')
    expect(r2.status).toBe(413)
  })
  it('returns retryable busy instead of queueing another user', async () => {
    const first = handleEditorRequest(request({ revision: 0, content, settings }), 'prepare')
    const second = await handleEditorRequest(request({ revision: 9, content: 'other user', settings }), 'prepare')
    expect(second.status).toBe(503)
    expect(second.headers.get('retry-after')).toBe('2')
    await first
    const retry = await handleEditorRequest(request({ revision: 9, content: 'other user', settings }), 'prepare')
    expect(retry.status).toBe(200)
  })
})
it('invalidates downloads and ignores superseded responses', () => {
  const old = { ...initialState, revision: 4, result: { apiVersion: 1 as const, revision: 4, artifacts: { 'poster.png': 'old' } } }
  const edited = reducer(old, { type: 'edit', patch: { content: 'new' } })
  expect(edited.result).toBeNull()
  expect(reducer(edited, { type: 'result', data: old.result })).toEqual(edited)
})

it('finds a smaller assembly-valid automatic placement on a small poster', async () => {
  const small = await sharp({ create: { width: 240, height: 240, channels: 4, background: 'white' } }).png().toBuffer()
  const mask = await sharp({ create: { width: 240, height: 240, channels: 4, background: 'black' } }).composite([{ input: await sharp({ create: { width: 220, height: 220, channels: 4, background: 'white' } }).png().toBuffer(), left: 10, top: 10 }]).png().toBuffer()
  const p = await prepareEditor({ posterBytes: small, maskBytes: mask, content })
  expect(p.placement.size).toBeLessThan(203)
  const r = await assembleFromBuffers({ posterBytes: small, maskBytes: mask, content, placement: p.placement, ...settings })
  expect(r.report.qualified).toBe(true)
})

it('revalidates longer content around the previous center and never exports an obsolete QR', async () => {
  const original = await prepareEditor({ posterBytes, content })
  const changed = await prepareEditor({ posterBytes, content: 'a'.repeat(140), placement: original.placement, previousTotalModules: original.qrMetadata.totalModules })
  expect(changed.qrMetadata.totalModules).toBeGreaterThan(original.qrMetadata.totalModules)
  expect(changed.placement.x + changed.placement.size / 2).toBeCloseTo(original.placement.x + original.placement.size / 2, 0)
  expect(changed.validation).not.toBeNull()
})

it('rejects pixel-limit and actual encoder capacity violations', async () => {
  const huge = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: 'black' } }).png().toBuffer()
  expect((await handleEditorRequest(request({ revision: 0, content, settings }, huge), 'prepare')).status).toBe(422)
  const overflow = await handleEditorRequest(request({ revision: 0, content: 'a'.repeat(4000), settings }), 'prepare')
  expect(overflow.status).toBe(422)
  expect(await overflow.json()).toMatchObject({ field: 'content' })
})
