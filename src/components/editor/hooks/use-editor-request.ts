import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import { contentSchema, MAX_IMAGE_BYTES } from '../../../lib/editor/schema'
import type { Action, State } from '../../../lib/editor/state'

export interface EditorRequestOptions {
  state: State
  dispatch: Dispatch<Action>
  poster: File | null
  mask: File | null
}

export interface EditorRequest {
  request: (mode: 'prepare' | 'assemble', automatic?: boolean) => Promise<void>
  cancel: () => void
}

/** Owns the prepare/assemble fetch lifecycle, its abort controller, and the auto-prepare debounce. */
export function useEditorRequest({ state, dispatch, poster, mask }: EditorRequestOptions): EditorRequest {
  const abort = useRef<AbortController | null>(null),
    latest = useRef(state)
  latest.current = state
  async function request(mode: 'prepare' | 'assemble', automatic = false) {
    if (
      !poster ||
      poster.size > MAX_IMAGE_BYTES ||
      (mask && mask.size > MAX_IMAGE_BYTES) ||
      !contentSchema.safeParse(latest.current.content).success
    )
      return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const current = latest.current
    dispatch({ type: 'busy', mode, revision: current.revision })
    const form = new FormData()
    form.set('poster', poster)
    if (mask) form.set('mask', mask)
    form.set(
      'data',
      JSON.stringify({
        revision: current.revision,
        content: current.content,
        settings: current.settings,
        ...(!automatic && current.placement
          ? {
              placement: current.placement,
              ...(mode === 'prepare' && current.prepared
                ? { previousTotalModules: current.prepared.qrMetadata.totalModules }
                : {}),
            }
          : {}),
      }),
    )
    try {
      const response = await fetch(`/api/${mode}`, { method: 'POST', body: form, signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(data.message), { field: data.field })
      dispatch({ type: mode === 'prepare' ? 'prepared' : 'result', data })
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({
          type: 'error',
          revision: current.revision,
          message: error instanceof Error ? error.message : 'Request failed. Please retry.',
          ...(error && typeof error === 'object' && 'field' in error && typeof error.field === 'string'
            ? { field: error.field }
            : {}),
        })
    }
  }
  useEffect(() => {
    if (!poster) return
    const timer = setTimeout(() => {
      void request('prepare')
    }, 450)
    return () => {
      clearTimeout(timer)
      abort.current?.abort()
    }
  }, [state.revision, poster, mask]) // eslint-disable-line react-hooks/exhaustive-deps -- Responses never increment the revision.
  function cancel() {
    abort.current?.abort()
  }
  return { request, cancel }
}
