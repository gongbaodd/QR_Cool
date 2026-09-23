import { shallow } from 'zustand/shallow'
import type { EditorStoreState } from './store'

type TraceSource = Pick<EditorStoreState, 'document' | 'draft' | 'sources' | 'maskSelection' | 'iconSearch' | 'panels'>

export interface EditorTraceSnapshot {
  revision: number
  content: string
  draftContent: string
  draftError: string | null
  draftBlurred: boolean
  settings: EditorStoreState['document']['settings']
  placement: EditorStoreState['document']['placement']
  preparedRevision: number | null
  resultRevision: number | null
  busy: EditorStoreState['document']['busy']
  error: string | null
  errorField: string | null
  showingResult: boolean
  hasPoster: boolean
  hasMask: boolean
  maskOrigin: EditorStoreState['maskSelection']['origin']
  maskText: string
  maskFontId: string
  selectedIconId: string | null
  maskBusy: boolean
  iconSearchLoading: boolean
  iconSearchResultCount: number
  iconSearchError: string | null
  galleryMode: boolean
  maskOpen: boolean
  patternSettingsOpen: boolean
}

export interface EditorTrace {
  at: number
  state: EditorTraceSnapshot
}

/** Keep the timeline useful without retaining source files, render blobs, or icon payloads. */
export function traceSnapshot(current: TraceSource): EditorTraceSnapshot {
  return {
    revision: current.document.revision,
    content: current.document.content,
    draftContent: current.draft.content,
    draftError: current.draft.error,
    draftBlurred: current.draft.blurred,
    settings: current.document.settings,
    placement: current.document.placement,
    preparedRevision: current.document.prepared?.revision ?? null,
    resultRevision: current.document.result?.revision ?? null,
    busy: current.document.busy,
    error: current.document.error,
    errorField: current.document.field,
    showingResult: current.document.showingResult,
    hasPoster: current.sources.poster !== null,
    hasMask: current.sources.mask !== null,
    maskOrigin: current.maskSelection.origin,
    maskText: current.maskSelection.text,
    maskFontId: current.maskSelection.fontId,
    selectedIconId: current.maskSelection.selectedIcon?.id ?? null,
    maskBusy: current.maskSelection.busy,
    iconSearchLoading: current.iconSearch.loading,
    iconSearchResultCount: current.iconSearch.results.length,
    iconSearchError: current.iconSearch.error,
    galleryMode: current.iconSearch.galleryMode,
    maskOpen: current.panels.maskOpen,
    patternSettingsOpen: current.panels.patternSettingsOpen,
  }
}

export function sameTraceSnapshot(a: EditorTraceSnapshot, b: EditorTraceSnapshot): boolean {
  return shallow(a, b)
}
