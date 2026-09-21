'use client'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { IconItem } from '../../lib/editor/text-mask'
import type { Result } from '../../lib/editor/state'
import type { Placement, Settings } from '../../lib/editor/schema'
import { tokens } from '../../styles/tokens.stylex'
import { ui } from '../../styles/ui.stylex'

const styles = stylex.create({
  panel: {
    minWidth: 0,
    paddingBlock: 32,
    paddingInline: 38,
    '@media (max-width: 1000px)': {
      paddingBlock: 24,
      paddingInline: 20,
    },
    '@media (max-width: 700px)': {
      order: -1,
      paddingBlock: 20,
      paddingInline: 16,
    },
  },
  /** Step 2 centers the mask preview in the full-height pane. */
  panelStep2: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 145px)',
    '@media (max-width: 700px)': {
      minHeight: 'auto',
    },
  },
  heading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 24,
    '@media (max-width: 700px)': {
      marginBottom: 15,
    },
  },
  headingTitle: {
    fontSize: 26,
    fontWeight: 400,
    letterSpacing: 0,
    margin: '8px 0',
    '@media (max-width: 1000px)': {
      fontSize: 22,
    },
    '@media (max-width: 700px)': {
      fontSize: 20,
    },
  },
  eyebrowMarked: {
    paddingInline: 6,
    boxShadow: `0 -8px ${tokens.highlight} inset`,
  },
  badge: {
    whiteSpace: 'nowrap',
    paddingBlock: 6,
    paddingInline: 14,
    fontSize: 14,
    backgroundColor: tokens.highlight,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    boxShadow: tokens.shadow,
    transform: 'rotate(1deg)',
  },
  empty: {
    minHeight: 580,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    textAlign: 'center',
    backgroundColor: tokens.card,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '@media (max-width: 700px)': {
      minHeight: 250,
    },
  },
  emptyIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 78,
    height: 78,
    fontSize: 34,
    backgroundColor: tokens.highlight,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: '50%',
    boxShadow: tokens.shadow,
    transform: 'rotate(-5deg)',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 400,
    margin: '22px 0 0',
  },
  emptyText: {
    fontSize: 17,
    color: tokens.muted,
    '@media (max-width: 700px)': {
      marginBottom: 24,
    },
  },
  adjustLayout: {
    display: 'flex',
    gap: 20,
    alignItems: 'flex-start',
    '@media (max-width: 1200px)': {
      flexDirection: 'column',
    },
  },
  canvasCell: {
    flex: '1 1 0',
    minWidth: 0,
  },
  settingsCell: {
    flex: '0 0 360px',
    width: 360,
    maxWidth: '100%',
    minWidth: 0,
    '@media (max-width: 1200px)': {
      flex: '1 1 auto',
      width: '100%',
    },
  },
  note: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 20,
    fontSize: 14,
    color: tokens.muted,
    '@media (max-width: 700px)': {
      flexDirection: 'column',
      gap: 3,
    },
  },
  /** Stable-size stand-in for the loading mask preview: same canvas geometry. */
  maskPreviewPlaceholder: {
    width: '100%',
    maxWidth: 560,
    aspectRatio: '1 / 1',
    backgroundColor: 'black',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchAlt,
  },
})

// Step panels load on demand: step 1 never downloads the mask preview, pattern
// settings, or result UI (doc/plan/modern-web-optimization.md 2.1). The canvas
// and the mask preview touch canvas APIs on mount, so both skip SSR; the next
// step's placeholder keeps the canvas' aspect ratio so nothing jumps.
const Canvas = dynamic(() => import('./Canvas'), { ssr: false })
const MaskPreviewCanvas = dynamic(() => import('./MaskPreviewCanvas'), {
  ssr: false,
  loading: () => <div {...stylex.props(styles.maskPreviewPlaceholder)} aria-hidden="true" />,
})
const ResultPanel = dynamic(() => import('./ResultPanel'))
const PatternSettings = dynamic(() => import('./PatternSettings'))
const MarkerDialog = dynamic(() => import('./MarkerDialog'))

export interface MaskPreviewView {
  effectiveMask: string
  family: string
  isBlank: boolean
  isIconMode: boolean
  iconResults: IconItem[]
  selectedIconId: string | null
}

export interface PreviewPanelProps {
  step: number
  showingResult: boolean
  dimensions: { width: number; height: number } | null
  result: Result | null
  artifacts: Record<string, string>
  previews: Record<string, string>
  posterUrl: string
  placement: Placement | null
  modules: number
  invalid: boolean
  maskPreview: MaskPreviewView
  onMove: (box: Placement) => void
  onReturnToEditing: () => void
  onFillCommit?: ((preview: HTMLCanvasElement) => void) | undefined
  pattern?: {
    content: string
    settings: Settings
    onSettings: (patch: Partial<Settings>) => void
    onNewSeed: () => void
  } | null
}

/** Right-hand preview pane: result, step-2 mask preview or gallery, or the placement canvas. */
export default function PreviewPanel({
  step,
  showingResult,
  dimensions,
  result,
  artifacts,
  previews,
  posterUrl,
  placement,
  modules,
  invalid,
  maskPreview,
  onMove,
  onReturnToEditing,
  onFillCommit,
  pattern,
}: PreviewPanelProps) {
  // Transient step-3 UI state: which marker dialog the canvas opened. It stays
  // out of the editor reducer on purpose.
  const [markerDialog, setMarkerDialog] = useState<'finder' | 'sub' | null>(null)
  return (
    <div {...stylex.props(styles.panel, step === 2 && styles.panelStep2)}>
      <div {...stylex.props(styles.heading)}>
        <div>
          <span {...stylex.props(ui.eyebrow, styles.eyebrowMarked)}>
            {showingResult ? 'FINISHED POSTER' : step === 2 ? 'MASK PREVIEW' : 'PREVIEW'}
          </span>
          <h2 {...stylex.props(styles.headingTitle)}>
            {showingResult
              ? 'Ready for the real world.'
              : step === 2
                ? 'Preview your mask region.'
                : 'Place your QR inside the region.'}
          </h2>
        </div>
        {dimensions && (
          <span {...stylex.props(styles.badge)}>
            {dimensions.width} × {dimensions.height}
          </span>
        )}
      </div>
      {showingResult && result ? (
        <ResultPanel result={result} artifacts={artifacts} onReturnToEditing={onReturnToEditing} />
      ) : step === 2 ? (
        <MaskPreviewCanvas
          effectiveMask={maskPreview.effectiveMask}
          family={maskPreview.family}
          isBlank={maskPreview.isBlank}
          isIconMode={maskPreview.isIconMode}
          iconResults={maskPreview.iconResults}
          selectedIconId={maskPreview.selectedIconId}
          onFillCommit={onFillCommit}
        />
      ) : dimensions && placement && posterUrl ? (
        <div {...stylex.props(styles.adjustLayout)}>
          <div {...stylex.props(styles.canvasCell)}>
            <Canvas
              mask={previews['region.png'] ?? ''}
              poster={posterUrl}
              overlay={previews['mask.png'] ?? ''}
              qr={previews['qr.png'] ?? ''}
              width={dimensions.width}
              height={dimensions.height}
              placement={placement}
              modules={modules}
              onChange={onMove}
              invalid={invalid}
              onMarkerClick={setMarkerDialog}
            />
          </div>
          {pattern && step === 3 && !showingResult && (
            <div {...stylex.props(styles.settingsCell)}>
              <PatternSettings
                content={pattern.content}
                settings={pattern.settings}
                onSettings={pattern.onSettings}
                onNewSeed={pattern.onNewSeed}
              />
            </div>
          )}
        </div>
      ) : (
        <div {...stylex.props(styles.empty)}>
          <div {...stylex.props(styles.emptyIcon)}>＋</div>
          <h3 {...stylex.props(styles.emptyTitle)}>Your poster goes here</h3>
          <p {...stylex.props(styles.emptyText)}>Pick a canvas and place your QR.</p>
        </div>
      )}
      {pattern && step === 3 && !showingResult && (
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
    </div>
  )
}
