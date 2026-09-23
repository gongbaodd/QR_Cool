'use client'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { Result } from '@/lib/editor/state'
import type { Placement, Settings } from '@/lib/editor/schema'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const Canvas = dynamic(() => import('./Canvas'), { ssr: false })
const ResultPanel = dynamic(() => import('./ResultPanel'))
const MarkerDialog = dynamic(() => import('./MarkerDialog'))
const styles = stylex.create({
  panel: { minWidth: 0, paddingBlock: 24, paddingInline: 24 },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  title: { margin: '6px 0', fontSize: 26, fontWeight: 400, '@media (max-width: 900px)': { fontSize: 22 } },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', '@media (min-width: 901px)': { display: 'none' } },
  badge: {
    whiteSpace: 'nowrap',
    paddingBlock: 5,
    paddingInline: 10,
    fontSize: 14,
    backgroundColor: tokens.highlight,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    boxShadow: tokens.shadow,
  },
  empty: {
    minHeight: 560,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 10,
    padding: 24,
    textAlign: 'center',
    backgroundColor: tokens.card,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '@media (max-width: 900px)': { minHeight: 320 },
  },
  emptyIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 72,
    height: 72,
    fontSize: 32,
    backgroundColor: tokens.highlight,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: '50%',
    boxShadow: tokens.shadow,
  },
  emptyTitle: { fontSize: 23, fontWeight: 400, margin: 0 },
  emptyText: { color: tokens.muted, margin: 0 },
  loading: {
    minHeight: 560,
    display: 'grid',
    placeItems: 'center',
    color: tokens.muted,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    '@media (max-width: 900px)': { minHeight: 320 },
  },
  canvas: { minWidth: 0 },
  note: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    fontSize: 14,
    color: tokens.muted,
    '@media (max-width: 600px)': { flexDirection: 'column', gap: 2 },
  },
  veil: {
    marginBottom: 10,
    padding: 8,
    color: tokens.green,
    backgroundColor: tokens.highlightSoft,
    borderRadius: tokens.sketch,
  },
  exportControls: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' },
})

export default function PreviewPanel({
  showingResult,
  dimensions,
  result,
  artifacts,
  previews,
  posterUrl,
  placement,
  modules,
  invalid,
  busy,
  error,
  current,
  onMove,
  onReturnToEditing,
  onMaskOpen,
  onDetailsOpen,
  maskOpen,
  detailsOpen,
  maskTriggerRef,
  detailsTriggerRef,
  pattern,
  onAssemble,
  assembleBusy,
  ready: externallyReady,
  canAssemble,
}: {
  showingResult: boolean
  dimensions: { width: number; height: number } | null
  result: Result | null
  artifacts: Record<string, string>
  previews: Record<string, string>
  posterUrl: string
  placement: Placement | null
  modules: number
  invalid: boolean
  busy: boolean
  error: string | null
  current: boolean
  onMove: (box: Placement) => void
  onReturnToEditing: () => void
  onMaskOpen: () => void
  onDetailsOpen: () => void
  maskOpen: boolean
  detailsOpen: boolean
  maskTriggerRef: RefObject<HTMLButtonElement | null>
  detailsTriggerRef: RefObject<HTMLButtonElement | null>
  pattern: {
    content: string
    settings: Settings
    onSettings: (patch: Partial<Settings>) => void
    onNewSeed: () => void
  }
  onAssemble: () => void
  assembleBusy: boolean
  ready: boolean
  canAssemble: boolean
}) {
  const [markerDialog, setMarkerDialog] = useState<'finder' | 'sub' | null>(null)
  const ready = externallyReady && !!dimensions && !!placement && !!posterUrl && current
  return (
    <section {...stylex.props(styles.panel)} aria-labelledby="preview-title" aria-busy={busy}>
      <div {...stylex.props(styles.heading)}>
        <div>
          <span {...stylex.props(ui.eyebrow)}>PREVIEW CANVAS</span>
          <h2 id="preview-title" {...stylex.props(styles.title)}>
            {showingResult ? 'Ready for the real world.' : 'Live poster preview'}
          </h2>
        </div>
        <div {...stylex.props(styles.actions)}>
          <button
            ref={maskTriggerRef}
            {...stylex.props(ui.button)}
            type="button"
            aria-controls="mask-panel"
            aria-expanded={maskOpen}
            onClick={onMaskOpen}
          >
            Mask
          </button>
          <button
            ref={detailsTriggerRef}
            {...stylex.props(ui.button)}
            type="button"
            aria-controls="qr-details-panel"
            aria-expanded={detailsOpen}
            onClick={onDetailsOpen}
          >
            QR details
          </button>
        </div>
        {dimensions && (
          <span {...stylex.props(styles.badge)}>
            {dimensions.width} × {dimensions.height}
          </span>
        )}
      </div>
      {busy && (
        <p {...stylex.props(styles.veil)} role="status">
          Updating preview…
        </p>
      )}
      {showingResult && result ? (
        <ResultPanel result={result} artifacts={artifacts} onReturnToEditing={onReturnToEditing} />
      ) : ready ? (
        <div {...stylex.props(styles.canvas)}>
          <Canvas
            mask={previews['region.png'] ?? ''}
            poster={posterUrl}
            overlay={previews['mask.png'] ?? ''}
            qr={previews['qr.png'] ?? ''}
            width={dimensions!.width}
            height={dimensions!.height}
            placement={placement!}
            modules={modules}
            onChange={onMove}
            invalid={invalid}
            onMarkerClick={setMarkerDialog}
          />
          <div {...stylex.props(styles.exportControls)}>
            <button
              {...stylex.props(ui.button, ui.primary)}
              type="button"
              disabled={!ready || !canAssemble || assembleBusy}
              onClick={onAssemble}
            >
              {assembleBusy ? 'Assembling…' : 'Assemble poster'}
            </button>
            <span {...stylex.props(ui.hint)}>Export is optional; editing stays reactive.</span>
          </div>
        </div>
      ) : (
        <div {...stylex.props(busy ? styles.loading : styles.empty)}>
          {busy ? (
            <span>Preparing a live canvas…</span>
          ) : (
            <>
              <div {...stylex.props(styles.emptyIcon)}>＋</div>
              <h3 {...stylex.props(styles.emptyTitle)}>Your poster goes here</h3>
              <p {...stylex.props(styles.emptyText)}>Enter text or a URL, then click Generate to start the preview.</p>
            </>
          )}
        </div>
      )}
      {error && (
        <p {...stylex.props(ui.error)} role="alert">
          {error}
        </p>
      )}
      {pattern && markerDialog && (
        <MarkerDialog
          kind={markerDialog}
          settings={pattern.settings}
          onSettings={pattern.onSettings}
          onClose={() => setMarkerDialog(null)}
        />
      )}
      <div {...stylex.props(styles.note)}>
        <span>Original dimensions. Precise placement.</span>
        <span>Pixels outside your region stay untouched.</span>
      </div>
    </section>
  )
}
