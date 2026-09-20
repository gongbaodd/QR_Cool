/**
 * Main-thread client for the engine worker. Wraps the Comlink proxy once and
 * hands the typed {@link EditorEngineApi} to browser callers (step 4 wires the
 * reducer hook to this instead of the HTTP routes).
 */

import * as Comlink from 'comlink'
import type { EditorEngineApi } from '../engine'

export type EditorWorkerClient = Comlink.Remote<EditorEngineApi>

let client: EditorWorkerClient | null = null

/** Lazily spawns the engine worker; call from browser code only. */
export function getEditorWorkerClient(): EditorWorkerClient {
  if (!client) {
    if (typeof Worker === 'undefined') throw new Error('The editor engine requires Web Worker support.')
    const worker = new Worker(new URL('./editor-worker.ts', import.meta.url), { type: 'module' })
    client = Comlink.wrap<EditorEngineApi>(worker)
  }
  return client
}
