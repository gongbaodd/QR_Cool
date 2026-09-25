import { useCallback, useEffect, useRef, useState } from 'react'
import * as Comlink from 'comlink'
import { toast } from 'react-toastify'
import type { EngineInput, AssembleInput, RasterExportPayload } from '@mahu-qr/renderer/engine'
import { contentSchema, MAX_IMAGE_BYTES, type Settings } from '@mahu-qr/renderer/schema'
import { selectCanAssemble } from '@/lib/editor/selectors'
import { createEditorWorkerClient, type EditorWorkerClientHandle } from '@/lib/editor/worker/editor-worker-client'
import { useEditorStore, useEditorStoreApi } from '@/components/editor/EditorStoreProvider'

export interface EditorRequest {
  request: (mode: 'prepare' | 'assemble') => Promise<void>
  exportRaster: (targetPitch: number) => Promise<RasterExportPayload>
  cancelAssembly: () => void
  failedMode: 'prepare' | 'assemble' | null
}

/** Owns one editor's debounced worker session and drops stale lifecycle work. */
export function useEngineRequest(): EditorRequest {
  const store = useEditorStoreApi()
  const revision = useEditorStore((state) => state.document.revision)
  const assetRevision = useEditorStore((state) => state.document.assetRevision)
  const poster = useEditorStore((state) => state.sources.poster)
  const mask = useEditorStore((state) => state.sources.mask)
  const maskBusy = useEditorStore((state) => state.maskSelection.busy)
  const documentError = useEditorStore((state) => state.document.error)
  const [failedRequest, setFailedRequest] = useState<{ revision: number; mode: 'prepare' | 'assemble' } | null>(null)
  const handle = useRef<EditorWorkerClientHandle | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const assetOperation = useRef(0)
  const assemblyOperation = useRef(0)
  const exportOperation = useRef(0)

  const cancelAssembly = useCallback(() => {
    assemblyOperation.current += 1
    store.getState().actions.cancelAssembly()
  }, [store])

  const request = useCallback(
    async (mode: 'prepare' | 'assemble') => {
      if (mode === 'assemble' && timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const operation = mode === 'prepare' ? assetOperation : assemblyOperation
      const token = ++operation.current
      const current = store.getState()
      const document = current.document
      const sourcePoster = current.sources.poster
      const sourceMask = current.sources.mask
      const validContent = contentSchema.safeParse(document.content).success
      if (
        !sourcePoster ||
        sourcePoster.size > MAX_IMAGE_BYTES ||
        (sourceMask && sourceMask.size > MAX_IMAGE_BYTES) ||
        !validContent ||
        (mode === 'assemble' && !selectCanAssemble(current))
      )
        return

      const requestRevision = document.revision
      setFailedRequest(null)
      current.actions.startEngine(mode, requestRevision)
      try {
        const input: EngineInput = {
          posterBytes: await toTransferredBytes(sourcePoster),
          transparentBlank: current.sources.transparentBlank,
          content: document.content,
          settings: document.settings,
        }
        if (sourceMask) input.maskBytes = await toTransferredBytes(sourceMask)
        if (document.placement) {
          input.placement = document.placement
          if (mode === 'prepare' && document.prepared)
            input.previousTotalModules = document.prepared.qrMetadata.totalModules
        }
        const latest = store.getState()
        if (
          token !== operation.current ||
          (mode === 'prepare'
            ? latest.document.assetRevision !== document.assetRevision
            : latest.document.revision !== requestRevision)
        )
          return
        const engine = (handle.current ??= createEditorWorkerClient()).get()
        if (mode === 'prepare') {
          const prepared = await engine.prepare(input, document.assetRevision)
          if (token !== operation.current) return
          if (!prepared.ok) {
            if (!('stale' in prepared))
              settleError(token, requestRevision, prepared.error.message, prepared.error.field)
            return
          }
          store.getState().actions.acceptPrepared({
            apiVersion: 1,
            revision: requestRevision,
            assetRevision: prepared.revision,
            ...prepared.value,
          })
        } else {
          const assembled = await engine.assemble(toAssembleInput(input, document.settings), requestRevision)
          if (token !== operation.current) return
          if (!assembled.ok) {
            if (!('stale' in assembled))
              settleError(token, requestRevision, assembled.error.message, assembled.error.field)
            return
          }
          store.getState().actions.acceptResult({
            apiVersion: 1,
            revision: assembled.revision,
            artifacts: assembled.value.artifacts,
            ...(assembled.value.recipe ? { recipe: assembled.value.recipe } : {}),
            ...(assembled.value.recipeError ? { recipeError: assembled.value.recipeError } : {}),
          })
          if (assembled.value.recipeError)
            toast.error(assembled.value.recipeError, {
              toastId: 'recipe-export-error',
              autoClose: false,
              role: 'alert',
            })
        }
      } catch (error) {
        if (token !== operation.current) return
        settleError(token, requestRevision, error instanceof Error ? error.message : 'Could not update the preview.')
      }

      function settleError(activeToken: number, expectedRevision: number, message: string, field?: string) {
        const latest = store.getState()
        const stillCurrent =
          mode === 'prepare'
            ? activeToken === assetOperation.current && latest.document.assetRevision === document.assetRevision
            : activeToken === assemblyOperation.current && latest.document.revision === expectedRevision
        if (stillCurrent) {
          setFailedRequest({ revision: latest.document.revision, mode })
          if (mode === 'prepare') latest.actions.failEngine(latest.document.revision, message, field)
          else latest.actions.failEngine(expectedRevision, message, field)
        }
      }
    },
    [store],
  )

  const exportRaster = useCallback(
    async (targetPitch: number): Promise<RasterExportPayload> => {
      const token = ++exportOperation.current
      const current = store.getState()
      const document = current.document
      const sourcePoster = current.sources.poster
      const sourceMask = current.sources.mask
      if (!sourcePoster || !document.placement || !document.result || document.result.revision !== document.revision)
        throw new Error('Assemble the current poster before choosing another size.')
      const requestRevision = document.revision
      const input: EngineInput = {
        posterBytes: await toTransferredBytes(sourcePoster),
        transparentBlank: current.sources.transparentBlank,
        content: document.content,
        placement: document.placement,
        settings: document.settings,
      }
      if (sourceMask) input.maskBytes = await toTransferredBytes(sourceMask)
      if (token !== exportOperation.current || store.getState().document.revision !== requestRevision)
        throw new Error('Raster export was cancelled.')
      const engine = (handle.current ??= createEditorWorkerClient()).get()
      const exported = await engine.exportRaster(
        toAssembleInput(input, document.settings),
        targetPitch,
        requestRevision,
      )
      if (token !== exportOperation.current || store.getState().document.revision !== requestRevision)
        throw new Error('Raster export was cancelled.')
      if (!exported.ok) {
        if ('stale' in exported) throw new Error('Raster export was cancelled.')
        throw new Error(exported.error.message)
      }
      return exported.value
    },
    [store],
  )

  useEffect(() => {
    exportOperation.current += 1
  }, [revision])

  useEffect(() => {
    if (!poster || maskBusy) return
    timer.current = setTimeout(() => {
      timer.current = null
      void request('prepare')
    }, 450)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      assetOperation.current += 1
    }
  }, [mask, maskBusy, poster, request, assetRevision])

  useEffect(
    () => () => {
      assetOperation.current += 1
      assemblyOperation.current += 1
      exportOperation.current += 1
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      handle.current?.dispose()
      handle.current = null
    },
    [],
  )

  return {
    request,
    exportRaster,
    cancelAssembly,
    failedMode: documentError && failedRequest?.revision === revision ? failedRequest.mode : null,
  }
}

async function toTransferredBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return Comlink.transfer(bytes, [bytes.buffer])
}

function toAssembleInput(input: EngineInput, settings: Settings): AssembleInput {
  return {
    posterBytes: input.posterBytes,
    transparentBlank: input.transparentBlank ?? false,
    ...(input.maskBytes ? { maskBytes: input.maskBytes } : {}),
    content: input.content,
    placement: input.placement as AssembleInput['placement'],
    ...settings,
  }
}
