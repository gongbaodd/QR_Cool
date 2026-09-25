import type { Placement, Settings } from './schema'
import { recenterPlacement } from './schema'
import { DEFAULT_PALETTE } from '@/core/palette'
export interface Prepared {
  apiVersion: 1
  revision: number
  assetRevision: number
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
export interface Result {
  apiVersion: 1
  revision: number
  artifacts: Record<string, Blob>
  recipe?: Blob
  recipeError?: string
}
export interface State {
  revision: number
  assetRevision: number
  content: string
  settings: Settings
  prepared: Prepared | null
  placement: Placement | null
  result: Result | null
  busy: 'prepare' | 'assemble' | null
  error: string | null
  field: string | null
  showingResult: boolean
}
export function createInitialState(): State {
  return {
    revision: 0,
    assetRevision: 0,
    content: '',
    settings: {
      seed: 0,
      qrMargin: 1,
      plateCorners: 'texture',
      regionMargin: false,
      rimModules: 1,
      rimRounded: false,
      ecc: 'M',
      pixelStyle: 'dot',
      finderMarkers: {
        tl: { style: 'rounded', shape: 'circle', inner: 'circle' },
        tr: { style: 'rounded', shape: 'circle', inner: 'circle' },
        bl: { style: 'rounded', shape: 'circle', inner: 'circle' },
      },
      markerSub: 'square',
      colors: { ...DEFAULT_PALETTE },
    },
    prepared: null,
    placement: null,
    result: null,
    busy: null,
    error: null,
    field: null,
    showingResult: false,
  }
}

/** Backwards-compatible deterministic defaults for pure reducer consumers. */
export const initialState: State = createInitialState()
export type Action =
  | {
      type: 'edit'
      patch: Partial<Pick<State, 'content' | 'settings' | 'placement'>>
      reset?: boolean
      assets?: boolean
    }
  | { type: 'busy'; mode: 'prepare' | 'assemble'; revision: number }
  | { type: 'prepared'; data: Prepared }
  | { type: 'result'; data: Result }
  | { type: 'cancel-assemble' }
  | { type: 'error'; revision: number; message: string; field?: string }
  | { type: 'view'; result: boolean }
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        ...action.patch,
        revision: state.revision + 1,
        assetRevision: state.assetRevision + (action.assets || action.reset ? 1 : 0),
        result: null,
        busy: null,
        error: null,
        field: null,
        showingResult: false,
        ...(action.reset ? { prepared: null, placement: null } : {}),
      }
    case 'busy':
      return action.revision === state.revision ? { ...state, busy: action.mode, error: null, field: null } : state
    case 'prepared':
      return action.data.assetRevision === state.assetRevision
        ? {
            ...state,
            prepared: action.data,
            placement: settlePreparedPlacement(state, action.data),
            busy: state.busy === 'prepare' ? null : state.busy,
            ...(state.error && state.field !== 'placement' ? {} : { error: null, field: null }),
          }
        : state
    case 'result':
      return action.data.revision === state.revision
        ? { ...state, result: action.data, busy: null, showingResult: true }
        : state
    case 'cancel-assemble':
      return state.busy === 'assemble' ? { ...state, busy: null, result: null, showingResult: false } : state
    case 'error':
      return action.revision === state.revision
        ? { ...state, busy: null, error: action.message, field: action.field ?? null }
        : state
    case 'view':
      return { ...state, showingResult: action.result }
  }
}

function settlePreparedPlacement(state: State, prepared: Prepared): Placement {
  if (!state.placement) return prepared.placement
  const previousModules = state.prepared?.qrMetadata.totalModules
  const nextModules = prepared.qrMetadata.totalModules
  if (!previousModules || previousModules === nextModules) return state.placement

  return recenterPlacement(state.placement, previousModules, nextModules)
}
