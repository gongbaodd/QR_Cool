'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as stylex from '@stylexjs/stylex'
import { toast, ToastContainer } from 'react-toastify'
import EditorStoreProvider, { useEditorStore, useEditorStoreApi } from './EditorStoreProvider'
import { selectCanAssemble, selectCurrent, selectVisibleContentError } from '@/lib/editor/selectors'
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
import ResponsiveEditorPanel, { MOBILE_LAYOUT_QUERY } from './ResponsiveEditorPanel'
import { useBlobUrls } from './hooks/use-blob-urls'
import { useEngineRequest } from './hooks/use-engine-request'
import { useIconSearch } from './hooks/use-icon-search'
import { useMaskSelection } from './hooks/use-mask-selection'
import { contentSchema } from '@mahu-qr/renderer/schema'
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
    '@media (max-width: 75em)': {
      gridTemplateColumns: 'minmax(14rem, 0.75fr) minmax(20rem, 1.5fr) minmax(16rem, 0.85fr)',
    },
    '@media (max-width: 56.25em)': { display: 'block', padding: 10 },
  },
  side: {
    minWidth: 0,
    marginTop: 48,
  },
  edgeControl: {
    position: 'fixed',
    top: '50%',
    zIndex: 6,
    display: 'none',
    placeItems: 'center',
    width: 64,
    height: 64,
    transform: 'translateY(-50%)',
    '@media (max-width: 56.25em)': { display: 'grid' },
  },
  edgeControlLeft: { left: 'max(0px, env(safe-area-inset-left))' },
  edgeControlRight: { right: 'max(0px, env(safe-area-inset-right))' },
  edgeButton: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: 'calc(100svh - 2rem)',
    whiteSpace: 'normal',
    textAlign: 'center',
    transform: 'rotate(90deg)',
    ':active': { transform: 'translate(2px, 3px) rotate(90deg)' },
    ':disabled': { transform: 'rotate(90deg)' },
  },
  edgeButtonRight: {
    transform: 'rotate(-90deg)',
    ':active': { transform: 'translate(2px, 3px) rotate(-90deg)' },
    ':disabled': { transform: 'rotate(-90deg)' },
  },
})

const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
const DRAFT_COMMIT_DEBOUNCE_MS = 500

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
  const draftContent = useEditorStore((state) => state.draft.content)
  const editorDocument = useEditorStore((state) => state.document)
  const poster = useEditorStore((state) => state.sources.poster)
  const maskText = useEditorStore((state) => state.maskSelection.text)
  const maskBusy = useEditorStore((state) => state.maskSelection.busy)
  const iconSearch = useIconSearch()
  const maskSelection = useMaskSelection({})
  const { request, exportRaster, failedMode, cancelAssembly } = useEngineRequest()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const draftCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maskTriggerRef = useRef<HTMLButtonElement | null>(null)
  const patternSettingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const initialization = useRef(0)
  const [toastHost, setToastHost] = useState<HTMLElement | null>(null)

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
  const preparationError = useEditorStore((state) =>
    state.document.error && state.document.field !== 'content' ? state.document.error : null,
  )
  const visibleError = useEditorStore(selectVisibleContentError)
  const current = useEditorStore(selectCurrent)
  const maskOpen = useEditorStore((state) => state.panels.maskOpen)
  const patternSettingsOpen = useEditorStore((state) => state.panels.patternSettingsOpen)
  const busy = useEditorStore((state) => !!state.document.busy || state.maskSelection.busy || state.iconSearch.loading)
  const canAssemble = useEditorStore(selectCanAssemble)

  // Keep a single Toastify host. Move it into the mobile pattern-settings dialog
  // while that modal is open so its notifications stay visible and interactive.
  useEffect(() => {
    const host = document.createElement('div')
    host.style.position = 'fixed'
    host.style.inset = '0'
    // The fixed host forms its own stacking context, so raise that context above
    // the editor header as well as the Toastify container inside it.
    host.style.zIndex = '10000'
    host.style.pointerEvents = 'none'
    document.body.appendChild(host)
    setToastHost(host)
    return () => host.remove()
  }, [])

  useEffect(() => {
    if (!toastHost) return
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY)
    let moveFrame: number | null = null
    const moveHost = () => {
      if (!media.matches || !patternSettingsOpen) {
        document.body.appendChild(toastHost)
        return
      }
      const dialog = document.getElementById('pattern-settings-panel')
      if (dialog instanceof HTMLDialogElement && dialog.open) {
        dialog.appendChild(toastHost)
        return
      }
      // The drawer opens in a sibling effect. Retry after that effect has run.
      if (moveFrame !== null) cancelAnimationFrame(moveFrame)
      moveFrame = requestAnimationFrame(() => {
        const openedDialog = document.getElementById('pattern-settings-panel')
        if (openedDialog instanceof HTMLDialogElement && openedDialog.open) {
          openedDialog.appendChild(toastHost)
        } else {
          document.body.appendChild(toastHost)
        }
      })
    }
    moveHost()
    media.addEventListener('change', moveHost)
    return () => {
      media.removeEventListener('change', moveHost)
      if (moveFrame !== null) cancelAnimationFrame(moveFrame)
    }
  }, [patternSettingsOpen, toastHost])

  useEffect(() => {
    if (!visibleError) {
      toast.dismiss('editor-content-error')
      return
    }
    const options = {
      toastId: 'editor-content-error',
      autoClose: false as const,
      role: 'alert' as const,
      ariaLabel: 'Content validation error',
    }
    if (toast.isActive('editor-content-error')) {
      toast.update('editor-content-error', { render: visibleError, type: 'error', ...options })
    } else {
      toast.error(visibleError, options)
    }
  }, [visibleError])

  useEffect(() => {
    if (!preparationError) {
      toast.dismiss('editor-document-error')
      return
    }
    const canRetry = editorDocument.field !== 'placement' && failedMode !== null
    const retryMode = failedMode
    const message = preparationError
    const content = (
      <div>
        <span>{message}</span>
        {canRetry && retryMode && (
          <button
            type="button"
            {...stylex.props(ui.button, ui.focusVisible, ui.textButton)}
            onClick={() => void request(retryMode)}
          >
            Retry {retryMode === 'prepare' ? 'preparation' : 'assembly'}
          </button>
        )}
      </div>
    )
    const options = {
      toastId: 'editor-document-error',
      autoClose: false as const,
      role: 'alert' as const,
      ariaLabel: 'Preview error',
    }
    if (toast.isActive('editor-document-error')) {
      toast.update('editor-document-error', { render: content, type: 'error', ...options })
    } else {
      toast.error(content, options)
    }
  }, [preparationError, editorDocument.field, failedMode, request])

  const iconSearchError = useEditorStore((state) => state.iconSearch.error)
  const iconFetchedQuery = useEditorStore((state) => state.iconSearch.fetchedQuery)
  const activeQuery = maskText.trim()
  useEffect(() => {
    const message = iconSearchError && iconFetchedQuery === activeQuery ? iconSearchError : null
    if (!message) {
      toast.dismiss('editor-icon-search-error')
      return
    }
    const content = (
      <span>
        {message} Search: “{iconFetchedQuery}”.
      </span>
    )
    const options = {
      toastId: 'editor-icon-search-error',
      autoClose: false as const,
      role: 'alert' as const,
      ariaLabel: `Icon search failed for ${iconFetchedQuery}`,
    }
    if (toast.isActive('editor-icon-search-error')) {
      toast.update('editor-icon-search-error', { render: content, type: 'error', ...options })
    } else {
      toast.error(content, options)
    }
  }, [iconSearchError, iconFetchedQuery, activeQuery])

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
          true,
        )
      }, 'image/png')
    }, 'image/png')
    return () => {
      initialization.current += 1
    }
  }, [actions, store])

  useEffect(() => {
    if (draftContent === store.getState().document.content) return

    draftCommitTimer.current = setTimeout(() => {
      draftCommitTimer.current = null
      actions.commitDraft()
    }, DRAFT_COMMIT_DEBOUNCE_MS)

    return () => {
      if (draftCommitTimer.current) clearTimeout(draftCommitTimer.current)
      draftCommitTimer.current = null
    }
  }, [actions, draftContent, store])

  function submitDraft() {
    if (draftCommitTimer.current) clearTimeout(draftCommitTimer.current)
    draftCommitTimer.current = null
    if (!actions.commitDraft()) requestAnimationFrame(() => inputRef.current?.focus())
  }

  function cancelDraftCommit() {
    if (draftCommitTimer.current) clearTimeout(draftCommitTimer.current)
    draftCommitTimer.current = null
  }

  function handleGallerySelect(index: number) {
    const item = iconSearch.results[index]
    if (item) maskSelection.selectIcon(item)
  }

  return (
    <main>
      {toastHost &&
        createPortal(
          <ToastContainer
            aria-label="Editor notifications"
            position={patternSettingsOpen ? 'bottom-center' : 'top-right'}
            autoClose={false}
            closeOnClick={false}
            newestOnTop
            limit={4}
            theme="light"
            toastStyle={{
              backgroundColor: tokens.card,
              color: tokens.ink,
              border: `2px solid ${tokens.ink}`,
              borderRadius: tokens.sketchCard,
              fontFamily: 'inherit',
            }}
            style={
              patternSettingsOpen
                ? {
                    insetBlockStart: 'auto',
                    insetBlockEnd: 'max(12px, env(safe-area-inset-bottom))',
                    insetInlineStart: '50%',
                    insetInlineEnd: 'auto',
                  }
                : {
                    insetBlockStart: 'max(12px, env(safe-area-inset-top))',
                    insetInlineEnd: 'max(12px, env(safe-area-inset-right))',
                  }
            }
          />,
          toastHost,
        )}
      <EditorHeader
        contentError={visibleError}
        status={
          editorDocument.busy === 'prepare' || maskBusy
            ? 'Updating the live preview…'
            : editorDocument.showingResult
              ? 'Export ready.'
              : 'Preview updates as you type.'
        }
        onContentChange={actions.setDraftContent}
        onContentBlur={actions.blurDraft}
        onSubmit={submitDraft}
        onContentInvalid={cancelDraftCommit}
        inputRef={inputRef}
      />
      {!editorDocument.showingResult && (
        <>
          <div {...stylex.props(styles.edgeControl, styles.edgeControlLeft)}>
            <button
              ref={maskTriggerRef}
              type="button"
              aria-label="Mask selection"
              aria-controls="mask-panel"
              aria-expanded={maskOpen}
              {...stylex.props(ui.button, ui.focusVisible, styles.edgeButton)}
              onClick={() => {
                actions.setPatternSettingsOpen(false)
                actions.setMaskOpen(true)
              }}
            >
              Mask selection
            </button>
          </div>
          <div {...stylex.props(styles.edgeControl, styles.edgeControlRight)}>
            <button
              ref={patternSettingsTriggerRef}
              type="button"
              aria-label="Pattern settings"
              aria-controls="pattern-settings-panel"
              aria-expanded={patternSettingsOpen}
              {...stylex.props(ui.button, ui.focusVisible, styles.edgeButton, styles.edgeButtonRight)}
              onClick={() => {
                actions.setMaskOpen(false)
                actions.setPatternSettingsOpen(true)
              }}
            >
              Pattern settings
            </button>
          </div>
        </>
      )}
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
            {({ close, closeButtonRef, isDialog }) => (
              <MaskPanel
                mask={maskSelection}
                search={iconSearch}
                onSearch={iconSearch.handleSearchClick}
                onClose={close}
                closeButtonRef={closeButtonRef}
                isDialog={isDialog}
              />
            )}
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
          regionOnly={!contentSchema.safeParse(editorDocument.content).success}
          placementInvalid={editorDocument.field === 'placement'}
          placement={editorDocument.placement}
          bestPlacement={editorDocument.prepared?.bestPlacement ?? null}
          modules={editorDocument.prepared?.qrMetadata.totalModules ?? 0}
          invalid={!!editorDocument.error}
          busy={busy}
          current={current}
          onMove={actions.movePlacement}
          onPlacementGestureStart={cancelAssembly}
          onMaskFillCommit={(mask) => actions.replaceMask(new File([mask], TEXT_MASK_FILENAME, { type: 'image/png' }))}
          onReturnToEditing={() => actions.setResultView(false)}
          onExportRaster={exportRaster}
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
            {({ close, closeButtonRef, isDialog }) => (
              <PatternSettings
                settings={editorDocument.settings}
                onSettings={actions.patchSettings}
                onClose={close}
                closeButtonRef={closeButtonRef}
                isDialog={isDialog}
              />
            )}
          </ResponsiveEditorPanel>
        </div>
      </div>
      <IconGallery
        open={iconSearch.galleryMode}
        query={maskText.trim()}
        total={iconSearch.total}
        items={iconSearch.results}
        loading={iconSearch.loading}
        selectedIconId={maskSelection.selectedIconId}
        onSelect={handleGallerySelect}
        onClose={iconSearch.closeGallery}
      />
    </main>
  )
}
