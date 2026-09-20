import type { Placement, Settings } from './schema'
export interface Prepared {
  apiVersion: 1
  revision: number
  width: number
  height: number
  mask: string
  overlay: string
  qr: string
  qrMetadata: { totalModules: number; version: number }
  placement: Placement
  validation: string | null
}
export interface Result {
  apiVersion: 1
  revision: number
  artifacts: Record<string, string>
}
export interface State {
  revision: number
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
export const initialState: State = {
  revision: 0,
  content: 'https://example.com',
  settings: {
    seed: 0,
    qrMargin: 1,
    plateCorners: 'texture',
    rimModules: 1,
    rimRounded: false,
    ecc: 'M',
    pixelStyle: 'rounded',
  },
  prepared: null,
  placement: null,
  result: null,
  busy: null,
  error: null,
  field: null,
  showingResult: false,
}
export type Action =
  | { type: 'edit'; patch: Partial<Pick<State, 'content' | 'settings' | 'placement'>>; reset?: boolean }
  | { type: 'busy'; mode: 'prepare' | 'assemble'; revision: number }
  | { type: 'prepared'; data: Prepared }
  | { type: 'result'; data: Result }
  | { type: 'error'; revision: number; message: string; field?: string }
  | { type: 'view'; result: boolean }
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        ...action.patch,
        revision: state.revision + 1,
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
      return action.data.revision === state.revision
        ? {
            ...state,
            prepared: action.data,
            placement: action.data.placement,
            busy: null,
            error: action.data.validation,
            field: action.data.validation ? 'placement' : null,
          }
        : state
    case 'result':
      return action.data.revision === state.revision
        ? { ...state, result: action.data, busy: null, showingResult: true }
        : state
    case 'error':
      return action.revision === state.revision
        ? { ...state, busy: null, error: action.message, field: action.field ?? null }
        : state
    case 'view':
      return { ...state, showingResult: action.result }
  }
}
