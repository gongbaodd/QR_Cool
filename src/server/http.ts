import { z } from 'zod'
import { requestSchema, MAX_BODY_BYTES } from '../lib/editor/schema'
import { InputError, prepareEditor, assembleFromBuffers } from './editor'
import { QrPosterError } from '../core/errors'

// Shared by both routes in this Node process. No queue and no uploaded assets retained.
const globalState = globalThis as typeof globalThis & { qrRenderActive?: number }
const headers = { 'Cache-Control': 'no-store' }
async function boundedForm(request: Request): Promise<FormData> {
  const length = Number(request.headers.get('content-length'))
  if (length > MAX_BODY_BYTES) throw new InputError('UPLOAD_LIMIT', 'Combined upload is too large.', 413)
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new InputError('REQUEST_INVALID', 'Expected a multipart upload.', 400)
  if (!request.body) throw new InputError('REQUEST_INVALID', 'Missing upload.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const timeout = setTimeout(() => {
    void reader.cancel()
  }, 30_000)
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new InputError('UPLOAD_LIMIT', 'Combined upload is too large.', 413)
      }
      chunks.push(part.value)
    }
    return await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': request.headers.get('content-type')! },
    }).formData()
  } catch (e) {
    if (e instanceof InputError) throw e
    throw new InputError('REQUEST_INVALID', 'Could not read the upload. Please retry.', 400)
  } finally {
    clearTimeout(timeout)
    reader.releaseLock()
  }
}
export async function handleEditorRequest(request: Request, mode: 'prepare' | 'assemble'): Promise<Response> {
  let revision: number | null = null
  if ((globalState.qrRenderActive ?? 0) >= 1)
    return Response.json(
      { code: 'BUSY', message: 'The renderer is busy. Please retry shortly.', revision },
      { status: 503, headers: { ...headers, 'Retry-After': '2' } },
    )
  globalState.qrRenderActive = (globalState.qrRenderActive ?? 0) + 1
  try {
    const form = await boundedForm(request)
    let json: unknown
    try {
      json = JSON.parse(String(form.get('data')))
    } catch {
      throw new InputError('REQUEST_INVALID', 'Invalid editor settings.', 400)
    }
    if (typeof json === 'object' && json && 'revision' in json && Number.isSafeInteger(json.revision))
      revision = json.revision as number
    const data = requestSchema.parse(json)
    const poster = form.get('poster'),
      mask = form.get('mask')
    if (!(poster instanceof File)) throw new InputError('REQUEST_INVALID', 'Choose a poster PNG.', 400, 'poster')
    if (mask !== null && !(mask instanceof File))
      throw new InputError('REQUEST_INVALID', 'Choose a mask PNG.', 400, 'mask')
    const input = {
      posterBytes: Buffer.from(await poster.arrayBuffer()),
      ...(mask instanceof File ? { maskBytes: Buffer.from(await mask.arrayBuffer()) } : {}),
      content: data.content,
      ...(data.placement ? { placement: data.placement } : {}),
      ...(data.previousTotalModules ? { previousTotalModules: data.previousTotalModules } : {}),
      settings: data.settings,
    }
    if (mode === 'prepare')
      return Response.json({ apiVersion: 1, revision, ...(await prepareEditor(input)) }, { headers })
    if (!data.placement) throw new InputError('REQUEST_INVALID', 'Choose a QR position first.', 400, 'placement')
    const result = await assembleFromBuffers({ ...input, placement: data.placement, ...data.settings })
    return Response.json(
      {
        apiVersion: 1,
        revision,
        placement: result.report.placement,
        artifacts: Object.fromEntries(
          Object.entries(result.artifacts).map(([name, bytes]) => [name, bytes.toString('base64')]),
        ),
        report: result.report,
      },
      { headers },
    )
  } catch (e) {
    let error: InputError
    if (e instanceof InputError) error = e
    else if (e instanceof z.ZodError) {
      const issue = e.issues[0]!
      error = new InputError(
        'REQUEST_INVALID',
        issue.message,
        issue.path[0] === 'content' ? 422 : 400,
        String(issue.path[0] ?? 'settings'),
      )
    } else if (e instanceof QrPosterError) {
      const field = e.code.startsWith('MASK')
        ? 'mask'
        : e.code === 'QR_LAYOUT_INVALID'
          ? 'placement'
          : e.code.startsWith('QR')
            ? 'content'
            : 'poster'
      error = new InputError(
        e.code,
        (
          e.message +
          (e.code.startsWith('MASK')
            ? ' Choose a poster with a larger solid black region, or supply a same-size white-selects-region mask.'
            : '')
        )
          .replaceAll('--qr-box', 'QR position')
          .replaceAll('--content', 'Text'),
        e.exitCode === 2 ? 422 : 500,
        field,
      )
    } else error = new InputError('RENDER_FAILED', 'Could not render this poster. Please retry.', 500)
    return Response.json(
      { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), revision },
      { status: error.status, headers },
    )
  } finally {
    globalState.qrRenderActive!--
  }
}
