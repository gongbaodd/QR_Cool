/**
 * Error mapping, moved verbatim from the former `src/server/http.ts` catch
 * block (its route handler dies in phase 5). Every engine entry wraps thrown
 * domain errors with the same codes and editor-field mapping, so UI error
 * handling does not change when the pipeline leaves the server.
 */

import { z } from 'zod'
import { QrPosterError } from '../../../core/errors'
import type { PngGuardError } from '../png-guard'
import type { EngineError } from './types'

export class EngineMappingError extends Error {
  readonly code: string
  readonly field: string | undefined

  constructor(code: string, message: string, field: string | undefined) {
    super(message)
    this.name = 'EngineMappingError'
    this.code = code
    this.field = field
  }
}

/** Wraps any thrown error with the editor-facing code/message/field. */
export function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineMappingError) return { code: error.code, message: error.message, field: error.field }
  if ((error as PngGuardError | null)?.name === 'PngGuardError') {
    const guard = error as PngGuardError
    return { code: guard.code, message: guard.message, field: guard.field }
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]!
    // The engine validates content with `contentSchema.parse` directly (no request
    // envelope), so a bare ZodError carries an empty path — map it to the content field.
    return {
      code: 'REQUEST_INVALID',
      message: issue.message,
      field: String(issue.path[0] ?? 'content'),
    }
  }
  if (error instanceof QrPosterError) {
    const field = error.code.startsWith('MASK')
      ? 'mask'
      : error.code === 'QR_LAYOUT_INVALID'
        ? 'placement'
        : error.code.startsWith('QR')
          ? 'content'
          : 'poster'
    return {
      code: error.code,
      message: (
        error.message +
        (error.code.startsWith('MASK')
          ? ' Choose a poster with a larger solid black region, or supply a same-size white-selects-region mask.'
          : '')
      )
        .replaceAll('--qr-box', 'QR position')
        .replaceAll('--content', 'Text'),
      field,
    }
  }
  return { code: 'RENDER_FAILED', message: 'Could not render this poster. Please retry.', field: 'poster' }
}
