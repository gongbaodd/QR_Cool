import '@/lib/editor/worker/window-shim'
import { z } from 'zod'
import { QrPosterError } from '@/core/errors'
import { PngGuardError } from '@/lib/editor/png-guard'
import { cloudflareImagingReady } from '@/core/imaging/cloudflare'
import { browserImaging } from '@/core/imaging/browser'
import { MAX_RECIPE_BYTES, renderRecipe } from '@/lib/recipe/recipe'

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function errorResponse(status: number, code: string, message: string, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  )
}

async function boundedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECIPE_BYTES)
    throw new RequestError(413, 'REQUEST_TOO_LARGE', 'Recipe JSON exceeds the request limit.')
  if (!request.body) throw new RequestError(400, 'BODY_REQUIRED', 'Send a recipe JSON request body.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RECIPE_BYTES) {
      await reader.cancel()
      throw new RequestError(413, 'REQUEST_TOO_LARGE', 'Recipe JSON exceeds the request limit.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  chunks.length = 0
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RequestError(400, 'INVALID_JSON', 'Recipe must be UTF-8 JSON.')
  }
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = /^Bearer /i.test(header) ? header.slice(7) : ''
  const encoder = new TextEncoder()
  const [providedHash, tokenHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
  ])
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual: (left: ArrayBuffer, right: ArrayBuffer) => boolean
  }
  return subtle.timingSafeEqual(providedHash, tokenHash)
}

async function rateLimitKey(request: Request): Promise<string> {
  const header = request.headers.get('authorization') ?? ''
  const token = /^Bearer /i.test(header) ? header.slice(7) : ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default {
  async fetch(
    request: Request,
    env: {
      RENDER_API_TOKEN?: string
      RENDER_API_LIMIT: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
    },
  ): Promise<Response> {
    const requestId = crypto.randomUUID()
    const url = new URL(request.url)
    if (url.pathname !== '/v1/render') return errorResponse(404, 'NOT_FOUND', 'Route not found.', requestId)
    if (request.method !== 'POST')
      return new Response(
        JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to render a recipe.' }, requestId }),
        {
          status: 405,
          headers: {
            Allow: 'POST',
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      )
    if (!(await authorized(request, env.RENDER_API_TOKEN)))
      return errorResponse(401, 'UNAUTHORIZED', 'A valid bearer token is required.', requestId)
    if (!(await env.RENDER_API_LIMIT.limit({ key: await rateLimitKey(request) })).success)
      return errorResponse(429, 'RATE_LIMITED', 'Try again in a minute.', requestId)
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
      return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.', requestId)

    const artifactValue = url.searchParams.get('artifact') ?? 'poster.png'
    const artifact = z.enum(['poster.png', 'qr.png']).safeParse(artifactValue)
    if (!artifact.success) return errorResponse(400, 'ARTIFACT_INVALID', 'Choose poster.png or qr.png.', requestId)

    try {
      const json = await boundedBody(request)
      let recipe: unknown
      try {
        recipe = JSON.parse(json)
      } catch {
        return errorResponse(400, 'INVALID_JSON', 'Recipe must contain valid JSON.', requestId)
      }
      await cloudflareImagingReady
      const result = await renderRecipe(browserImaging, recipe, artifact.data)
      return new Response(result.png, {
        headers: {
          ...PNG_HEADERS,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'X-Request-Id': requestId,
        },
      })
    } catch (error) {
      if (error instanceof RequestError) return errorResponse(error.status, error.code, error.message, requestId)
      if (error instanceof z.ZodError) {
        const oversizedImage = error.issues.some(
          (issue) =>
            issue.code === 'too_big' &&
            ((issue.path[0] === 'source' &&
              (issue.path[1] === 'poster' || issue.path[1] === 'regionMask') &&
              issue.path[2] === 'data') ||
              (issue.path[0] === 'source' && (issue.path[1] === 'width' || issue.path[1] === 'height'))),
        )
        return errorResponse(
          oversizedImage ? 413 : 400,
          oversizedImage ? 'IMAGE_TOO_LARGE' : 'RECIPE_INVALID',
          oversizedImage
            ? 'Recipe PNGs must be 10 MiB or smaller and within the pixel limit.'
            : 'Recipe schema or version is invalid.',
          requestId,
        )
      }
      if (error instanceof PngGuardError)
        return errorResponse(error.code === 'UPLOAD_LIMIT' ? 413 : 400, error.code, error.message, requestId)
      if (error instanceof QrPosterError)
        return errorResponse(error.code === 'IMAGE_PROCESSING_FAILED' ? 500 : 422, error.code, error.message, requestId)
      if (error instanceof Error && error.message.startsWith('Recipe'))
        return errorResponse(400, 'RECIPE_INVALID', error.message, requestId)
      console.error(JSON.stringify({ message: 'recipe render failed', requestId }))
      return errorResponse(500, 'RENDER_FAILED', 'Could not render this recipe.', requestId)
    }
  },
}
