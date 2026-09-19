'use client'
import dynamic from 'next/dynamic'
import IconGallery from './IconGallery'
import MaskPreviewCanvas from './MaskPreviewCanvas'
import ResultPanel from './ResultPanel'
import type { IconItem } from '../../lib/editor/text-mask'
import type { Result } from '../../lib/editor/state'
import type { Placement } from '../../lib/editor/schema'
const Canvas = dynamic(() => import('./Canvas'), { ssr: false })

export interface MaskPreviewView {
  effectiveMask: string
  family: string
  isBlank: boolean
  isIconMode: boolean
  iconResults: IconItem[]
  selectedIconId: string | null
}

export interface GalleryView {
  query: string
  total: number
  items: IconItem[]
  selectedIconId: string | null
  onSelect: (index: number) => void
  onClose: () => void
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
  gallery: GalleryView
  galleryMode: boolean
  onMove: (box: Placement) => void
  onReturnToEditing: () => void
}

/** Right-hand preview pane: result, step-2 mask preview or gallery, or the placement canvas. */
export default function PreviewPanel({ step, showingResult, dimensions, result, artifacts, previews, posterUrl, placement, modules, invalid, maskPreview, gallery, galleryMode, onMove, onReturnToEditing }: PreviewPanelProps) {
  return <div className="preview-panel"><div className="preview-heading"><div><span className="eyebrow">{showingResult ? 'FINISHED POSTER' : step === 2 ? 'MASK PREVIEW' : 'PREVIEW'}</span><h2>{showingResult ? 'Ready for the real world.' : step === 2 ? 'Preview your mask region.' : 'Place your QR inside the region.'}</h2></div>{dimensions && <span className="badge">{dimensions.width} × {dimensions.height}</span>}</div>
    {showingResult && result ? <ResultPanel result={result} artifacts={artifacts} onReturnToEditing={onReturnToEditing} /> : step === 2 ? galleryMode ? <IconGallery query={gallery.query} total={gallery.total} items={gallery.items} selectedIconId={gallery.selectedIconId} onSelect={gallery.onSelect} onClose={gallery.onClose} /> : <MaskPreviewCanvas effectiveMask={maskPreview.effectiveMask} family={maskPreview.family} isBlank={maskPreview.isBlank} isIconMode={maskPreview.isIconMode} iconResults={maskPreview.iconResults} selectedIconId={maskPreview.selectedIconId} galleryMode={galleryMode} /> : dimensions && placement && posterUrl ? <Canvas mask={previews['region.png'] ?? ''} poster={posterUrl} overlay={previews['mask.png'] ?? ''} qr={previews['qr.png'] ?? ''} width={dimensions.width} height={dimensions.height} placement={placement} modules={modules} onChange={onMove} invalid={invalid} /> : <div className="empty"><div className="empty-icon">＋</div><h3>Your poster goes here</h3><p>Pick a canvas and place your QR.</p></div>}
    <div className="workspace-note"><span>Original dimensions. Precise placement.</span><span>Pixels outside your region stay untouched.</span></div>
  </div>
}
