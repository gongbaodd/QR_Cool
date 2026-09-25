'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { toast } from 'react-toastify'
import type { Result } from '@/lib/editor/state'
import type { RasterExportPayload } from '@mahu-qr/renderer/engine'
import type { Placement, Settings } from '@mahu-qr/renderer/schema'
import { canonicalizeRotation } from '@mahu-qr/renderer/core/rotate'
import {
  beginPlacementGesture,
  canonicalGesturePlacement,
  placementFrameTransform,
  placementAtPointer,
  placementTransform,
  rebasePlacementGesture,
  samePlacement,
} from '@/lib/editor/placement-gesture'
import type { PlacementGesture, PlacementGestureKind } from '@/lib/editor/placement-gesture'
import { autoFillMaskHoles, fillMaskImageData } from '@/lib/editor/mask-fill'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const ResultPanel = dynamic(() => import('./ResultPanel'))
const MarkerDialog = dynamic(() => import('./MarkerDialog'))

const styles = stylex.create({
  panel: { minWidth: 0, paddingBlock: 24, paddingInline: 24 },
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
    '@media (max-width: 56.25em)': { minHeight: 320 },
  },
  emptyIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 72,
    height: 72,
    fontSize: 32,
    backgroundColor: tokens.accentSoft,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: '50%',
    boxShadow: tokens.shadow,
  },
  emptyMark: { display: 'block', width: 56, height: 56 },
  emptyTitle: { fontSize: '1.4375rem', fontWeight: 400, margin: 0 },
  emptyText: { color: tokens.inkMuted, margin: 0 },
  loading: {
    minHeight: 560,
    display: 'grid',
    placeItems: 'center',
    color: tokens.inkMuted,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    '@media (max-width: 56.25em)': { minHeight: 320 },
  },
  canvas: { minWidth: 0 },
  regionPreview: {
    minHeight: 720,
    overflow: 'clip',
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
    '@media (max-width: 56.25em)': { minHeight: 480 },
  },
  regionContent: {
    flex: 1,
    display: 'grid',
    placeItems: 'center',
    width: '100%',
    boxSizing: 'border-box',
    padding: 24,
  },
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
    overflow: 'clip',
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  tools: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    minWidth: 0,
    gap: 12,
    padding: 12,
    width: '100%',
    boxSizing: 'border-box',
    fontSize: '0.9375rem',
    backgroundColor: tokens.accentSoftest,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 700px)': { gap: 8 },
  },
  scene: {
    margin: 6,
    padding: 18,
    backgroundColor: tokens.paper,
  },
  markerTarget: {
    ':focus-visible': {
      stroke: tokens.accent,
      strokeDasharray: '1 2',
      strokeWidth: 3,
      vectorEffect: 'non-scaling-stroke',
    },
  },
  stageFrame: {
    width: 'fit-content',
    marginInline: 'auto',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    boxShadow: '0 8px 28px rgba(16, 18, 17, 0.08)',
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
    minWidth: 0,
    boxSizing: 'border-box',
    paddingBlock: 12,
    paddingInline: 14,
    fontSize: '0.875rem',
    color: tokens.inkMuted,
    backgroundColor: tokens.card,
    borderTopWidth: 2,
    borderTopStyle: 'solid',
    borderTopColor: tokens.ink,
    '@media (max-width: 1000px)': { flexWrap: 'wrap' },
  },
  nudges: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    minWidth: 0,
    gap: 8,
  },
  nudge: { minWidth: 42, minHeight: 42, paddingBlock: 4, paddingInline: 8 },
  bestPosition: { minHeight: 42, paddingBlock: 4, paddingInline: 10 },
  fillToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: '1 1 360px',
    flexWrap: 'wrap',
    minWidth: 0,
    gap: 12,
  },
  fillActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0, gap: 12 },
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

function notifyFill(message: string, kind: 'error' | 'warning' | 'success' | 'info') {
  const toastId = 'editor-region-fill'
  const options = {
    toastId,
    autoClose: kind === 'error' ? (false as const) : 3500,
    role: kind === 'error' ? ('alert' as const) : ('status' as const),
    ariaLabel: `Region fill ${kind}: ${message}`,
  }
  if (toast.isActive(toastId)) {
    toast.update(toastId, { render: message, type: kind, isLoading: false, ...options })
  } else {
    toast[kind](message, options)
  }
}

function yieldToBrowser(): Promise<void> {
  const schedulerApi = (window as Window & { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (schedulerApi?.yield) return schedulerApi.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function PosterCanvas({
  poster,
  overlay,
  qr,
  width,
  height,
  placement,
  bestPlacement,
  modules,
  onChange,
  onMarkerClick,
  fillActive,
  fillReady,
  onFillAt,
  toolbar,
  onGestureStart,
}: {
  poster: string
  overlay: string
  mask: string
  qr: string
  width: number
  height: number
  placement: Placement
  bestPlacement: Placement
  modules: number
  onChange: (box: Placement) => void
  invalid: boolean
  onMarkerClick?: (kind: 'tl' | 'tr' | 'bl' | 'sub') => void
  fillActive: boolean
  fillReady: boolean
  onFillAt: (x: number, y: number) => void
  toolbar: ReactNode
  onGestureStart: () => void
}) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(800)
  const [stageHeight, setStageHeight] = useState(640)
  const [hoverMarker, setHoverMarker] = useState<string | null>(null)
  const gesture = useRef<PlacementGesture | null>(null)
  const animation = useRef<number | null>(null)
  const settling = useRef(false)
  const committedPlacement = useRef(placement)
  committedPlacement.current = placement
  const cancelGesture = useCallback((pointer?: number) => {
    const active = gesture.current
    if (pointer !== undefined && active?.pointer !== pointer) return
    if (!active && !settling.current) return
    gesture.current = null
    settling.current = false
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current)
      animation.current = null
    }
    const svg = sceneRef.current?.querySelector<SVGSVGElement>('svg[aria-label="Poster editing preview"]')
    if (active && svg?.hasPointerCapture(active.pointer)) svg.releasePointerCapture(active.pointer)
    const root = sceneRef.current?.querySelector<SVGGElement>('[data-gesture-target]')
    if (root) root.setAttribute('transform', placementFrameTransform(committedPlacement.current))
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!gesture.current && !settling.current)) return
      event.preventDefault()
      cancelGesture()
    }
    const onBlur = () => cancelGesture()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      cancelGesture()
    }
  }, [cancelGesture])
  const interactionSource = useRef({ poster, qr, width, height, modules, placement })
  useEffect(() => {
    const previous = interactionSource.current
    const changed =
      previous.poster !== poster ||
      previous.qr !== qr ||
      previous.width !== width ||
      previous.height !== height ||
      previous.modules !== modules ||
      !samePlacement(previous.placement, placement)
    if (changed && (gesture.current || settling.current)) cancelGesture()
    interactionSource.current = { poster, qr, width, height, modules, placement }
  }, [poster, qr, width, height, modules, placement, cancelGesture])
  useEffect(() => {
    const stage = sceneRef.current
    const area = stage?.parentElement
    const section = stage?.closest('section')
    if (!stage || !area || !section) return
    const footer = area.lastElementChild
    const measure = () => {
      if (!(footer instanceof HTMLElement)) return
      const stageStyle = window.getComputedStyle(stage)
      const sectionStyle = window.getComputedStyle(section)
      const px = (value: string) => Number.parseFloat(value) || 0
      const contentWidth = stage.clientWidth - px(stageStyle.paddingLeft) - px(stageStyle.paddingRight) - 4
      setViewport(Math.max(0, contentWidth))
      const reserved =
        footer.getBoundingClientRect().height +
        px(sectionStyle.paddingBottom) +
        px(stageStyle.marginTop) +
        px(stageStyle.marginBottom) +
        px(stageStyle.paddingTop) +
        px(stageStyle.paddingBottom) +
        8
      const available = Math.floor(window.innerHeight - stage.getBoundingClientRect().top - reserved)
      const nextHeight = Math.max(160, Math.min(640, available))
      setStageHeight((current) => (current === nextHeight ? current : nextHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(area)
    observer.observe(section)
    if (footer instanceof HTMLElement) observer.observe(footer)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const fit = Math.min(viewport / width, stageHeight / height, 1)
  const pitch = modules ? placement.size / modules : 0
  const q = 2,
    n = modules - 4,
    version = modules ? Math.floor((modules - 21) / 4) : 0
  const markers: { id: string; kind: 'tl' | 'tr' | 'bl' | 'sub'; x: number; y: number; size: number }[] = modules
    ? [
        { id: 'tl', kind: 'tl', x: q * pitch, y: q * pitch, size: 7 * pitch },
        { id: 'tr', kind: 'tr', x: (q + n - 7) * pitch, y: q * pitch, size: 7 * pitch },
        { id: 'bl', kind: 'bl', x: q * pitch, y: (q + n - 7) * pitch, size: 7 * pitch },
        ...(version >= 2
          ? [{ id: 'br', kind: 'sub' as const, x: (q + n - 9) * pitch, y: (q + n - 9) * pitch, size: 5 * pitch }]
          : []),
      ]
    : []
  const localPoint = (event: { clientX: number; clientY: number }, svg: SVGSVGElement | null) => {
    if (!svg) return { x: 0, y: 0 }
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const matrix = svg.getScreenCTM()?.inverse()
    return matrix ? point.matrixTransform(matrix) : { x: 0, y: 0 }
  }
  const begin = (kind: PlacementGestureKind, event: React.PointerEvent<SVGElement>) => {
    if (fillActive || settling.current) return
    onGestureStart()
    event.preventDefault()
    const svg = sceneRef.current?.querySelector<SVGSVGElement>('svg[aria-label="Poster editing preview"]')
    svg?.setPointerCapture(event.pointerId)
    const point = localPoint(event, svg ?? event.currentTarget.ownerSVGElement)
    gesture.current = beginPlacementGesture(kind, event.pointerId, point, placement, event.altKey)
  }
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const point = localPoint(event, event.currentTarget)
    if (active.kind === 'resize' && active.centerMode !== event.altKey)
      rebasePlacementGesture(active, point, active.latest, event.altKey)
    const next = placementAtPointer(active, point, modules, event.altKey)
    active.latest = next
    if (animation.current === null)
      animation.current = requestAnimationFrame(() => {
        animation.current = null
        const latest = gesture.current
        const root = sceneRef.current?.querySelector<SVGGElement>('[data-gesture-target]')
        if (!latest || !root) return
        root.setAttribute('transform', placementTransform(latest.origin, latest.latest))
      })
  }
  const end = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current)
      animation.current = null
    }
    const root = event.currentTarget.querySelector<SVGGElement>('[data-gesture-target]')
    if (!root) {
      cancelGesture(event.pointerId)
      return
    }
    const point = localPoint(event, event.currentTarget)
    if (active.kind === 'resize' && active.centerMode !== event.altKey)
      rebasePlacementGesture(active, point, active.latest, event.altKey)
    active.latest = placementAtPointer(active, point, modules, event.altKey)
    root.setAttribute('transform', placementTransform(active.origin, active.latest))
    const next = canonicalGesturePlacement(active, active.latest, modules)
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (samePlacement(next, active.origin)) {
      root.setAttribute('transform', placementFrameTransform(active.origin))
      return
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduceMotion ? 0 : 110
    if (!duration) {
      root.setAttribute('transform', placementTransform(active.origin, next))
      onChange(next)
      return
    }

    settling.current = true
    const from = active.latest
    const rotationDelta = ((next.rotation - from.rotation + 540) % 360) - 180
    const start = performance.now()
    const settle = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      const pose: Placement = {
        x: from.x + (next.x - from.x) * eased,
        y: from.y + (next.y - from.y) * eased,
        size: from.size + (next.size - from.size) * eased,
        rotation: from.rotation + rotationDelta * eased,
      }
      root.setAttribute('transform', placementTransform(active.origin, pose))
      if (progress < 1) {
        animation.current = requestAnimationFrame(settle)
      } else {
        animation.current = null
        settling.current = false
        root.setAttribute('transform', placementTransform(active.origin, next))
        onChange(next)
      }
    }
    animation.current = requestAnimationFrame(settle)
  }
  const nudge = (dx: number, dy: number) => {
    if (gesture.current || settling.current) cancelGesture()
    onGestureStart()
    onChange({ ...placement, x: placement.x + dx, y: placement.y + dy })
  }
  const bestPosition: Placement = {
    ...placement,
    x: Math.round(bestPlacement.x + (bestPlacement.size - placement.size) / 2),
    y: Math.round(bestPlacement.y + (bestPlacement.size - placement.size) / 2),
  }
  const moveToBestPosition = () => {
    if (gesture.current || settling.current) cancelGesture()
    if (samePlacement(bestPosition, placement)) return
    onGestureStart()
    onChange(bestPosition)
  }
  const frame = (x: number, y: number, size: number) =>
    placementFrameTransform({ x, y, size, rotation: placement.rotation })
  return (
    <div {...stylex.props(styles.area)}>
      {toolbar && <div {...stylex.props(styles.tools)}>{toolbar}</div>}
      <div
        {...stylex.props(styles.scene, ui.focusVisible)}
        ref={sceneRef}
        tabIndex={0}
        role="group"
        aria-label="Poster. Arrow keys move the QR; Shift moves ten pixels. Use the square and rotation handles to resize or rotate. Hold Alt while resizing to scale from the centre. Press Escape to cancel a gesture."
        onKeyDown={(event) => {
          if (gesture.current || settling.current) return
          const delta = event.shiftKey ? 10 : 1
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [-delta, 0],
            ArrowRight: [delta, 0],
            ArrowUp: [0, -delta],
            ArrowDown: [0, delta],
          }
          if (steps[event.key]) {
            event.preventDefault()
            nudge(...steps[event.key]!)
          }
          if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            onGestureStart()
            const size = placement.size + modules
            onChange({
              ...placement,
              size,
              x: Math.round(placement.x - modules / 2),
              y: Math.round(placement.y - modules / 2),
            })
          }
          if (event.key === '-' || event.key === '_') {
            event.preventDefault()
            onGestureStart()
            const size = Math.max(modules * 4, placement.size - modules)
            onChange({
              ...placement,
              size,
              x: Math.round(placement.x + (placement.size - size) / 2),
              y: Math.round(placement.y + (placement.size - size) / 2),
            })
          }
          if (event.key === '[' || event.key === ']') {
            event.preventDefault()
            onGestureStart()
            onChange({
              ...placement,
              rotation: canonicalizeRotation(placement.rotation + (event.key === ']' ? 1 : -1)),
            })
          }
        }}
      >
        <div {...stylex.props(styles.stageFrame)}>
          <svg
            width={width * fit}
            height={height * fit}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Poster editing preview"
            style={{ touchAction: 'none' }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={(event) => cancelGesture(event.pointerId)}
            onLostPointerCapture={(event) => cancelGesture(event.pointerId)}
            onClick={(event) => {
              if (!fillActive || !fillReady || (event.target as Element).closest('[data-gesture-target]')) return
              const p = localPoint(event, event.currentTarget)
              onFillAt(Math.floor(p.x), Math.floor(p.y))
            }}
          >
            <image href={poster} width={width} height={height} />
            <image href={overlay} width={width} height={height} pointerEvents="none" />
            <g
              data-gesture-target=""
              transform={frame(placement.x, placement.y, placement.size)}
              onPointerDown={(event) => begin('move', event)}
              style={{ touchAction: 'none' }}
            >
              <svg
                x={placement.x + pitch}
                y={placement.y + pitch}
                width={placement.size - 2 * pitch}
                height={placement.size - 2 * pitch}
                viewBox={`${placement.x + pitch} ${placement.y + pitch} ${placement.size - 2 * pitch} ${placement.size - 2 * pitch}`}
                overflow="hidden"
              >
                <image
                  data-qr-image=""
                  href={qr}
                  x={placement.x}
                  y={placement.y}
                  width={placement.size}
                  height={placement.size}
                  preserveAspectRatio="none"
                  style={{ touchAction: 'none' }}
                />
              </svg>
              {markers.map((marker) => (
                <rect
                  {...stylex.props(styles.markerTarget)}
                  data-marker-target=""
                  key={marker.id}
                  x={placement.x + marker.x}
                  y={placement.y + marker.y}
                  width={marker.size}
                  height={marker.size}
                  fill="#ff321e"
                  fillOpacity={hoverMarker === marker.id ? 0.28 : 0.06}
                  tabIndex={onMarkerClick && !fillActive ? 0 : -1}
                  role="button"
                  aria-label={`Edit ${marker.kind} marker`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => setHoverMarker(marker.id)}
                  onPointerLeave={() => setHoverMarker(null)}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!fillActive) onMarkerClick?.(marker.kind)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onMarkerClick?.(marker.kind)
                    }
                  }}
                />
              ))}
              <rect
                data-selection-outline=""
                x={placement.x}
                y={placement.y}
                width={placement.size}
                height={placement.size}
                fill="none"
                stroke="#101211"
                strokeDasharray="7 5"
                strokeWidth={Math.max(2, 2 / fit)}
                pointerEvents="none"
              />
              <rect
                data-resize-handle=""
                x={placement.x + placement.size - 10 / fit}
                y={placement.y + placement.size - 10 / fit}
                width={20 / fit}
                height={20 / fit}
                fill="#fdf8f2"
                stroke="#101211"
                strokeWidth={2 / fit}
                cursor="nwse-resize"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  begin('resize', event)
                }}
                style={{ touchAction: 'none' }}
              />
              <circle
                data-rotation-handle=""
                cx={placement.x + placement.size / 2}
                cy={placement.y - 18 / fit}
                r={9 / fit}
                fill="#fdf8f2"
                stroke="#101211"
                strokeWidth={2 / fit}
                cursor="grab"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  begin('rotate', event)
                }}
                style={{ touchAction: 'none' }}
              />
            </g>
          </svg>
        </div>
      </div>
      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.nudges)} aria-label="Touch position controls">
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.nudge)}
            aria-label="Move left"
            onClick={() => nudge(-1, 0)}
          >
            ←
          </button>
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.nudge, ui.buttonAlt)}
            aria-label="Move up"
            onClick={() => nudge(0, -1)}
          >
            ↑
          </button>
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.nudge)}
            aria-label="Move down"
            onClick={() => nudge(0, 1)}
          >
            ↓
          </button>
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.nudge, ui.buttonAlt)}
            aria-label="Move right"
            onClick={() => nudge(1, 0)}
          >
            →
          </button>
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.bestPosition)}
            type="button"
            onClick={moveToBestPosition}
          >
            Best position
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
  bestPlacement,
  modules,
  invalid,
  busy,
  current,
  onMove,
  onPlacementGestureStart,
  onMaskFillCommit,
  onReturnToEditing,
  onExportRaster,
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
  bestPlacement: Placement | null
  modules: number
  invalid: boolean
  busy: boolean
  current: boolean
  onMove: (box: Placement) => void
  onPlacementGestureStart: () => void
  onMaskFillCommit: (mask: Blob) => void
  onReturnToEditing: () => void
  onExportRaster: (targetPitch: number) => Promise<RasterExportPayload>
  pattern: {
    settings: Settings
    onSettings: (patch: Partial<Settings>) => void
  }
  onAssemble: () => void
  assembleBusy: boolean
  ready: boolean
  canAssemble: boolean
}) {
  const [markerDialog, setMarkerDialog] = useState<'tl' | 'tr' | 'bl' | 'sub' | null>(null)
  const [fillActive, setFillActive] = useState(false)
  const [sourceMaskCanvas, setSourceMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [sourceMaskReady, setSourceMaskReady] = useState(false)
  const [fillPending, setFillPending] = useState(false)
  const fillPendingRef = useRef(false)
  const [maskRevision, setMaskRevision] = useState(0)
  const [showFilledRegion, setShowFilledRegion] = useState(false)
  const sourceMaskImageData = useRef<ImageData | null>(null)
  const fillGeneration = useRef(0)
  const fillNotificationKind = useRef<'error' | 'warning' | 'success' | 'info' | 'progress' | null>(null)
  const expectedWidth = dimensions?.width
  const expectedHeight = dimensions?.height
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
      if (
        expectedWidth !== undefined &&
        expectedHeight !== undefined &&
        (width !== expectedWidth || height !== expectedHeight)
      ) {
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
  }, [sourceMaskUrl, posterUrl, expectedWidth, expectedHeight, regionOnly, showingResult])
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
  async function autoFill() {
    const image = sourceMaskImageData.current
    if (!image || !sourceMaskReady || fillPendingRef.current || busy) return

    setFillActive(false)
    fillPendingRef.current = true
    setFillPending(true)
    fillNotificationKind.current = 'progress'
    const toastId = 'editor-region-fill'
    toast.loading('Finding enclosed areas…', {
      toastId,
      autoClose: false,
      role: 'status',
      ariaLabel: 'Finding enclosed mask areas',
    })

    const generation = fillGeneration.current
    const isStale = () => generation !== fillGeneration.current
    const completeWithoutCommit = (message: string, kind: 'info' | 'error') => {
      if (isStale()) return
      fillPendingRef.current = false
      setFillPending(false)
      fillNotificationKind.current = kind
      notifyFill(message, kind)
    }

    try {
      const operation = autoFillMaskHoles(image.data, image.width, image.height)
      let deadline = performance.now() + 50
      let step = operation.next()
      while (!step.done) {
        if (isStale()) return
        if (performance.now() >= deadline) {
          await yieldToBrowser()
          if (isStale()) return
          deadline = performance.now() + 50
        }
        step = operation.next()
      }
      if (isStale()) return
      const result = step.value
      if (!result) {
        completeWithoutCommit('No enclosed areas to fill.', 'info')
        return
      }

      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = image.width
      outputCanvas.height = image.height
      const context = outputCanvas.getContext('2d')
      if (!context) {
        completeWithoutCommit('Could not update the selected region. Try again.', 'error')
        return
      }
      const outputImage = new ImageData(image.width, image.height)
      outputImage.data.set(result.data)
      context.putImageData(outputImage, 0, 0)
      outputCanvas.toBlob((blob) => {
        if (isStale()) return
        if (!blob) {
          completeWithoutCommit('Could not save the filled mask. Try again.', 'error')
          return
        }
        fillPendingRef.current = false
        setFillPending(false)
        setMaskRevision((revision) => revision + 1)
        setShowFilledRegion(true)
        fillNotificationKind.current = 'success'
        onMaskFillCommit(blob)
        notifyFill(
          `Filled ${result.holeCount} enclosed ${result.holeCount === 1 ? 'area' : 'areas'} (${result.filledPixels} pixels).`,
          'success',
        )
      }, 'image/png')
    } catch {
      completeWithoutCommit('Could not fill the selected region. Try again.', 'error')
    }
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
  const marginActive = pattern.settings.regionMargin
  const regionToolsVisible = !showingResult && !!posterUrl && !!sourceMaskUrl
  const keepPlacementCanvas =
    !!dimensions && !!placement && !!posterUrl && !!previews['qr.png'] && (!regionOnly || busy || placementInvalid)
  const fillToolbar = regionToolsVisible ? (
    <div {...stylex.props(styles.fillToolbar)}>
      <div {...stylex.props(styles.fillActions)}>
        <button
          {...stylex.props(ui.button, ui.focusVisible, fillActive && ui.fontCardSelected)}
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
          {...stylex.props(ui.button, ui.focusVisible)}
          type="button"
          disabled={!sourceMaskReady || fillPending || busy}
          onClick={() => void autoFill()}
        >
          {fillPending ? 'Filling holes…' : 'Auto fill'}
        </button>
        <button
          {...stylex.props(ui.button, ui.focusVisible, rimActive && ui.fontCardSelected)}
          type="button"
          aria-pressed={rimActive}
          onClick={() => pattern.onSettings({ rimModules: rimActive ? 0 : 1, rimRounded: false })}
        >
          {rimActive ? '✓ Rim added' : '＋ Add Rim'}
        </button>
        <button
          {...stylex.props(ui.button, ui.focusVisible, marginActive && ui.fontCardSelected)}
          type="button"
          aria-pressed={marginActive}
          onClick={() => pattern.onSettings({ regionMargin: !marginActive })}
        >
          {marginActive ? '✓ Margin added' : '＋ Add Margin'}
        </button>
      </div>
      {!regionOnly && keepPlacementCanvas && (
        <button
          {...stylex.props(ui.button, ui.focusVisible, ui.primary)}
          type="button"
          disabled={!ready || !canAssemble || assembleBusy}
          onClick={onAssemble}
        >
          {assembleBusy ? 'Assembling…' : 'Assemble poster'}
        </button>
      )}
    </div>
  ) : null
  return (
    <section {...stylex.props(styles.panel)} aria-label="Poster preview" aria-busy={busy}>
      {showingResult && result ? (
        <ResultPanel
          key={result.revision}
          result={result}
          artifacts={artifacts}
          dimensions={dimensions!}
          placement={placement!}
          modules={modules}
          onExportRaster={onExportRaster}
          onReturnToEditing={onReturnToEditing}
        />
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
            bestPlacement={bestPlacement ?? placement!}
            modules={modules}
            onChange={onMove}
            onGestureStart={onPlacementGestureStart}
            invalid={invalid}
            onMarkerClick={setMarkerDialog}
            fillActive={fillActive}
            fillReady={sourceMaskReady && !fillPending && !busy}
            onFillAt={fillAt}
            toolbar={fillToolbar}
          />
        </div>
      ) : (regionOnly || showFilledRegion) && posterUrl && sourceMaskUrl ? (
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
      ) : (
        <div {...stylex.props(busy ? styles.loading : styles.empty)}>
          {busy ? (
            <span>Preparing a live canvas…</span>
          ) : (
            <>
              <div {...stylex.props(styles.emptyIcon)}>
                <img {...stylex.props(styles.emptyMark)} src="/brand/mahu-tiger.svg" alt="" width={56} height={56} />
              </div>
              <h3 {...stylex.props(styles.emptyTitle)}>Your poster goes here</h3>
              <p {...stylex.props(styles.emptyText)}>Enter text or a URL to start the preview.</p>
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
    </section>
  )
}
