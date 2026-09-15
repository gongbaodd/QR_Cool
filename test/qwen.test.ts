import { describe, expect, it, vi } from 'vitest'
import { editWithQwen, DEFAULT_QWEN_BASE_URL, DEFAULT_PROMPT, buildEditPrompt } from '../src/qwen.js'

const options = { apiKey: 'secret-test-key', baseUrl: DEFAULT_QWEN_BASE_URL, model: 'qwen-image-2.0', prompt: 'rounded dots', width: 688, height: 576, guide: Buffer.from('guide'), poster: Buffer.from('poster'), patternReference: Buffer.from('reference') }
const success = () => Response.json({ request_id: 'request-1', usage: { image_count: 1 }, output: { choices: [{ message: { content: [{ image: 'https://example.com/result.png' }] } }] } })

describe('Qwen transport', () => {
  it('forbids markers and scenery in the default prompt', () => {
    expect(DEFAULT_PROMPT).toBe('Use the sample only for cell shape and size. Generate a new, non-repeating arrangement of rounded black cells on white throughout the selected area. Keep density even. Do not copy, enlarge, stretch, or tile the sample. Do not add markers, text, or scenery.')
    const prompt = buildEditPrompt(DEFAULT_PROMPT, 5)
    expect(prompt).toContain(DEFAULT_PROMPT)
    expect(prompt).toContain('Do not add markers, text, or scenery')
    expect(prompt).toContain('Do not copy, enlarge, stretch, or tile the sample')
    expect(prompt).toContain('Keep density even')
  })
  it('describes the reference as one unscaled sample on a plain white canvas', () => {
    const prompt = buildEditPrompt(DEFAULT_PROMPT, 5)
    expect(prompt).toContain('Image 2 contains one small QR center sample in the top-left corner of a plain white canvas, at its original pixel size.')
    expect(prompt).toContain('The white canvas is not part of the sample.')
  })
  it('sends ordered references, one image, no mask parameter, and downloads without credentials', async () => {
    const mock = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response('image'))
    const result = await editWithQwen({ ...options, fetchImpl: mock })
    expect(result.image.toString()).toBe('image')
    expect(result.requestId).toBe('request-1')
    const [url, request] = mock.mock.calls[0]!
    expect(url).toBe(`${DEFAULT_QWEN_BASE_URL}/services/aigc/multimodal-generation/generation`)
    const body = JSON.parse(request.body)
    expect(body.parameters).toMatchObject({ n: 1, size: '688*576', prompt_extend: false })
    expect(body.input.messages[0].content[0].image).toBe('data:image/png;base64,Z3VpZGU=')
    expect(body.input.messages[0].content[2].image).toBe('data:image/png;base64,cG9zdGVy')
    expect(body.input.messages[0].content[3].text).toContain('Image 3 is the poster to edit')
    expect(body.mask).toBeUndefined()
    expect(mock.mock.calls[1]![1].headers).toBeUndefined()
  })
  it('orders selection, style reference, target and describes their distinct roles', async () => {
    const mock = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response('image'))
    await editWithQwen({ ...options, modulePixels: 5, fetchImpl: mock })
    const content = JSON.parse(mock.mock.calls[0]![1].body).input.messages[0].content
    expect(content).toHaveLength(4)
    expect(content.slice(0, 3).map((item: { image: string }) => Buffer.from(item.image.split(',')[1]!, 'base64').toString())).toEqual(['guide', 'reference', 'poster'])
    expect(content[3].text).toContain('Image 3 is the poster to edit')
    expect(content[3].text).toContain('Image 2 contains one small QR center sample')
    expect(content[3].text).toContain('5 pixels')
    expect(content[3].text).toContain('rounded dots')
    expect(content[3].text).toContain('white margin unchanged')
    expect(content[3].text).toContain('rounded dots')
  })
  it('rejects missing credentials before calling fetch', async () => {
    const mock = vi.fn()
    await expect(editWithQwen({ ...options, apiKey: '', fetchImpl: mock })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(mock).not.toHaveBeenCalled()
  })
  it.each([401, 429, 500])('handles HTTP %s without retries or leaking response secrets', async status => {
    const mock = vi.fn().mockResolvedValue(new Response('secret-test-key', { status }))
    await expect(editWithQwen({ ...options, fetchImpl: mock })).rejects.toThrow(`HTTP ${status}`)
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed JSON and missing images', async () => {
    for (const response of [new Response('invalid'), Response.json({}), Response.json({ code: 'Error' })]) {
      await expect(editWithQwen({ ...options, fetchImpl: vi.fn().mockResolvedValue(response) })).rejects.toMatchObject({ code: 'QWEN_API_FAILED' })
    }
  })
  it('reports download failure', async () => {
    const mock = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(editWithQwen({ ...options, fetchImpl: mock })).rejects.toThrow('download failed')
    expect(mock).toHaveBeenCalledTimes(2)
  })
  it('times out without retrying', async () => {
    const mock = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
    await expect(editWithQwen({ ...options, fetchImpl: mock as typeof fetch, timeoutMs: 5 })).rejects.toThrow('timed out')
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
