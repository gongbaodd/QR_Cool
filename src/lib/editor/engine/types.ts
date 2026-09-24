/**
 * Engine contracts shared by the Node test harness and the Comlink worker.
 * Engine operations never throw across an API boundary: they settle to a
 * discriminated {@link EngineOutcome}, so every consumer (the editor store,
 * worker client, tests) handles errors and stale runs the same way.
 */

import type { Placement, Settings } from '@/lib/editor/schema'

/** An editor-facing error: the exact codes/fields the old HTTP pipeline produced. */
export interface EngineError {
  code: string
  message: string
  /** Editor field the error maps to (`content`, `poster`, `mask`, `placement`). */
  field?: string | undefined
}

/** Engine input: source bytes plus the current editor revision. */
export interface EngineInput {
  posterBytes: Uint8Array
  transparentBlank?: boolean
  content: string
  maskBytes?: Uint8Array
  placement?: Placement
  previousTotalModules?: number | undefined
  settings?: Partial<Settings>
}

/** The step-2 payload: preview artifacts as Blobs (built in the worker; Blobs cross postMessage by reference). */
export interface PreparedPayload {
  width: number
  height: number
  mask: Blob
  overlay: Blob
  qr: Blob
  qrMetadata: { totalModules: number; version: number }
  placement: Placement
  bestPlacement: Placement
  validation: string | null
}

/** The step-4 payload mirrors the schema-8 envelope: report plus Blob artifacts. */
export interface AssemblePayload {
  report: import('../../../core/types').AssembleReport
  artifacts: Record<string, Blob>
}

export type EngineOutcome<T> =
  | { ok: true; revision: number; value: T }
  | { ok: false; stale: true; revision: number }
  | { ok: false; error: EngineError; revision: number }
