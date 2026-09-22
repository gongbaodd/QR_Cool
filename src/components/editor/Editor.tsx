'use client'
import dynamic from 'next/dynamic'
import { useEffect, useReducer, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import {
  BLANK_MASK_FILENAME,
  BLANK_POSTER_FILENAME,
  BLANK_POSTER_HEIGHT,
  BLANK_POSTER_WIDTH,
  buildBlankMaskRgba,
  buildBlankPosterRgba,
} from '../../lib/editor/blank'
import { TEXT_MASK_FILENAME, deriveMaskLetter } from '../../lib/editor/text-mask'
import type { Placement } from '../../lib/editor/schema'
import EditorHeader from './EditorHeader'
import PreviewPanel from './PreviewPanel'
import MaskPanel from './MaskPanel'
import QrDetailsPanel from './QrDetailsPanel'
import ResponsiveEditorPanel from './ResponsiveEditorPanel'
import PreparationError from './PreparationError'
import { useBlobUrls } from './hooks/use-blob-urls'
import { useEngineRequest } from './hooks/use-engine-request'
import { useIconSearch } from './hooks/use-icon-search'
import { useMaskSelection } from './hooks/use-mask-selection'
import { ui } from '../../styles/ui.stylex'
import { tokens } from '../../styles/tokens.stylex'

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
  const [state, dispatch] = useReducer(reducer, initialState)
  const [draftContent, setDraftContent] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftBlurred, setDraftBlurred] = useState(false)
  const [poster, setPoster] = useState<File | null>(null)
  const [mask, setMask] = useState<File | null>(null)
  const [posterUrl, setPosterUrl] = useState('')
  const [maskOpen, setMaskOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const maskTriggerRef = useRef<HTMLButtonElement | null>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const searchQueryRef = useRef('')
  const blankStarted = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const iconSearch = useIconSearch(searchQueryRef)
  const suggestedMask = deriveMaskLetter(state.content)
  const maskSelection = useMaskSelection({
    revision: state.revision,
    prepared: state.prepared,
    suggestedMask,
    closeGallery: iconSearch.closeGallery,
    onUploadMask: uploadMaskFile,
    dispatch,
  })
  const { request, cancel } = useEngineRequest({ state, dispatch, poster, mask, maskBusy: maskSelection.busy })
  searchQueryRef.current = maskSelection.text.trim()
  const previews = useBlobUrls(
    state.prepared
      ? { 'mask.png': state.prepared.overlay, 'region.png': state.prepared.mask, 'qr.png': state.prepared.qr }
      : {},
  )
  const artifacts = useBlobUrls(state.result?.artifacts ?? {})
  const preparationError = state.error && state.field !== 'content' ? state.error : null
  const committedContentError = state.field === 'content' ? state.error : null
  const current = !!state.prepared && state.prepared.revision === state.revision && !state.error
  const busy = !!state.busy || maskSelection.busy || iconSearch.loading

  useEffect(() => {
    if (!poster) return
    const url = URL.createObjectURL(poster)
    setPosterUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [poster])
  useEffect(() => {
    if (!poster || !mask) return
    for (const entry of ['Fathead', 'FatC']) void document.fonts.load(`24px "${entry}"`).catch(() => {})
  }, [poster, mask])
  function edit(patch: Parameters<typeof reducer>[1] & { type: 'edit' }) {
    cancel()
    dispatch(patch)
  }
  function uploadMaskFile(file: File) {
    setMask(file)
    edit({ type: 'edit', patch: {}, reset: true })
    if (file.size > MAX_IMAGE_BYTES)
      dispatch({
        type: 'error',
        revision: state.revision + 1,
        message: 'Each PNG must be 10 MiB or smaller.',
        field: 'mask',
      })
  }
  function ensureBlankPoster() {
    if (poster || typeof document === 'undefined') return
    const width = BLANK_POSTER_WIDTH
    const height = BLANK_POSTER_HEIGHT
    const posterCanvas = document.createElement('canvas')
    posterCanvas.width = width
    posterCanvas.height = height
    posterCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankPosterRgba(width, height)), width, height), 0, 0)
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    maskCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankMaskRgba(width, height)), width, height), 0, 0)
    posterCanvas.toBlob((posterBlob) => {
      maskCanvas.toBlob((maskBlob) => {
        if (!posterBlob || !maskBlob) return
        setPoster(new File([posterBlob], BLANK_POSTER_FILENAME, { type: 'image/png' }))
        setMask(new File([maskBlob], BLANK_MASK_FILENAME, { type: 'image/png' }))
        dispatch({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } }, reset: true })
      }, 'image/png')
    }, 'image/png')
  }
  useEffect(() => {
    if (blankStarted.current) return
    blankStarted.current = true
    ensureBlankPoster()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  function submitDraft() {
    const parsed = contentSchema.safeParse(draftContent)
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'Enter text or a URL.')
      setDraftBlurred(true)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    setDraftError(null)
    if (parsed.data === state.content) return
    edit({ type: 'edit', patch: { content: parsed.data } })
  }
  function onDraftBlur() {
    setDraftBlurred(true)
    const parsed = contentSchema.safeParse(draftContent)
    setDraftError(parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Enter text or a URL.'))
  }
  function handleSearch() {
    void iconSearch.handleSearchClick(searchQueryRef.current, maskSelection.busy)
  }
  function handleGallerySelect(index: number) {
    const item = iconSearch.results[index]
    if (item) maskSelection.selectIcon(item)
  }
  function handleFillCommit(preview: HTMLCanvasElement) {
    maskSelection.markManualFill()
    const width = state.prepared?.width ?? BLANK_POSTER_WIDTH
    const height = state.prepared?.height ?? BLANK_POSTER_HEIGHT
    const full = document.createElement('canvas')
    full.width = width
    full.height = height
    const context = full.getContext('2d')!
    context.imageSmoothingEnabled = false
    context.fillStyle = 'black'
    context.fillRect(0, 0, width, height)
    context.drawImage(preview, 0, 0, width, height)
    full.toBlob((blob) => {
      if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
    }, 'image/png')
  }
  function move(box: Placement) {
    if (!state.prepared) return
    edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared.qrMetadata.totalModules) } })
  }
  const visibleError = (draftBlurred ? draftError : null) ?? committedContentError
  return (
    <main>
      <EditorHeader
        content={draftContent}
        contentError={visibleError}
        busy={busy}
        status={
          state.busy === 'prepare' || maskSelection.busy
            ? 'Updating the live preview…'
            : state.showingResult
              ? 'Export ready.'
              : 'Draft changes wait for Generate.'
        }
        onContentChange={(value) => {
          setDraftContent(value)
          if (draftError) setDraftError(null)
        }}
        onContentBlur={onDraftBlur}
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
            onOpenChange={setMaskOpen}
            triggerRef={maskTriggerRef}
          >
            <MaskPanel
              mask={maskSelection}
              search={iconSearch}
              onSearch={handleSearch}
              onFillCommit={handleFillCommit}
            />
          </ResponsiveEditorPanel>
        </div>
        <PreviewPanel
          showingResult={state.showingResult}
          dimensions={state.prepared ? { width: state.prepared.width, height: state.prepared.height } : null}
          result={state.result}
          artifacts={artifacts}
          previews={previews}
          posterUrl={posterUrl}
          placement={state.placement}
          modules={state.prepared?.qrMetadata.totalModules ?? 0}
          invalid={!!state.error}
          busy={busy}
          error={preparationError}
          current={current}
          onMove={move}
          onReturnToEditing={() => dispatch({ type: 'view', result: false })}
          onMaskOpen={() => setMaskOpen(true)}
          onDetailsOpen={() => setDetailsOpen(true)}
          maskOpen={maskOpen}
          detailsOpen={detailsOpen}
          maskTriggerRef={maskTriggerRef}
          detailsTriggerRef={detailsTriggerRef}
          pattern={{
            content: state.content,
            settings: state.settings,
            onSettings: (patch) => edit({ type: 'edit', patch: { settings: { ...state.settings, ...patch } } }),
            onNewSeed: () => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } }),
          }}
          onAssemble={() => void request('assemble')}
          assembleBusy={state.busy === 'assemble'}
          ready={current && !!state.placement && !busy}
        />
        <div {...stylex.props(styles.side)}>
          <ResponsiveEditorPanel
            id="qr-details-panel"
            side="right"
            title="QR details"
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            triggerRef={detailsTriggerRef}
          >
            <QrDetailsPanel
              content={state.content}
              settings={state.settings}
              onSettings={(patch) => edit({ type: 'edit', patch: { settings: { ...state.settings, ...patch } } })}
              onNewSeed={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}
              error={preparationError}
            />
          </ResponsiveEditorPanel>
        </div>
      </div>
      {preparationError && state.field !== 'placement' && (
        <PreparationError message={preparationError} onRetry={() => void request('prepare')} />
      )}
      <IconGallery
        open={iconSearch.galleryMode}
        query={searchQueryRef.current}
        total={iconSearch.total}
        items={iconSearch.results}
        selectedIconId={maskSelection.selectedIconId}
        onSelect={handleGallerySelect}
        onClose={iconSearch.closeGallery}
      />
      {draftError && (
        <p {...stylex.props(styles.error, ui.error)} role="alert">
          {draftError}
        </p>
      )}
    </main>
  )
}
