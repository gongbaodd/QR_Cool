import { useCallback, useEffect, useRef } from 'react'
import * as Comlink from 'comlink'
import type { EngineInput, AssembleInput } from '@/lib/editor/engine'
import { contentSchema, MAX_IMAGE_BYTES, type Settings } from '@/lib/editor/schema'
import { selectCanAssemble } from '@/lib/editor/selectors'
import {
  createEditorWorkerClient,
  type EditorWorkerClientHandle,
} from '@/lib/editor/worker/editor-worker-client'
import { useEditorStore, useEditorStoreApi } from '@/components/editor/EditorStoreProvider'

export interface EditorRequest {
  request: (mode: 'prepare' | 'assemble', automatic?: boolean) => Promise<void>
}

/** Owns one editor's debounced worker session and drops stale lifecycle work. */
export function useEngineRequest(): EditorRequest {
  const store = useEditorStoreApi()
  const revision = useEditorStore((state) => state.document.revision)
  const poster = useEditorStore((state) => state.sources.poster)
  const mask = useEditorStore((state) => state.sources.mask)
  const maskBusy = useEditorStore((state) => state.maskSelection.busy)
  const handle = useRef<EditorWorkerClientHandle | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const operation = useRef(0)

  const request = useCallback(
    async (mode: 'prepare' | 'assemble', automatic = false) => {
      if (mode === 'assemble' && timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const token = ++operation.current
      const current = store.getState()
      const document = current.document
      const sourcePoster = current.sources.poster
      const sourceMask = current.sources.mask
      const validContent = contentSchema.safeParse(document.content).success
      const previewContent =
        mode === 'prepare' && current.maskSelection.origin === 'manual' && !validContent ? 'A' : document.content
      if (
        !sourcePoster ||
        sourcePoster.size > MAX_IMAGE_BYTES ||
        (sourceMask && sourceMask.size > MAX_IMAGE_BYTES) ||
        (!validContent && previewContent === document.content) ||
        (mode === 'assemble' && !selectCanAssemble(current))
      )
        return

      const requestRevision = document.revision
      current.actions.startEngine(mode, requestRevision)
      try {
        const input: EngineInput = {
          posterBytes: await toTransferredBytes(sourcePoster),
          content: previewContent,
          settings: document.settings,
        }
        if (sourceMask) input.maskBytes = await toTransferredBytes(sourceMask)
        if (!automatic && document.placement) {
          input.placement = document.placement
          if (mode === 'prepare' && document.prepared)
            input.previousTotalModules = document.prepared.qrMetadata.totalModules
        }
        const latest = store.getState()
        if (token !== operation.current || latest.document.revision !== requestRevision) return
        const engine = (handle.current ??= createEditorWorkerClient()).get()
        if (mode === 'prepare') {
          const prepared = await engine.prepare(input, requestRevision)
          if (token !== operation.current) return
          if (!prepared.ok) {
            if (!('stale' in prepared))
              settleError(token, requestRevision, prepared.error.message, prepared.error.field)
            return
          }
          store.getState().actions.acceptPrepared({ apiVersion: 1, revision: prepared.revision, ...prepared.value })
        } else {
          const assembled = await engine.assemble(toAssembleInput(input, document.settings), requestRevision)
          if (token !== operation.current) return
          if (!assembled.ok) {
            if (!('stale' in assembled))
              settleError(token, requestRevision, assembled.error.message, assembled.error.field)
            return
          }
          store
            .getState()
            .actions.acceptResult({ apiVersion: 1, revision: assembled.revision, artifacts: assembled.value.artifacts })
        }
      } catch (error) {
        if (token !== operation.current) return
        settleError(token, requestRevision, error instanceof Error ? error.message : 'Could not update the preview.')
      }

      function settleError(activeToken: number, expectedRevision: number, message: string, field?: string) {
        const latest = store.getState()
        if (activeToken === operation.current && latest.document.revision === expectedRevision)
          latest.actions.failEngine(expectedRevision, message, field)
      }
    },
    [store],
  )

  useEffect(() => {
    if (!poster || maskBusy) return
    timer.current = setTimeout(() => {
      timer.current = null
      void request('prepare', true)
    }, 450)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      operation.current += 1
    }
  }, [mask, maskBusy, poster, request, revision])

  useEffect(
    () => () => {
      operation.current += 1
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      handle.current?.dispose()
      handle.current = null
    },
    [],
  )

  return { request }
}

async function toTransferredBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return Comlink.transfer(bytes, [bytes.buffer])
}

function toAssembleInput(input: EngineInput, settings: Settings): AssembleInput {
  return {
    posterBytes: input.posterBytes,
    ...(input.maskBytes ? { maskBytes: input.maskBytes } : {}),
    content: input.content,
    placement: input.placement as AssembleInput['placement'],
    ...settings,
  }
}
