/**
 * The editor's Web Worker entry: owns the browser imaging backend and the
 * cached engine. Codec WASM (`@jsquash/png`, `@resvg/resvg-wasm`) initializes
 * lazily inside this worker only, keeping it off the page's initial bundle.
 */

import './window-shim'
import * as Comlink from 'comlink'
import { browserImaging } from '@/core/imaging/browser'
import { createEditorEngine } from '@/lib/editor/engine'
import type { EditorEngineApi } from '@/lib/editor/engine'

const engine: Promise<EditorEngineApi> = createEditorEngine(browserImaging)

export const api = {
  prepare: async (input: Parameters<EditorEngineApi['prepare']>[0], revision: number) =>
    (await engine).prepare(input, revision),
  assemble: async (input: Parameters<EditorEngineApi['assemble']>[0], revision: number) =>
    (await engine).assemble(input, revision),
  exportRaster: async (input: Parameters<EditorEngineApi['exportRaster']>[0], targetPitch: number, revision: number) =>
    (await engine).exportRaster(input, targetPitch, revision),
  invalidate: async () => (await engine).invalidate(),
}
export type EditorWorkerApi = typeof api
Comlink.expose(api)
