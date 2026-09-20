'use client'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Stage, Layer, Image as CanvasImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { canonicalPlacement, fitsMask } from '../../lib/editor/schema'
import type { Placement } from '../../lib/editor/schema'
import { tokens } from '../../styles/tokens.stylex'
import { ui } from '../../styles/ui.stylex'

const styles = stylex.create({
  area: {
    overflow: 'hidden',
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
    flexWrap: 'wrap',
    gap: 12,
    padding: 12,
    fontSize: 15,
    backgroundColor: tokens.highlightSoft,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 700px)': {
      gap: 8,
    },
  },
  toolLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
  },
  toolSelect: {
    width: 'auto',
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    paddingBlock: 5,
    paddingInline: 10,
    fontSize: 15,
  },
  check: {
    marginInlineStart: 'auto',
    '@media (max-width: 700px)': {
      marginInlineStart: 0,
    },
  },
  scroll: {
    overflow: 'auto',
    padding: 18,
    maxHeight: 720,
    touchAction: 'pan-x pan-y',
    backgroundColor: tokens.paper,
    '@media (max-width: 700px)': {
      maxHeight: 460,
    },
    ':focus-visible': {
      outlineWidth: 3,
      outlineStyle: 'dashed',
      outlineColor: tokens.green,
      outlineOffset: 3,
      borderRadius: 6,
    },
  },
  /** Frames the Konva canvas the way the library's own content box used to. */
  stageFrame: {
    width: 'fit-content',
    marginInline: 'auto',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    boxShadow: '0 8px 28px #163c2820',
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
    '@media (max-width: 1000px)': {
      flexWrap: 'wrap',
    },
  },
  nudges: {
    display: 'flex',
    gap: 8,
  },
  nudge: {
    minWidth: 42,
    minHeight: 42,
    paddingBlock: 4,
    paddingInline: 8,
  },
})
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
  const scale = fit
  // Show the QR with a 1-module light margin: the normalized preview carries a
  // 2-module quiet zone, so crop 1 module per side and inset the node.
  const pitch = modules ? placement.size / modules : 0
  const margin = pitch
  const displayX = placement.x + margin
  const displayY = placement.y + margin
  const displaySize = placement.size - 2 * margin
  function nudge(dx: number, dy: number) {
    onChange({ ...placement, x: Math.max(0, placement.x + dx), y: Math.max(0, placement.y + dy) })
  }
  return (
    <div {...stylex.props(styles.area)} ref={wrapper}>
      <div {...stylex.props(styles.tools)}>
        <label {...stylex.props(ui.label, styles.toolLabel)}>
          <input
            {...stylex.props(ui.checkbox)}
            type="checkbox"
            checked={showMask}
            onChange={(e) => setShowMask(e.target.checked)}
          />{' '}
          Show region
        </label>
      </div>
      <div
        {...stylex.props(styles.scroll)}
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
        <div {...stylex.props(styles.stageFrame)}>
          <Stage width={width * scale} height={height * scale} scaleX={scale} scaleY={scale}>
            <Layer>
              <CanvasImage image={posterImage} width={width} height={height} listening={false} />
              {showMask && <CanvasImage image={overlayImage} width={width} height={height} listening={false} />}
              <CanvasImage
                ref={node}
                image={qrImage}
                x={displayX}
                y={displayY}
                width={displaySize}
                height={displaySize}
                crop={{ x: margin, y: margin, width: displaySize, height: displaySize }}
                draggable
                dragDistance={1}
                onDragMove={(e) => {
                  const box = canonicalPlacement(
                    { ...placement, x: e.target.x() - margin, y: e.target.y() - margin },
                    modules,
                  )
                  node.current?.stroke(maskData && !fitsMask(maskData, width, height, box) ? '#dd3748' : '#087f67')
                }}
                stroke={invalid ? '#dd3748' : '#087f67'}
                strokeWidth={2 / scale}
                onDragEnd={(e) =>
                  onChange(
                    canonicalPlacement({ ...placement, x: e.target.x() - margin, y: e.target.y() - margin }, modules),
                  )
                }
                onTransformEnd={() => {
                  const n = node.current!
                  const croppedSize = n.width() * n.scaleX()
                  const nextPitch = modules > 2 ? croppedSize / (modules - 2) : pitch
                  const fullSize = nextPitch * modules
                  const fullX = n.x() - nextPitch
                  const fullY = n.y() - nextPitch
                  n.scale({ x: 1, y: 1 })
                  onChange(canonicalPlacement({ x: fullX, y: fullY, size: fullSize }, modules))
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
                boundBoxFunc={(old, next) => (next.width < (modules - 2) * 4 * scale ? old : next)}
              />
            </Layer>
          </Stage>
        </div>
      </div>
      <div {...stylex.props(styles.footer)}>
        <span>Drag the QR or resize a corner.</span>
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
