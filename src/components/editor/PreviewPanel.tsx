'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { toast } from 'react-toastify'
import type Konva from 'konva'
import type { Result } from '@/lib/editor/state'
import { canonicalPlacement, fitsMask } from '@/lib/editor/schema'
import type { Placement, PlacementInput, Settings } from '@/lib/editor/schema'
import { canonicalizeRotation } from '@/core/rotate'
import { fillMaskImageData } from '@/lib/editor/mask-fill'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const ResultPanel = dynamic(() => import('./ResultPanel'))
const MarkerDialog = dynamic(() => import('./MarkerDialog'))
const styles = stylex.create({
  panel: { minWidth: 0, paddingBlock: 24, paddingInline: 24 },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
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
  regionPreview: {
    minHeight: 720,
    maxHeight: 820,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '@media (max-width: 900px)': { minHeight: 480, maxHeight: 560 },
  },
  regionContent: {
    flex: 1,
    display: 'grid',
    placeItems: 'center',
    width: '100%',
    boxSizing: 'border-box',
    padding: 24,
  },
  regionCaption: { margin: '10px 0 0', color: tokens.muted, textAlign: 'center' },
  previewCanvas: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 560,
    objectFit: 'contain',
    backgroundColor: '#fff',
    backgroundImage:
      'linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%), linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%)',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
  },
  area: {
    overflow: 'auto',
    maxHeight: 820,
    touchAction: 'pan-x pan-y',
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '@media (max-width: 700px)': { maxHeight: 560 },
  },
  tools: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    padding: 12,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 15,
    backgroundColor: tokens.highlightSoft,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 700px)': { gap: 8 },
  },
  scroll: {
    padding: 18,
    backgroundColor: tokens.paper,
    ':focus-visible': {
      outlineWidth: 3,
      outlineStyle: 'dashed',
      outlineColor: tokens.green,
      outlineOffset: 3,
      borderRadius: 6,
    },
  },
  stageFrame: {
    width: 'fit-content',
    marginInline: 'auto',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    boxShadow: '0 8px 28px #163c2820',
    backgroundColor: '#fff',
    backgroundImage:
      'linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%), linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%)',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
  },
  footer: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: 12,
    paddingInline: 14,
    fontSize: 14,
    color: tokens.muted,
    backgroundColor: tokens.card,
    borderTopWidth: 2,
    borderTopStyle: 'solid',
    borderTopColor: tokens.ink,
    '@media (max-width: 1000px)': { flexWrap: 'wrap' },
  },
  nudges: { display: 'flex', gap: 8 },
  nudge: { minWidth: 42, minHeight: 42, paddingBlock: 4, paddingInline: 8 },
  fillToolbar: {
    display: 'flex',
    alignItems: 'center',
    flex: '1 1 360px',
    justifyContent: 'space-between',
    gap: 12,
  },
  note: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    fontSize: 14,
    color: tokens.muted,
    '@media (max-width: 600px)': { flexDirection: 'column', gap: 2 },
  },
  exportControls: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' },
})

function useImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement>()
  useEffect(() => {
    const next = new window.Image()
    let live = true
    next.onload = () => {
      if (live) setImage(next)
    }
    next.src = url
    return () => {
      live = false
      next.onload = null
    }
  }, [url])
  return image
}

function SourceRegionPreview({
  poster,
  maskCanvas,
  revision,
  fillActive,
  fillReady,
  onFillAt,
}: {
  poster: string
  maskCanvas: HTMLCanvasElement | null
  revision: number
  fillActive: boolean
  fillReady: boolean
  onFillAt: (x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const posterImage = useImage(poster)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !posterImage || !maskCanvas) return
    const width = posterImage.naturalWidth
    const height = posterImage.naturalHeight
    if (!width || !height || maskCanvas.width !== width || maskCanvas.height !== height) return
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(posterImage, 0, 0)
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!maskContext) return
    const pixels = maskContext.getImageData(0, 0, width, height).data
    const overlay = context.createImageData(width, height)
    for (let pixel = 0; pixel < width * height; pixel++) {
      const offset = pixel * 4
      const brightness = Math.round(
        (299 * pixels[offset]! + 587 * pixels[offset + 1]! + 114 * pixels[offset + 2]!) / 1000,
      )
      if (pixels[offset + 3]! < 128 || brightness < 128) continue
      overlay.data[offset] = 75
      overlay.data[offset + 1] = 224
      overlay.data[offset + 2] = 182
      overlay.data[offset + 3] = 95
    }
    const overlayCanvas = document.createElement('canvas')
    overlayCanvas.width = width
    overlayCanvas.height = height
    overlayCanvas.getContext('2d')?.putImageData(overlay, 0, 0)
    context.drawImage(overlayCanvas, 0, 0)
  }, [maskCanvas, posterImage, revision])

  return (
    <canvas
      ref={canvasRef}
      {...stylex.props(styles.previewCanvas)}
      role="img"
      aria-label={
        fillActive
          ? 'Poster with selected region highlighted; click an enclosed area to fill it'
          : 'Poster with selected region highlighted'
      }
      style={fillActive && fillReady ? { cursor: 'crosshair' } : undefined}
      onClick={(event) => {
        if (!fillActive || !fillReady || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        onFillAt(
          Math.floor(((event.clientX - rect.left) / rect.width) * canvasRef.current.width),
          Math.floor(((event.clientY - rect.top) / rect.height) * canvasRef.current.height),
        )
      }}
    />
  )
}

function notifyFill(message: string, kind: 'error' | 'warning' | 'success') {
  const toastId = 'editor-region-fill'
  const options = {
    toastId,
    autoClose: kind === 'error' ? false : 3500,
    role: kind === 'error' ? ('alert' as const) : ('status' as const),
    ariaLabel: `Region fill ${kind}: ${message}`,
  }
  if (toast.isActive(toastId)) {
    toast.update(toastId, { render: message, type: kind, isLoading: false, ...options })
  } else {
    toast[kind](message, options)
  }
}

function PosterCanvas({
  poster,
  overlay,
  mask,
  qr,
  width,
  height,
  placement,
  modules,
  onChange,
  invalid,
  onMarkerClick,
  fillActive,
  fillReady,
  onFillAt,
  toolbar,
}: {
  poster: string
  overlay: string
  mask: string
  qr: string
  width: number
  height: number
  placement: Placement
  modules: number
  onChange: (box: Placement) => void
  invalid: boolean
  onMarkerClick?: (kind: 'finder' | 'sub') => void
  fillActive: boolean
  fillReady: boolean
  onFillAt: (x: number, y: number) => void
  toolbar: ReactNode
}) {
  const [konva, setKonva] = useState<typeof import('react-konva') | null>(null)
  useEffect(() => {
    let live = true
    void import('react-konva').then((module) => {
      if (live) setKonva(module)
    })
    return () => {
      live = false
    }
  }, [])
  const maskImage = useImage(mask)
  const [maskData, setMaskData] = useState<Uint8Array>()
  useEffect(() => {
    if (!maskImage) return
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.drawImage(maskImage, 0, 0)
    const pixels = context.getImageData(0, 0, width, height).data
    setMaskData(Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4]!))
  }, [maskImage, width, height])
  const posterImage = useImage(poster)
  const overlayImage = useImage(overlay)
  const qrImage = useImage(qr)
  const wrapper = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const node = useRef<Konva.Group>(null)
  const border = useRef<Konva.Rect>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const stage = useRef<Konva.Stage>(null)
  const [viewport, setViewport] = useState(800)
  const [hoverMarker, setHoverMarker] = useState<string | null>(null)
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setViewport(entries[0]!.contentRect.width))
    if (wrapper.current) observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (node.current) transformer.current?.nodes([node.current])
  }, [qrImage])
  const fit = Math.min((viewport - 32) / width, 640 / height, 1)
  const scale = fit
  const pitch = modules ? placement.size / modules : 0
  const margin = pitch
  const displaySize = placement.size - 2 * margin
  const n = modules - 4
  const q = 2
  const version = modules ? Math.floor((modules - 21) / 4) : 0
  const markerHits: { id: string; kind: 'finder' | 'sub'; x: number; y: number; size: number }[] = modules
    ? [
        { id: 'tl', kind: 'finder', x: q * pitch, y: q * pitch, size: 7 * pitch },
        { id: 'tr', kind: 'finder', x: (q + n - 7) * pitch, y: q * pitch, size: 7 * pitch },
        { id: 'bl', kind: 'finder', x: q * pitch, y: (q + n - 7) * pitch, size: 7 * pitch },
        ...(version >= 2
          ? [{ id: 'br', kind: 'sub', x: (q + n - 9) * pitch, y: (q + n - 9) * pitch, size: 5 * pitch } as const]
          : []),
      ]
    : []
  useEffect(() => {
    const container = stage.current?.container()
    if (!container || !modules || !pitch) return
    const n = modules - 4
    const q = 2
    const rects: { id: string; kind: string; x: number; y: number; size: number }[] = [
      { id: 'tl', kind: 'finder', x: q * pitch, y: q * pitch, size: 7 * pitch },
      { id: 'tr', kind: 'finder', x: (q + n - 7) * pitch, y: q * pitch, size: 7 * pitch },
      { id: 'bl', kind: 'finder', x: q * pitch, y: (q + n - 7) * pitch, size: 7 * pitch },
      ...(Math.floor((modules - 21) / 4) >= 2
        ? [{ id: 'br', kind: 'sub', x: (q + n - 9) * pitch, y: (q + n - 9) * pitch, size: 5 * pitch }]
        : []),
    ].map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      x: (placement.x + hit.x) * scale,
      y: (placement.y + hit.y) * scale,
      size: hit.size * scale,
    }))
    container.dataset.markerTargets = JSON.stringify(rects)
  }, [modules, pitch, placement.x, placement.y, scale])
  function nudge(dx: number, dy: number) {
    onChange({ ...placement, x: Math.max(0, placement.x + dx), y: Math.max(0, placement.y + dy) })
  }
  function liveBox(): PlacementInput {
    const current = node.current!
    const size = current.width() * current.scaleX()
    return {
      x: current.x() - size / 2,
      y: current.y() - size / 2,
      size,
      rotation: canonicalizeRotation(current.rotation()),
    }
  }
  if (!konva)
    return (
      <div {...stylex.props(styles.loading)} role="status">
        Loading poster canvas…
      </div>
    )
  const { Group, Stage, Layer, Image: CanvasImage, Rect, Transformer } = konva
  return (
    <div {...stylex.props(styles.area)} ref={wrapper}>
      {toolbar && <div {...stylex.props(styles.tools)}>{toolbar}</div>}
      <div
        {...stylex.props(styles.scroll)}
        ref={scroll}
        tabIndex={0}
        role="group"
        aria-label="Poster canvas. Arrow keys move the QR; Shift moves ten pixels."
        onKeyDown={(event) => {
          const delta = event.shiftKey ? 10 : 1
          const steps: Record<string, number[]> = {
            ArrowLeft: [-delta, 0],
            ArrowRight: [delta, 0],
            ArrowUp: [0, -delta],
            ArrowDown: [0, delta],
          }
          const step = steps[event.key]
          if (step) {
            event.preventDefault()
            nudge(step[0]!, step[1]!)
          }
        }}
      >
        <div {...stylex.props(styles.stageFrame)}>
          <Stage
            ref={stage}
            width={width * scale}
            height={height * scale}
            scaleX={scale}
            scaleY={scale}
            onClick={(event) => {
              if (!fillActive || !fillReady || event.target !== event.target.getStage()) return
              const pointer = stage.current?.getPointerPosition()
              if (!pointer || scale <= 0) return
              onFillAt(Math.floor(pointer.x / scale), Math.floor(pointer.y / scale))
            }}
            onTap={(event) => {
              if (!fillActive || !fillReady || event.target !== event.target.getStage()) return
              const pointer = stage.current?.getPointerPosition()
              if (!pointer || scale <= 0) return
              onFillAt(Math.floor(pointer.x / scale), Math.floor(pointer.y / scale))
            }}
          >
            <Layer>
              <CanvasImage image={posterImage} width={width} height={height} listening={false} />
              <CanvasImage image={overlayImage} width={width} height={height} listening={false} />
              <Group
                ref={node}
                x={placement.x + placement.size / 2}
                y={placement.y + placement.size / 2}
                offsetX={placement.size / 2}
                offsetY={placement.size / 2}
                width={placement.size}
                height={placement.size}
                rotation={placement.rotation}
                draggable={!fillActive}
                dragDistance={1}
                onDragStart={() => setHoverMarker(null)}
                onDragMove={(event) => {
                  const box = canonicalPlacement(
                    {
                      ...placement,
                      x: event.target.x() - placement.size / 2,
                      y: event.target.y() - placement.size / 2,
                    },
                    modules,
                  )
                  border.current?.stroke(maskData && !fitsMask(maskData, width, height, box) ? '#dd3748' : '#087f67')
                }}
                onDragEnd={(event) =>
                  onChange(
                    canonicalPlacement(
                      {
                        ...placement,
                        x: event.target.x() - placement.size / 2,
                        y: event.target.y() - placement.size / 2,
                      },
                      modules,
                    ),
                  )
                }
                onTransform={() => {
                  const box = canonicalPlacement(liveBox(), modules)
                  border.current?.stroke(maskData && !fitsMask(maskData, width, height, box) ? '#dd3748' : '#087f67')
                }}
                onTransformEnd={() => {
                  const current = node.current!
                  const box = canonicalPlacement(liveBox(), modules)
                  current.scale({ x: 1, y: 1 })
                  current.width(box.size)
                  current.height(box.size)
                  current.offsetX(box.size / 2)
                  current.offsetY(box.size / 2)
                  current.rotation(box.rotation)
                  current.x(box.x + box.size / 2)
                  current.y(box.y + box.size / 2)
                  onChange(box)
                }}
              >
                <Rect width={placement.size} height={placement.size} fill="transparent" />
                <CanvasImage
                  image={qrImage}
                  x={margin}
                  y={margin}
                  width={displaySize}
                  height={displaySize}
                  crop={{ x: margin, y: margin, width: displaySize, height: displaySize }}
                  imageSmoothingEnabled={false}
                />
                {markerHits.map((hit) => {
                  const hovered = hoverMarker === hit.id
                  return (
                    <Rect
                      key={hit.id}
                      x={hit.x}
                      y={hit.y}
                      width={hit.size}
                      height={hit.size}
                      fill="#087f67"
                      opacity={hovered ? 0.3 : 0.06}
                      {...(hovered ? { stroke: 'rgba(35, 39, 43, 0.8)', strokeWidth: 2 / scale } : { strokeWidth: 0 })}
                      listening={Boolean(onMarkerClick) && !fillActive}
                      onMouseEnter={() => {
                        setHoverMarker(hit.id)
                        if (scroll.current) scroll.current.style.cursor = 'pointer'
                      }}
                      onMouseLeave={() => {
                        setHoverMarker((current) => (current === hit.id ? null : current))
                        if (scroll.current) scroll.current.style.cursor = ''
                      }}
                      onTap={() => onMarkerClick?.(hit.kind)}
                      onClick={(event) => {
                        event.cancelBubble = true
                        onMarkerClick?.(hit.kind)
                      }}
                    />
                  )
                })}
                <Rect
                  ref={border}
                  width={placement.size}
                  height={placement.size}
                  stroke={invalid ? '#dd3748' : '#087f67'}
                  strokeWidth={2 / scale}
                  listening={false}
                />
              </Group>
              <Transformer
                ref={transformer}
                rotateEnabled
                flipEnabled={false}
                keepRatio
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                anchorSize={14}
                anchorCornerRadius={3}
                borderStroke={invalid ? '#dd3748' : '#087f67'}
                visible={!fillActive}
                listening={!fillActive}
                boundBoxFunc={(old, next) => {
                  const radians = ((node.current?.rotation() ?? 0) * Math.PI) / 180
                  const factor = Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians))
                  return next.width < modules * 4 * scale * factor ? old : next
                }}
              />
            </Layer>
          </Stage>
        </div>
      </div>
      <div {...stylex.props(styles.footer)}>
        <span>
          {fillActive ? 'Click the poster outside the QR to fill an enclosed area.' : 'Drag, resize, or rotate the QR.'}
        </span>
        <div {...stylex.props(styles.nudges)} aria-label="Touch position controls">
          <button {...stylex.props(ui.button, styles.nudge)} aria-label="Move left" onClick={() => nudge(-1, 0)}>
            ←
          </button>
          <button
            {...stylex.props(ui.button, styles.nudge, ui.buttonAlt)}
            aria-label="Move up"
            onClick={() => nudge(0, -1)}
          >
            ↑
          </button>
          <button {...stylex.props(ui.button, styles.nudge)} aria-label="Move down" onClick={() => nudge(0, 1)}>
            ↓
          </button>
          <button
            {...stylex.props(ui.button, styles.nudge, ui.buttonAlt)}
            aria-label="Move right"
            onClick={() => nudge(1, 0)}
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PreviewPanel({
  showingResult,
  dimensions,
  result,
  artifacts,
  previews,
  posterUrl,
  sourceMaskUrl,
  regionOnly,
  placementInvalid,
  placement,
  modules,
  invalid,
  busy,
  error,
  current,
  onMove,
  onMaskFillCommit,
  onReturnToEditing,
  onMaskOpen,
  onPatternSettingsOpen,
  maskOpen,
  patternSettingsOpen,
  maskTriggerRef,
  patternSettingsTriggerRef,
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
  sourceMaskUrl: string
  regionOnly: boolean
  placementInvalid: boolean
  placement: Placement | null
  modules: number
  invalid: boolean
  busy: boolean
  error: string | null
  current: boolean
  onMove: (box: Placement) => void
  onMaskFillCommit: (mask: Blob) => void
  onReturnToEditing: () => void
  onMaskOpen: () => void
  onPatternSettingsOpen: () => void
  maskOpen: boolean
  patternSettingsOpen: boolean
  maskTriggerRef: RefObject<HTMLButtonElement | null>
  patternSettingsTriggerRef: RefObject<HTMLButtonElement | null>
  pattern: {
    settings: Settings
    onSettings: (patch: Partial<Settings>) => void
  }
  onAssemble: () => void
  assembleBusy: boolean
  ready: boolean
  canAssemble: boolean
}) {
  const [markerDialog, setMarkerDialog] = useState<'finder' | 'sub' | null>(null)
  const [fillActive, setFillActive] = useState(false)
  const [sourceMaskCanvas, setSourceMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [sourceMaskReady, setSourceMaskReady] = useState(false)
  const [fillPending, setFillPending] = useState(false)
  const fillPendingRef = useRef(false)
  const [maskRevision, setMaskRevision] = useState(0)
  const [showFilledRegion, setShowFilledRegion] = useState(false)
  const sourceMaskImageData = useRef<ImageData | null>(null)
  const fillGeneration = useRef(0)
  const fillNotificationKind = useRef<'error' | 'warning' | 'success' | 'progress' | null>(null)
  useEffect(() => {
    fillGeneration.current += 1
    const generation = fillGeneration.current
    sourceMaskImageData.current = null
    setSourceMaskCanvas(null)
    setSourceMaskReady(false)
    setFillPending(false)
    fillPendingRef.current = false
    if (!sourceMaskUrl || !posterUrl) return
    let live = true
    const maskImage = new window.Image()
    const posterImage = new window.Image()
    let maskLoaded = false
    let posterLoaded = false
    const initializeMaskCanvas = () => {
      if (!live || generation !== fillGeneration.current || !maskLoaded || !posterLoaded) return
      const width = posterImage.naturalWidth
      const height = posterImage.naturalHeight
      if (!width || !height) {
        fillNotificationKind.current = 'error'
        notifyFill('Could not read the poster dimensions. Try again.', 'error')
        return
      }
      if (dimensions && (width !== dimensions.width || height !== dimensions.height)) {
        fillNotificationKind.current = 'error'
        notifyFill('The preview dimensions do not match the poster.', 'error')
        return
      }
      if (maskImage.naturalWidth !== width || maskImage.naturalHeight !== height) {
        fillNotificationKind.current = 'error'
        notifyFill('The selected region mask does not match the poster dimensions.', 'error')
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        fillNotificationKind.current = 'error'
        notifyFill('Could not read the selected region mask. Try again.', 'error')
        return
      }
      context.drawImage(maskImage, 0, 0)
      sourceMaskImageData.current = context.getImageData(0, 0, width, height)
      setSourceMaskCanvas(canvas)
      setSourceMaskReady(true)
    }
    maskImage.onload = () => {
      maskLoaded = true
      initializeMaskCanvas()
    }
    posterImage.onload = () => {
      posterLoaded = true
      initializeMaskCanvas()
    }
    const onImageError = () => {
      if (live && generation === fillGeneration.current) {
        fillNotificationKind.current = 'error'
        notifyFill('Could not load the selected region mask. Try again.', 'error')
      }
    }
    maskImage.onerror = onImageError
    posterImage.onerror = onImageError
    maskImage.src = sourceMaskUrl
    posterImage.src = posterUrl
    return () => {
      live = false
      if (
        fillPendingRef.current ||
        fillNotificationKind.current === 'error' ||
        fillNotificationKind.current === 'warning'
      ) {
        toast.dismiss('editor-region-fill')
        fillNotificationKind.current = null
      }
      fillGeneration.current += 1
      maskImage.onload = null
      maskImage.onerror = null
      posterImage.onload = null
      posterImage.onerror = null
    }
  }, [sourceMaskUrl, posterUrl, dimensions?.width, dimensions?.height, regionOnly, showingResult])
  useEffect(() => {
    if (showFilledRegion && current && !busy) setShowFilledRegion(false)
  }, [showFilledRegion, current, busy])
  useEffect(() => {
    const toastId = 'editor-fill-mode'
    if (!fillActive) {
      toast.dismiss(toastId)
      return
    }
    toast.info('Click an enclosed area to fill it. Press Esc to exit fill mode.', {
      toastId,
      autoClose: false,
      closeOnClick: false,
      role: 'status',
      ariaLabel: 'Fill mode is active. Click an enclosed area to fill it. Press Escape to exit.',
    })
    return () => toast.dismiss(toastId)
  }, [fillActive])
  function fillAt(x: number, y: number) {
    const image = sourceMaskImageData.current
    const canvas = sourceMaskCanvas
    if (!image || !canvas || !fillActive || !sourceMaskReady || fillPendingRef.current || busy) return
    const painted = fillMaskImageData(image, x, y)
    if (painted === null) {
      fillNotificationKind.current = 'warning'
      notifyFill('Open region — click inside an enclosed area.', 'warning')
      return
    }
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      fillNotificationKind.current = 'error'
      notifyFill('Could not update the selected region. Try again.', 'error')
      return
    }
    context.putImageData(image, 0, 0)
    setMaskRevision((revision) => revision + 1)
    fillPendingRef.current = true
    setFillPending(true)
    fillNotificationKind.current = 'progress'
    const toastId = 'editor-region-fill'
    if (toast.isActive(toastId)) {
      toast.update(toastId, {
        render: 'Saving the filled region…',
        type: 'default',
        isLoading: true,
        autoClose: false,
        role: 'status',
        ariaLabel: 'Saving the filled region',
      })
    } else {
      toast.loading('Saving the filled region…', {
        toastId,
        autoClose: false,
        role: 'status',
        ariaLabel: 'Saving the filled region',
      })
    }
    const generation = fillGeneration.current
    canvas.toBlob((blob) => {
      if (generation !== fillGeneration.current) return
      if (!blob) {
        fillPendingRef.current = false
        setFillPending(false)
        fillNotificationKind.current = 'error'
        notifyFill('Could not save the filled mask. Try again.', 'error')
        return
      }
      fillPendingRef.current = false
      setFillPending(false)
      fillNotificationKind.current = 'success'
      setShowFilledRegion(true)
      onMaskFillCommit(blob)
      notifyFill(`Filled ${painted} pixels.`, 'success')
    }, 'image/png')
  }
  useEffect(() => {
    if (!fillActive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFillActive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fillActive])
  const ready = externallyReady && !!dimensions && !!placement && !!posterUrl && current
  const rimActive = pattern.settings.rimModules !== 0
  const regionToolsVisible = !showingResult && !!posterUrl && !!sourceMaskUrl
  const keepPlacementCanvas =
    !!dimensions && !!placement && !!posterUrl && !!previews['qr.png'] && (!regionOnly || busy || placementInvalid)
  const fillToolbar = regionToolsVisible ? (
    <div {...stylex.props(styles.fillToolbar)}>
      <button
        {...stylex.props(ui.button, fillActive && ui.fontCardSelected)}
        type="button"
        aria-pressed={fillActive}
        disabled={!sourceMaskReady || fillPending || busy}
        onClick={() => {
          setFillActive((active) => !active)
        }}
      >
        {fillActive ? '✓ Filling region' : '🪣 Fill region'}
      </button>
      <button
        {...stylex.props(ui.button, rimActive && ui.fontCardSelected)}
        type="button"
        aria-pressed={rimActive}
        onClick={() => pattern.onSettings({ rimModules: rimActive ? 0 : 1, rimRounded: false })}
      >
        {rimActive ? '✓ Rim added' : '＋ Add Rim'}
      </button>
    </div>
  ) : null
  return (
    <section {...stylex.props(styles.panel)} aria-label="Poster preview" aria-busy={busy}>
      <div {...stylex.props(styles.heading)}>
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
            ref={patternSettingsTriggerRef}
            {...stylex.props(ui.button)}
            type="button"
            aria-controls="pattern-settings-panel"
            aria-expanded={patternSettingsOpen}
            onClick={onPatternSettingsOpen}
          >
            Pattern settings
          </button>
        </div>
        {dimensions && (
          <span {...stylex.props(styles.badge)}>
            {dimensions.width} × {dimensions.height}
          </span>
        )}
      </div>
      {showingResult && result ? (
        <ResultPanel result={result} artifacts={artifacts} onReturnToEditing={onReturnToEditing} />
      ) : keepPlacementCanvas ? (
        <div {...stylex.props(styles.canvas)}>
          <PosterCanvas
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
            fillActive={fillActive}
            fillReady={sourceMaskReady && !fillPending && !busy}
            onFillAt={fillAt}
            toolbar={fillToolbar}
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
            <span {...stylex.props(ui.hint)}>
              {current
                ? 'Export is optional; editing stays reactive.'
                : 'Preview updating; placement remains editable.'}
            </span>
          </div>
        </div>
      ) : (regionOnly || showFilledRegion) && posterUrl && sourceMaskUrl ? (
        <>
          <div {...stylex.props(styles.regionPreview)}>
            {regionToolsVisible && <div {...stylex.props(styles.tools)}>{fillToolbar}</div>}
            <div {...stylex.props(styles.regionContent)}>
              <SourceRegionPreview
                poster={posterUrl}
                maskCanvas={sourceMaskCanvas}
                revision={maskRevision}
                fillActive={fillActive}
                fillReady={sourceMaskReady && !fillPending && !busy}
                onFillAt={fillAt}
              />
            </div>
          </div>
          <p {...stylex.props(styles.regionCaption)}>
            Selected region ·{' '}
            {error
              ? 'the QR code does not fit inside this region.'
              : regionOnly
                ? 'enter text or a URL to add a QR code.'
                : 'updating the QR preview…'}
          </p>
        </>
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
