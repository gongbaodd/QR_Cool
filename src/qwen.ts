import { QrPosterError } from './errors.js'

export const DEFAULT_QWEN_BASE_URL = 'https://ws-hxrjydip77dx0nxq.cn-beijing.maas.aliyuncs.com/api/v1'
export const DEFAULT_QWEN_MODEL = 'qwen-image-2.0'
export const DEFAULT_PROMPT = 'Use the sample only for cell shape and size. Generate a new, non-repeating arrangement of rounded black cells on white throughout the selected area. Keep density even. Do not copy, enlarge, stretch, or tile the sample. Do not add markers, text, or scenery.'

export function buildEditPrompt(prompt: string, modulePixels?: number): string {
  return `Image 1 is the selection mask. Image 2 contains one small QR center sample in the top-left corner of a plain white canvas, at its original pixel size. The white canvas is not part of the sample. Image 3 is the poster to edit; its protected QR square is blank because the exact QR will be restored locally. ${prompt} Keep the QR size, position, and white margin unchanged. Preserve pixels outside the selection. Return the complete poster.${modulePixels === undefined ? '' : ` Cell size: ${modulePixels} pixels.`}`
}

export interface QwenOptions {
  apiKey: string
  baseUrl: string
  model: string
  prompt: string
  width: number
  height: number
  guide: Buffer
  poster: Buffer
  patternReference: Buffer
  modulePixels?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function validateQwenConfig(apiKey: string, baseUrl: string, model: string): void {
  if (!apiKey.trim()) throw new QrPosterError('INVALID_INPUT', 'Set QWEN_API_KEY in .env or the environment.')
  let url: URL
  try { url = new URL(baseUrl) }
  catch { throw new QrPosterError('INVALID_INPUT', 'QWEN_BASE_URL must be an HTTPS API base URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new QrPosterError('INVALID_INPUT', 'QWEN_BASE_URL must be an HTTPS API base URL without credentials or query parameters.')
  if (!model.trim()) throw new QrPosterError('INVALID_INPUT', 'Qwen model must not be empty.')
}

export async function editWithQwen(options: QwenOptions): Promise<{ image: Buffer; requestId?: string; usage?: unknown }> {
  validateQwenConfig(options.apiKey, options.baseUrl, options.model)
  const fetcher = options.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(options.timeoutMs ?? 300_000)
  try {
    const response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/services/aigc/multimodal-generation/generation`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        input: { messages: [{ role: 'user', content: [
          { image: `data:image/png;base64,${options.guide.toString('base64')}` },
          { image: `data:image/png;base64,${options.patternReference.toString('base64')}` },
          { image: `data:image/png;base64,${options.poster.toString('base64')}` },
          { text: buildEditPrompt(options.prompt, options.modulePixels) },
        ] }] },
        parameters: { n: 1, size: `${options.width}*${options.height}`, watermark: false, prompt_extend: false },
      }),
    })
    if (!response.ok)
      throw new QrPosterError('QWEN_API_FAILED', `Qwen request failed (HTTP ${response.status}). Check the API key, workspace, model access, and quota.`, 3)
    const body = await response.json() as { code?: string; request_id?: string; usage?: unknown; output?: { choices?: { message?: { content?: { image?: string }[] } }[] } }
    const imageUrl = body.output?.choices?.[0]?.message?.content?.find(item => typeof item.image === 'string')?.image
    if (body.code || !imageUrl)
      throw new QrPosterError('QWEN_API_FAILED', 'Qwen returned an error or no image.', 3)
    if (new URL(imageUrl).protocol !== 'https:') throw new Error('Invalid download protocol')
    // Generated image URLs are signed; never attach the API credential to downloads.
    const download = await fetcher(imageUrl, { signal, redirect: 'error' })
    if (!download.ok) throw new QrPosterError('QWEN_API_FAILED', `Generated image download failed (HTTP ${download.status}).`, 3)
    const image = Buffer.from(await download.arrayBuffer())
    return { image, ...(body.request_id ? { requestId: body.request_id } : {}), ...(body.usage !== undefined ? { usage: body.usage } : {}) }
  }
  catch (error) {
    if (error instanceof QrPosterError) throw error
    throw new QrPosterError('QWEN_API_FAILED', signal.aborted
      ? 'Qwen request timed out. It may have incurred a charge; no automatic retry was made.'
      : 'Qwen request or image download failed. No automatic retry was made.', 3)
  }
}
