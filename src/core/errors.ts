export type ErrorCode =
  | 'QWEN_API_FAILED'
  | 'INVALID_INPUT'
  | 'MASK_AMBIGUOUS'
  | 'MASK_INVALID'
  | 'QR_INVALID'
  | 'QR_TEXT_MISMATCH'
  | 'QR_LAYOUT_INVALID'
  | 'OUTPUT_EXISTS'
  | 'IMAGE_PROCESSING_FAILED'
  | 'VERIFICATION_FAILED'

export class QrPosterError extends Error {
  readonly code: ErrorCode
  readonly exitCode: 2 | 3 | 4

  constructor(code: ErrorCode, message: string, exitCode: 2 | 3 | 4 = 2, options?: ErrorOptions) {
    super(message, options)
    this.name = 'QrPosterError'
    this.code = code
    this.exitCode = exitCode
  }
}
