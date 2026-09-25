import { createStore } from 'zustand/vanilla'
import { temporal } from 'zundo'
import { contentSchema, canonicalPlacement, MAX_IMAGE_BYTES, type Placement, type Settings } from './schema'
import { deriveMaskLetter, TEXT_MASK_MAX_LENGTH } from './text-mask'
import { createInitialState, reducer, type Prepared, type Result, type State } from './state'
import { sameTraceSnapshot, traceSnapshot, type EditorTrace } from './trace'
import type { IconItem } from './text-mask'

export interface DraftState {
  content: string
  error: string | null
  blurred: boolean
}

export interface SourcesState {
  poster: File | null
  mask: File | null
  transparentBlank: boolean
}

export interface MaskSelectionState {
  origin: 'auto' | 'manual'
  selection: 'auto' | 'font' | 'icon' | 'custom'
  text: string
  fontId: string
  selectedIcon: IconItem | null
  busy: boolean
}

export interface IconSearchState {
  results: IconItem[]
  total: number
  loading: boolean
  error: string | null
  fetchedQuery: string
  galleryMode: boolean
}

export interface PanelsState {
  maskOpen: boolean
  patternSettingsOpen: boolean
}

export interface EditorStoreState {
  document: State
  draft: DraftState
  sources: SourcesState
  maskSelection: MaskSelectionState
  iconSearch: IconSearchState
  panels: PanelsState
  trace: EditorTrace
  actions: EditorActions
}

export interface EditorActions {
  setDraftContent: (content: string) => void
  blurDraft: () => void
  commitDraft: () => boolean
  patchSettings: (patch: Partial<Settings>) => void
  setSeed: (seed: number) => void
  movePlacement: (placement: Placement) => void
  initializeSources: (poster: File, mask: File, seed: number, transparentBlank?: boolean) => void
  replaceMask: (mask: File) => void
  selectCustomMask: (mask: File) => void
  setMaskBusy: (busy: boolean) => void
  setMaskText: (text: string) => void
  selectMaskFont: (fontId: string) => void
  selectMaskIcon: (item: IconItem) => void
  startSearch: (query: string) => void
  finishSearch: (query: string, results: IconItem[], total: number, open: boolean) => void
  failSearch: (query: string, message: string) => void
  closeGallery: () => void
  setMaskOpen: (open: boolean) => void
  setPatternSettingsOpen: (open: boolean) => void
  setResultView: (result: boolean) => void
  startEngine: (mode: 'prepare' | 'assemble', revision: number) => void
  cancelAssembly: () => void
  acceptPrepared: (data: Prepared) => void
  acceptResult: (data: Result) => void
  failEngine: (revision: number, message: string, field?: string) => void
}

const initialDraft = (): DraftState => ({ content: '', error: null, blurred: false })
const initialSources = (): SourcesState => ({ poster: null, mask: null, transparentBlank: false })
const initialMaskSelection = (): MaskSelectionState => ({
  origin: 'auto',
  selection: 'auto',
  text: 'A',
  fontId: 'blank',
  selectedIcon: null,
  busy: false,
})
const initialIconSearch = (): IconSearchState => ({
  results: [],
  total: 0,
  loading: false,
  error: null,
  fetchedQuery: '',
  galleryMode: false,
})
const initialPanels = (): PanelsState => ({ maskOpen: false, patternSettingsOpen: false })

function editDocument(document: State, patch: Parameters<typeof reducer>[1] & { type: 'edit' }): State {
  return reducer(document, patch)
}

export function createEditorStore() {
  return createStore<EditorStoreState>()(
    temporal(
      (rawSet) => {
        const set = (update: (current: EditorStoreState) => Partial<EditorStoreState>) =>
          rawSet((current) => {
            const patch = update(current)
            if (patch === current) return current
            const nextState = { ...current, ...patch }
            const snapshot = traceSnapshot(nextState)
            return sameTraceSnapshot(current.trace.state, snapshot)
              ? patch
              : { ...patch, trace: { at: Date.now(), state: snapshot } }
          })
        const actions: EditorActions = {
          setDraftContent: (content) => set((current) => ({ draft: { ...current.draft, content, error: null } })),
          blurDraft: () =>
            set((current) => {
              const parsed = contentSchema.safeParse(current.draft.content)
              return {
                draft: {
                  ...current.draft,
                  blurred: true,
                  error: parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Enter text or a URL.'),
                },
              }
            }),
          commitDraft: () => {
            let committed = false
            set((current) => {
              const parsed = contentSchema.safeParse(current.draft.content)
              if (!parsed.success) {
                return {
                  draft: {
                    ...current.draft,
                    blurred: true,
                    error: parsed.error.issues[0]?.message ?? 'Enter text or a URL.',
                  },
                }
              }
              committed = true
              const draft = { ...current.draft, error: null }
              if (parsed.data === current.document.content) return { draft }
              return {
                draft,
                document: editDocument(current.document, {
                  type: 'edit',
                  patch: { content: parsed.data },
                  assets: true,
                }),
              }
            })
            return committed
          },
          patchSettings: (patch) =>
            set((current) => ({
              document: editDocument(current.document, {
                type: 'edit',
                patch: { settings: { ...current.document.settings, ...patch } },
                assets: ['ecc', 'pixelStyle', 'finderMarkers', 'markerSub', 'colors'].some((key) => key in patch),
              }),
            })),
          setSeed: (seed) =>
            set((current) => ({
              document: editDocument(current.document, {
                type: 'edit',
                patch: { settings: { ...current.document.settings, seed } },
              }),
            })),
          movePlacement: (placement) =>
            set((current) => {
              const prepared = current.document.prepared
              if (!prepared) return current
              return {
                document: editDocument(current.document, {
                  type: 'edit',
                  patch: { placement: canonicalPlacement(placement, prepared.qrMetadata.totalModules) },
                }),
              }
            }),
          initializeSources: (poster, mask, seed, transparentBlank = false) =>
            set((current) => {
              if (current.sources.poster) return current
              // Automatic mask rendering may finish before blank-poster encoding.
              // Keep that mask, but still install the poster needed by preparation.
              const sourceMask = current.sources.mask ?? mask
              let document = editDocument(current.document, {
                type: 'edit',
                patch: { settings: { ...current.document.settings, seed } },
                reset: true,
              })
              if (sourceMask.size > MAX_IMAGE_BYTES)
                document = reducer(document, {
                  type: 'error',
                  revision: document.revision,
                  message: 'Each PNG must be 10 MiB or smaller.',
                  field: 'mask',
                })
              return { sources: { poster, mask: sourceMask, transparentBlank }, document }
            }),
          replaceMask: (mask) =>
            set((current) => {
              let document = editDocument(current.document, { type: 'edit', patch: {}, assets: true })
              if (mask.size > MAX_IMAGE_BYTES)
                document = reducer(document, {
                  type: 'error',
                  revision: document.revision,
                  message: 'Each PNG must be 10 MiB or smaller.',
                  field: 'mask',
                })
              return { sources: { ...current.sources, mask }, document }
            }),
          selectCustomMask: (mask) =>
            set((current) => ({
              sources: { ...current.sources, mask },
              document: editDocument(current.document, { type: 'edit', patch: {}, assets: true }),
              maskSelection: {
                ...current.maskSelection,
                origin: 'manual',
                selection: 'custom',
                selectedIcon: null,
                busy: false,
              },
              iconSearch: { ...current.iconSearch, galleryMode: false },
            })),
          setMaskBusy: (busy) => set((current) => ({ maskSelection: { ...current.maskSelection, busy } })),
          setMaskText: (text) =>
            set((current) => ({
              maskSelection: {
                ...current.maskSelection,
                origin: 'manual',
                selection: 'font',
                text: text.slice(0, TEXT_MASK_MAX_LENGTH),
                selectedIcon: null,
              },
              iconSearch: { ...current.iconSearch, galleryMode: false },
            })),
          selectMaskFont: (fontId) =>
            set((current) => ({
              maskSelection: {
                ...current.maskSelection,
                origin: 'manual',
                selection: 'font',
                text: selectMaskText(current),
                fontId,
                selectedIcon: null,
              },
            })),
          selectMaskIcon: (item) =>
            set((current) => ({
              maskSelection: {
                ...current.maskSelection,
                origin: 'manual',
                selection: 'icon',
                text: selectMaskText(current),
                selectedIcon: item,
              },
            })),
          startSearch: () =>
            set((current) => ({
              iconSearch: { ...current.iconSearch, loading: true, error: null, galleryMode: true },
            })),
          finishSearch: (query, results, total, open) =>
            set((current) => ({
              iconSearch: {
                ...current.iconSearch,
                results,
                total,
                fetchedQuery: query,
                loading: false,
                galleryMode: open,
              },
            })),
          failSearch: (query, message) =>
            set((current) => ({
              iconSearch: {
                ...current.iconSearch,
                results: [],
                total: 0,
                fetchedQuery: query,
                loading: false,
                error: message,
                galleryMode: false,
              },
            })),
          closeGallery: () => set((current) => ({ iconSearch: { ...current.iconSearch, galleryMode: false } })),
          setMaskOpen: (maskOpen) => set((current) => ({ panels: { ...current.panels, maskOpen } })),
          setPatternSettingsOpen: (patternSettingsOpen) =>
            set((current) => ({ panels: { ...current.panels, patternSettingsOpen } })),
          setResultView: (result) =>
            set((current) => ({ document: reducer(current.document, { type: 'view', result }) })),
          startEngine: (mode, revision) =>
            set((current) => ({ document: reducer(current.document, { type: 'busy', mode, revision }) })),
          cancelAssembly: () =>
            set((current) => ({ document: reducer(current.document, { type: 'cancel-assemble' }) })),
          acceptPrepared: (data) =>
            set((current) => ({ document: reducer(current.document, { type: 'prepared', data }) })),
          acceptResult: (data) => set((current) => ({ document: reducer(current.document, { type: 'result', data }) })),
          failEngine: (revision, message, field) =>
            set((current) => ({
              document: reducer(
                current.document,
                field === undefined
                  ? { type: 'error', revision, message }
                  : { type: 'error', revision, message, field },
              ),
            })),
        }

        const initial = {
          document: createInitialState(),
          draft: initialDraft(),
          sources: initialSources(),
          maskSelection: initialMaskSelection(),
          iconSearch: initialIconSearch(),
          panels: initialPanels(),
          actions,
        }
        return { ...initial, trace: { at: Date.now(), state: traceSnapshot(initial) } }
      },
      {
        partialize: ({ trace }) => ({ trace }),
        equality: (past, current) => past.trace === current.trace,
        limit: 50,
      },
    ),
  )
}

export type EditorStore = ReturnType<typeof createEditorStore>

/** The session timeline, oldest first; no history is persisted or sent anywhere. */
export function getEditorTrace(store: EditorStore): EditorTrace[] {
  const past = store.temporal.getState().pastStates
  return [...past.flatMap((entry) => (entry.trace ? [entry.trace] : [])), store.getState().trace]
}

function selectMaskText(current: EditorStoreState): string {
  const value =
    current.maskSelection.origin === 'auto' ? deriveMaskLetter(current.document.content) : current.maskSelection.text
  return (value || 'A').slice(0, TEXT_MASK_MAX_LENGTH)
}
