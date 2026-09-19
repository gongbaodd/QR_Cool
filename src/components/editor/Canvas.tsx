'use client'
import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as CanvasImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { canonicalPlacement, fitsMask } from '../../lib/editor/schema'
import type { Placement } from '../../lib/editor/schema'
function useImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement>()
  useEffect(() => {
    const image = new window.Image()
    let live = true
    image.onload = () => {
      if (live) setImage(image)
    }
    image.src = url
    return () => {
      live = false
    }
  }, [url])
  return image
}
export default function EditorCanvas({
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
}) {
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
  const posterImage = useImage(poster),
    overlayImage = useImage(overlay),
    qrImage = useImage(qr)
  const wrapper = useRef<HTMLDivElement>(null),
    node = useRef<Konva.Image>(null),
    transformer = useRef<Konva.Transformer>(null)
  const [viewport, setViewport] = useState(800),
    [zoom, setZoom] = useState(1),
    [showMask, setShowMask] = useState(true)
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setViewport(entries[0]!.contentRect.width))
    if (wrapper.current) observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (node.current) transformer.current?.nodes([node.current])
  }, [qrImage])
  const fit = Math.min((viewport - 32) / width, 640 / height, 1)
  const scale = fit * zoom
  function nudge(dx: number, dy: number) {
    onChange({ ...placement, x: Math.max(0, placement.x + dx), y: Math.max(0, placement.y + dy) })
  }
  return (
    <div className="canvas-area" ref={wrapper}>
      <div className="canvas-tools">
        <label>
          Zoom{' '}
          <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={0.5}>50%</option>
            <option value={1}>Fit</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
        <button onClick={() => setZoom(1)}>Fit to screen</button>
        <label className="check">
          <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} /> Show region
        </label>
      </div>
      <div
        className="canvas-scroll"
        tabIndex={0}
        role="group"
        aria-label="Poster canvas. Arrow keys move the QR; Shift moves ten pixels."
        onKeyDown={(e) => {
          const delta = e.shiftKey ? 10 : 1
          const steps: Record<string, number[]> = {
            ArrowLeft: [-delta, 0],
            ArrowRight: [delta, 0],
            ArrowUp: [0, -delta],
            ArrowDown: [0, delta],
          }
          const step = steps[e.key]
          if (step) {
            e.preventDefault()
            nudge(step[0]!, step[1]!)
          }
        }}
      >
        <Stage width={width * scale} height={height * scale} scaleX={scale} scaleY={scale}>
          <Layer>
            <CanvasImage image={posterImage} width={width} height={height} listening={false} />
            {showMask && <CanvasImage image={overlayImage} width={width} height={height} listening={false} />}
            <CanvasImage
              ref={node}
              image={qrImage}
              x={placement.x}
              y={placement.y}
              width={placement.size}
              height={placement.size}
              draggable
              dragDistance={1}
              onDragMove={(e) => {
                const box = canonicalPlacement({ ...placement, x: e.target.x(), y: e.target.y() }, modules)
                node.current?.stroke(maskData && !fitsMask(maskData, width, height, box) ? '#dd3748' : '#087f67')
              }}
              stroke={invalid ? '#dd3748' : '#087f67'}
              strokeWidth={2 / scale}
              onDragEnd={(e) =>
                onChange(canonicalPlacement({ ...placement, x: e.target.x(), y: e.target.y() }, modules))
              }
              onTransformEnd={() => {
                const n = node.current!
                const box = canonicalPlacement({ x: n.x(), y: n.y(), size: n.width() * n.scaleX() }, modules)
                n.scale({ x: 1, y: 1 })
                onChange(box)
              }}
            />
            <Transformer
              ref={transformer}
              rotateEnabled={false}
              flipEnabled={false}
              keepRatio
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              anchorSize={14}
              anchorCornerRadius={3}
              borderStroke={invalid ? '#dd3748' : '#087f67'}
              boundBoxFunc={(old, next) => (next.width < modules * 4 * scale ? old : next)}
            />
          </Layer>
        </Stage>
      </div>
      <div className="canvas-footer">
        <span>Drag the QR or resize a corner. Scroll to pan when zoomed.</span>
        <div className="nudges" aria-label="Touch position controls">
          <button aria-label="Move left" onClick={() => nudge(-1, 0)}>
            ←
          </button>
          <button aria-label="Move up" onClick={() => nudge(0, -1)}>
            ↑
          </button>
          <button aria-label="Move down" onClick={() => nudge(0, 1)}>
            ↓
          </button>
          <button aria-label="Move right" onClick={() => nudge(1, 0)}>
            →
          </button>
        </div>
      </div>
    </div>
  )
}
