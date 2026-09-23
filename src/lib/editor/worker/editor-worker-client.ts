/**
 * Main-thread client for the engine worker. Each mounted editor owns one lazy
 * client so a fresh editor can start again at revision zero safely.
 */

import * as Comlink from 'comlink'
import type { EditorEngineApi } from '@/lib/editor/engine'

export type EditorWorkerClient = Comlink.Remote<EditorEngineApi>

export interface EditorWorkerClientHandle {
  get: () => EditorWorkerClient
  dispose: () => void
}

/** Creates a session-owned, lazy worker handle; call from browser runtime code. */
export function createEditorWorkerClient(): EditorWorkerClientHandle {
  let client: EditorWorkerClient | null = null
  let worker: Worker | null = null
  let disposed = false
  return {
    get() {
      if (disposed) throw new Error('The editor engine worker has been disposed.')
      if (!client) {
        if (typeof Worker === 'undefined') throw new Error('The editor engine requires Web Worker support.')
        worker = new Worker(new URL('./editor-worker.ts', import.meta.url), { type: 'module' })
        client = Comlink.wrap<EditorEngineApi>(worker)
      }
      return client
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (client) void client[Comlink.releaseProxy]()
      worker?.terminate()
      client = null
      worker = null
    },
  }
}
