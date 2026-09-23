'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'
import EditorStoreProvider, { useEditorStore, useEditorStoreApi } from './EditorStoreProvider'
import {
  selectCanAssemble,
  selectCurrent,
  selectPreparationError,
  selectVisibleContentError,
} from '@/lib/editor/selectors'
import {
  BLANK_MASK_FILENAME,
  BLANK_POSTER_FILENAME,
  BLANK_POSTER_HEIGHT,
  BLANK_POSTER_WIDTH,
  buildBlankMaskRgba,
  buildBlankPosterRgba,
} from '@/lib/editor/blank'
import EditorHeader from './EditorHeader'
import PreviewPanel from './PreviewPanel'
import MaskPanel from './MaskPanel'
import PatternSettings from './PatternSettings'
import ResponsiveEditorPanel from './ResponsiveEditorPanel'
import PreparationError from './PreparationError'
import { useBlobUrls } from './hooks/use-blob-urls'
import { useEngineRequest } from './hooks/use-engine-request'
import { useIconSearch } from './hooks/use-icon-search'
import { useMaskSelection } from './hooks/use-mask-selection'
import { contentSchema } from '@/lib/editor/schema'
import { TEXT_MASK_FILENAME } from '@/lib/editor/text-mask'
import { ui } from '@/styles/ui.stylex'
import { tokens } from '@/styles/tokens.stylex'

const IconGallery = dynamic(() => import('./IconGallery'))
const styles = stylex.create({
  shell: {
    display: 'grid',
    gridTemplateColumns: 'minmax(15rem, 0.8fr) minmax(22rem, 1.7fr) minmax(18rem, 0.9fr)',
    gap: 18,
    alignItems: 'start',
    padding: 18,
    maxWidth: 1800,
    marginInline: 'auto',
    '@media (max-width: 1200px)': {
      gridTemplateColumns: 'minmax(14rem, 0.75fr) minmax(20rem, 1.5fr) minmax(16rem, 0.85fr)',
    },
    '@media (max-width: 900px)': { display: 'block', padding: 10 },
  },
  side: { minWidth: 0 },
  error: { margin: 0, padding: 10, backgroundColor: tokens.highlightSoft, borderRadius: tokens.sketch },
})

const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!

export default function Editor() {
  return (
    <EditorStoreProvider>
      <EditorWorkspace />
    </EditorStoreProvider>
  )
}

function EditorWorkspace() {
  const store = useEditorStoreApi()
  const actions = useEditorStore((state) => state.actions)
  const draft = useEditorStore((state) => state.draft)
  const editorDocument = useEditorStore((state) => state.document)
  const poster = useEditorStore((state) => state.sources.poster)
  const maskText = useEditorStore((state) => state.maskSelection.text)
  const maskBusy = useEditorStore((state) => state.maskSelection.busy)
  const iconSearch = useIconSearch()
  const maskSelection = useMaskSelection({})
  const { request } = useEngineRequest()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const maskTriggerRef = useRef<HTMLButtonElement | null>(null)
  const patternSettingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const initialization = useRef(0)

  const previews = useBlobUrls(
    editorDocument.prepared
      ? {
          'mask.png': editorDocument.prepared.overlay,
          'region.png': editorDocument.prepared.mask,
          'qr.png': editorDocument.prepared.qr,
        }
      : {},
  )
  const artifacts = useBlobUrls(editorDocument.result?.artifacts ?? {})
  const posterUrls = useBlobUrls(poster ? { poster } : {})
  const sourceMask = useEditorStore((state) => state.sources.mask)
  const sourceMaskUrls = useBlobUrls(sourceMask ? { mask: sourceMask } : {})
  const posterUrl = posterUrls.poster ?? ''
  const sourceMaskUrl = sourceMaskUrls.mask ?? ''
  const preparationError = useEditorStore(selectPreparationError)
  const visibleError = useEditorStore(selectVisibleContentError)
  const current = useEditorStore(selectCurrent)
  const maskOpen = useEditorStore((state) => state.panels.maskOpen)
  const patternSettingsOpen = useEditorStore((state) => state.panels.patternSettingsOpen)
  const busy = useEditorStore((state) => !!state.document.busy || state.maskSelection.busy || state.iconSearch.loading)
  const canAssemble = useEditorStore(selectCanAssemble)

  useEffect(() => {
    if (store.getState().sources.poster) return
    const token = ++initialization.current
    const width = BLANK_POSTER_WIDTH
    const height = BLANK_POSTER_HEIGHT
    const posterCanvas = globalThis.document.createElement('canvas')
    posterCanvas.width = width
    posterCanvas.height = height
    posterCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankPosterRgba(width, height)), width, height), 0, 0)
    const maskCanvas = globalThis.document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    maskCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankMaskRgba(width, height)), width, height), 0, 0)
    posterCanvas.toBlob((posterBlob) => {
      maskCanvas.toBlob((maskBlob) => {
        if (token !== initialization.current || !posterBlob || !maskBlob) return
        actions.initializeSources(
          new File([posterBlob], BLANK_POSTER_FILENAME, { type: 'image/png' }),
          new File([maskBlob], BLANK_MASK_FILENAME, { type: 'image/png' }),
          freshSeed(),
        )
      }, 'image/png')
    }, 'image/png')
    return () => {
      initialization.current += 1
    }
  }, [actions, store])

  function submitDraft() {
    if (!actions.commitDraft()) requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleGallerySelect(index: number) {
    const item = iconSearch.results[index]
    if (item) maskSelection.selectIcon(item)
  }

  return (
    <main>
      <EditorHeader
        content={draft.content}
        contentError={visibleError}
        busy={busy}
        status={
          editorDocument.busy === 'prepare' || maskBusy
            ? 'Updating the live preview…'
            : editorDocument.showingResult
              ? 'Export ready.'
              : 'Draft changes wait for Generate.'
        }
        onContentChange={actions.setDraftContent}
        onContentBlur={actions.blurDraft}
        onSubmit={submitDraft}
        inputRef={inputRef}
      />
      <div {...stylex.props(styles.shell)}>
        <div {...stylex.props(styles.side)}>
          <ResponsiveEditorPanel
            id="mask-panel"
            side="left"
            title="Mask selection"
            open={maskOpen}
            onOpenChange={actions.setMaskOpen}
            triggerRef={maskTriggerRef}
          >
            <MaskPanel mask={maskSelection} search={iconSearch} onSearch={iconSearch.handleSearchClick} />
          </ResponsiveEditorPanel>
        </div>
        <PreviewPanel
          showingResult={editorDocument.showingResult}
          dimensions={
            editorDocument.prepared
              ? { width: editorDocument.prepared.width, height: editorDocument.prepared.height }
              : null
          }
          result={editorDocument.result}
          artifacts={artifacts}
          previews={previews}
          posterUrl={posterUrl}
          sourceMaskUrl={sourceMaskUrl}
          regionOnly={!contentSchema.safeParse(editorDocument.content).success || editorDocument.field === 'placement'}
          placement={editorDocument.placement}
          modules={editorDocument.prepared?.qrMetadata.totalModules ?? 0}
          invalid={!!editorDocument.error}
          busy={busy}
          error={preparationError}
          current={current}
          onMove={actions.movePlacement}
          onMaskFillCommit={(mask) =>
            actions.replaceMask(new File([mask], TEXT_MASK_FILENAME, { type: 'image/png' }))
          }
          onReturnToEditing={() => actions.setResultView(false)}
          onMaskOpen={() => actions.setMaskOpen(true)}
          onPatternSettingsOpen={() => actions.setPatternSettingsOpen(true)}
          maskOpen={maskOpen}
          patternSettingsOpen={patternSettingsOpen}
          maskTriggerRef={maskTriggerRef}
          patternSettingsTriggerRef={patternSettingsTriggerRef}
          pattern={{
            settings: editorDocument.settings,
            onSettings: actions.patchSettings,
          }}
          onAssemble={() => void request('assemble')}
          assembleBusy={editorDocument.busy === 'assemble'}
          ready={current && !!editorDocument.placement && !busy}
          canAssemble={canAssemble}
        />
        <div {...stylex.props(styles.side)}>
          <ResponsiveEditorPanel
            id="pattern-settings-panel"
            side="right"
            title="Pattern settings"
            open={patternSettingsOpen}
            onOpenChange={actions.setPatternSettingsOpen}
            triggerRef={patternSettingsTriggerRef}
          >
            <PatternSettings
              settings={editorDocument.settings}
              onSettings={actions.patchSettings}
            />
          </ResponsiveEditorPanel>
        </div>
      </div>
      {preparationError && editorDocument.field !== 'placement' && (
        <PreparationError message={preparationError} onRetry={() => void request('prepare')} />
      )}
      <IconGallery
        open={iconSearch.galleryMode}
        query={maskText.trim()}
        total={iconSearch.total}
        items={iconSearch.results}
        selectedIconId={maskSelection.selectedIconId}
        onSelect={handleGallerySelect}
        onClose={iconSearch.closeGallery}
      />
      {draft.error && (
        <p {...stylex.props(styles.error, ui.error)} role="alert">
          {draft.error}
        </p>
      )}
    </main>
  )
}
