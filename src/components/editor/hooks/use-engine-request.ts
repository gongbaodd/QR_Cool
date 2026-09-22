import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import * as Comlink from 'comlink'
import { contentSchema, MAX_IMAGE_BYTES } from '../../../lib/editor/schema'
import type { Action, State } from '../../../lib/editor/state'
import { getEditorWorkerClient } from '../../../lib/editor/worker/editor-worker-client'
import type { AssembleInput, EngineInput } from '../../../lib/editor/engine'
import type { Settings } from '../../../lib/editor/schema'

export interface EditorRequestOptions {
  state: State
  dispatch: Dispatch<Action>
  poster: File | null
  mask: File | null
  maskBusy?: boolean
  previewWithoutContent?: boolean
}

export interface EditorRequest {
  /** Same surface as the old fetch hook; the engine's revision guard supersedes in-flight work. */
  request: (mode: 'prepare' | 'assemble', automatic?: boolean) => Promise<void>
  /**
   * Call-site stability only: an edit bumps the revision and the worker drops
   * superseded runs at the outcome boundary (phase 3), so there is nothing to abort.
   */
  cancel: () => void
}

/**
 * Owns the prepare/assemble lifecycle, calling the Comlink worker client
 * directly — no fetch, no request abstraction on top of it. Outcomes settle
 * to `{ok | stale | error}` and are dispatched with the revision they belong
 * to; the reducer's revision guard rejects superseded results.
 */
export function useEngineRequest({
  state,
  dispatch,
  poster,
  mask,
  maskBusy = false,
  previewWithoutContent = false,
}: EditorRequestOptions): EditorRequest {
  const latest = useRef(state)
  latest.current = state

  async function request(mode: 'prepare' | 'assemble', automatic = false) {
    const current = latest.current
    const hasValidContent = contentSchema.safeParse(current.content).success
    const previewContent =
      mode === 'prepare' && previewWithoutContent && !hasValidContent ? 'A' : current.content
    if (
      !poster ||
      poster.size > MAX_IMAGE_BYTES ||
      (mask && mask.size > MAX_IMAGE_BYTES) ||
      (!hasValidContent && previewContent === current.content)
    )
      return
    dispatch({ type: 'busy', mode, revision: current.revision })
    const engine = getEditorWorkerClient()
    const revision = current.revision
    const input: EngineInput = {
      posterBytes: await toTransferredBytes(poster),
      content: previewContent,
      settings: current.settings,
    }
    if (mask) input.maskBytes = await toTransferredBytes(mask)
    // Identical placement inclusion rules as the former FormData request:
    // manual placements round-trip with a recentering hint; automatic runs don't.
    if (!automatic && current.placement) {
      input.placement = current.placement
      if (mode === 'prepare' && current.prepared) input.previousTotalModules = current.prepared.qrMetadata.totalModules
    }
    if (mode === 'prepare') {
      const prepared = await engine.prepare(input, revision)
      if (!prepared.ok) {
        if (!('stale' in prepared))
          dispatch({
            type: 'error',
            revision: current.revision,
            message: prepared.error.message,
            ...(prepared.error.field ? { field: prepared.error.field } : {}),
          })
        return
      }
      dispatch({ type: 'prepared', data: { apiVersion: 1, revision: prepared.revision, ...prepared.value } })
    } else {
      const assembled = await engine.assemble(toAssembleInput(input, current.settings), revision)
      if (!assembled.ok) {
        if (!('stale' in assembled))
          dispatch({
            type: 'error',
            revision: current.revision,
            message: assembled.error.message,
            ...(assembled.error.field ? { field: assembled.error.field } : {}),
          })
        return
      }
      dispatch({
        type: 'result',
        data: { apiVersion: 1, revision: assembled.revision, artifacts: assembled.value.artifacts },
      })
    }
  }

  useEffect(() => {
    if (!poster || maskBusy) return
    const timer = setTimeout(() => {
      void request('prepare')
    }, 450)
    return () => clearTimeout(timer)
    // Responses never increment the revision; the deps mirror the old fetch hook.
  }, [state.revision, poster, mask, maskBusy]) // eslint-disable-line react-hooks/exhaustive-deps

  function cancel() {}
  return { request, cancel }
}

/** Reads a File's bytes and hands them to the worker as a transferable (no defensive copy). */
async function toTransferredBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return Comlink.transfer(bytes, [bytes.buffer])
}

/** The engine takes flat settings on assemble, as the old request JSON did. */
function toAssembleInput(input: EngineInput, settings: Settings): AssembleInput {
  return {
    posterBytes: input.posterBytes,
    ...(input.maskBytes ? { maskBytes: input.maskBytes } : {}),
    content: input.content,
    placement: input.placement as AssembleInput['placement'],
    ...settings,
  }
}
