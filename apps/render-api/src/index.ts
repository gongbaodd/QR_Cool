// HTTP layer for the standalone recipe player. Recipe validation and
// rendering stay in `@mahu-qr/renderer`; this Worker only routes and composes
// requests. Hono matches HEAD requests with their GET route, so every known
// path keeps an explicit method guard that runs ahead of authentication.
// Generic pieces come from Hono's built-in modules (`request-id`,
// `http-exception`, `body-limit`). Bearer auth, the streamed UTF-8 body read,
// the limiter key, and the PNG response stay local: the built-in equivalents
// would change the asserted API contract (bearer-auth answers a non-Bearer
// header with 400 and enforces an RFC 6750 token charset; `bodyLimit` trusts
// Content-Length and never decodes bytes from the stream).
import '@mahu-qr/renderer/worker-shim'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requestId, type RequestIdVariables } from 'hono/request-id'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { QrPosterError } from '@mahu-qr/renderer/core/errors'
import { PngGuardError } from '@mahu-qr/renderer/png-guard'
import { cloudflareImagingReady } from '@mahu-qr/renderer/core/imaging/cloudflare'
import { browserImaging } from '@mahu-qr/renderer/core/imaging/browser'
import { MAX_RECIPE_BYTES, renderRecipe } from '@mahu-qr/renderer/recipe'

const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

const REQUEST_TOO_LARGE = 'Recipe JSON exceeds the request limit.'

function apiErrorBody(status: ContentfulStatusCode, code: string, message: string, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, { status, headers: { ...NO_STORE_HEADERS } })
}

/**
 * A route-check failure carrying its authoritative response. Wrapping the
 * prebuilt `apiErrorBody` response preserves the exact error envelope and
 * headers: Hono's `onError` hook returns `getResponse()` unchanged.
 */
class RequestError extends HTTPException {
  constructor(status: ContentfulStatusCode, code: string, message: string, requestId: string) {
    super(status, { res: apiErrorBody(status, code, message, requestId) })
  }
}

/**
 * The authoritative byte cap. It stays even though `bodyLimit` sits ahead of
 * it: with no Content-Length, `bodyLimit` buffers up to `maxSize` and its
 * chunk list stays referenced for the whole render, so a chunked client can
 * still lie about size and needs the streamed check. Keep the accumulated
 * buffer bounded and cancel the stream once the limit is exceeded.
 */
async function boundedBody(request: Request, requestId: string): Promise<string> {
  if (!request.body) throw new RequestError(400, 'BODY_REQUIRED', 'Send a recipe JSON request body.', requestId)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RECIPE_BYTES) {
      await reader.cancel()
      throw new RequestError(413, 'REQUEST_TOO_LARGE', REQUEST_TOO_LARGE, requestId)
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
    throw new RequestError(400, 'INVALID_JSON', 'Recipe must be UTF-8 JSON.', requestId)
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

type Env = {
  Bindings: CloudflareBindings & { RENDER_API_TOKEN?: string }
  Variables: RequestIdVariables & { artifact: 'poster.png' | 'qr.png' }
}

async function apiErrorResponse(error: unknown, requestId: string): Promise<Response> {
  if (error instanceof RequestError) return error.getResponse()
  if (error instanceof z.ZodError) {
    const oversizedImage = error.issues.some(
      (issue) =>
        issue.code === 'too_big' &&
        ((issue.path[0] === 'source' &&
          (issue.path[1] === 'poster' || issue.path[1] === 'regionMask') &&
          issue.path[2] === 'data') ||
          (issue.path[0] === 'source' && (issue.path[1] === 'width' || issue.path[1] === 'height'))),
    )
    return apiErrorBody(
      oversizedImage ? 413 : 400,
      oversizedImage ? 'IMAGE_TOO_LARGE' : 'RECIPE_INVALID',
      oversizedImage
        ? 'Recipe PNGs must be 10 MiB or smaller and within the pixel limit.'
        : 'Recipe schema or version is invalid.',
      requestId,
    )
  }
  if (error instanceof PngGuardError)
    return apiErrorBody(error.code === 'UPLOAD_LIMIT' ? 413 : 400, error.code, error.message, requestId)
  if (error instanceof QrPosterError)
    return apiErrorBody(error.code === 'IMAGE_PROCESSING_FAILED' ? 500 : 422, error.code, error.message, requestId)
  if (error instanceof Error && error.message.startsWith('Recipe'))
    return apiErrorBody(400, 'RECIPE_INVALID', error.message, requestId)
  console.error(JSON.stringify({ message: 'recipe render failed', requestId }))
  return apiErrorBody(500, 'RENDER_FAILED', 'Could not render this recipe.', requestId)
}

const requireMethod =
  (allowed: 'GET' | 'POST'): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (c.req.method === allowed) {
      await next()
      return
    }
    if (allowed === 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET', ...NO_STORE_HEADERS } })
    return Response.json(
      { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to render a recipe.' }, requestId: c.get('requestId') },
      { status: 405, headers: { Allow: 'POST', ...NO_STORE_HEADERS } },
    )
  }

/**
 * Auth, quota, media type, and artifact selection: exactly the checks that
 * must run before any body work. Returning a response short-circuits the
 * chain without calling `next`, so failed auth and quota both skip the body
 * entirely. The limiter runs before validation so every authenticated
 * attempt (including validation failures) consumes one slot.
 */
const renderChecks: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = c.get('requestId')
  const request = c.req.raw
  if (!(await authorized(request, c.env.RENDER_API_TOKEN)))
    return apiErrorBody(401, 'UNAUTHORIZED', 'A valid bearer token is required.', requestId)
  if (!(await c.env.RENDER_API_LIMIT.limit({ key: await rateLimitKey(request) })).success)
    return apiErrorBody(429, 'RATE_LIMITED', 'Try again in a minute.', requestId)
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
    return apiErrorBody(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.', requestId)
  const artifact = z.enum(['poster.png', 'qr.png']).safeParse(c.req.query('artifact') ?? 'poster.png')
  if (!artifact.success) return apiErrorBody(400, 'ARTIFACT_INVALID', 'Choose poster.png or qr.png.', requestId)
  c.set('artifact', artifact.data)
  await next()
}

const bodyLimitCheck = bodyLimit({
  maxSize: MAX_RECIPE_BYTES,
  onError: (c) => apiErrorBody(413, 'REQUEST_TOO_LARGE', REQUEST_TOO_LARGE, c.get('requestId') ?? ''),
})

function renderResponse(result: { png: Blob; filename: string }, requestId: string): Response {
  return new Response(result.png, {
    headers: {
      ...PNG_HEADERS,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Request-Id': requestId,
    },
  })
}

const app = new Hono<Env>()

// Server-generated UUID only: headerName '' keeps a client `X-Request-Id`
// from being echoed or promoted onto error responses. Successful PNG
// responses set `X-Request-Id` in `renderResponse`; errors carry the id in
// the JSON body only.
app.use('*', requestId({ headerName: '' }))

app.all('/health', requireMethod('GET'), () => Response.json({ status: 'ok' }, { headers: { ...NO_STORE_HEADERS } }))

// Check order: method, auth, rate limit, media type, artifact, declared size
// (bodyLimit), streamed UTF-8 read, JSON parse, imaging readiness, render.
// Oversized declared length therefore consumes quota exactly like today's
// streamed check; failed auth consumes none.
app.all('/v1/render', requireMethod('POST'), renderChecks, bodyLimitCheck, async (c) => {
  const requestId = c.get('requestId')
  try {
    const json = await boundedBody(c.req.raw, requestId)
    let recipe: unknown
    try {
      recipe = JSON.parse(json)
    } catch {
      return apiErrorBody(400, 'INVALID_JSON', 'Recipe must contain valid JSON.', requestId)
    }
    await cloudflareImagingReady
    const result = await renderRecipe(browserImaging, recipe, c.get('artifact'))
    return renderResponse(result, requestId)
  } catch (error) {
    return apiErrorResponse(error, requestId)
  }
})

app.onError((error, c) => apiErrorResponse(error, c.get('requestId')))
app.notFound((c) => apiErrorBody(404, 'NOT_FOUND', 'Route not found.', c.get('requestId')))

export default app
