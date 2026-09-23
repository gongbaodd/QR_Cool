'use client'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { fitTextMaskSize } from '@/lib/editor/text-mask'
import type { IconItem } from '@/lib/editor/text-mask'
import { computeFillRegion } from '@/lib/editor/mask-fill'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  wrap: {
    display: 'flex',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    overflow: 'hidden',
    backgroundColor: tokens.paper,
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  canvas: {
    width: '100%',
    maxWidth: 560,
    aspectRatio: '1 / 1',
    backgroundColor: 'black',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchAlt,
  },
  blankCanvas: { backgroundColor: 'white' },
})

const BUCKET_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><text x='2' y='22' font-size='20'>🪣</text></svg>\") 2 24, pointer"

export interface MaskPreviewCanvasProps {
  effectiveMask: string
  family: string
  isBlank: boolean
  isIconMode: boolean
  iconResults: IconItem[]
  selectedIconId: string | null
  onFillCommit?: ((preview: HTMLCanvasElement) => void) | undefined
}

/** Step 2's white-on-black mask preview, mirroring the uploaded mask canvas. */
export default function MaskPreviewCanvas({
  effectiveMask,
  family,
  isBlank,
  isIconMode,
  iconResults,
  selectedIconId,
  onFillCommit,
}: MaskPreviewCanvasProps) {
  const maskPreview = useRef<HTMLCanvasElement | null>(null)
  const [fillActive, setFillActive] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    if (!fillActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFillActive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fillActive])
  useEffect(() => {
    const node = maskPreview.current
    if (!node) return
    let live = true
    setStatus(null)
    if (isBlank) {
      const context = node.getContext('2d')!
      context.fillStyle = 'white'
      context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'black'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = `${Math.max(14, Math.round(node.width * 0.032))}px sans-serif`
      context.fillText('blank — full canvas', node.width / 2, node.height / 2)
      return () => {
        live = false
      }
    }
    if (isIconMode) {
      const item = iconResults.find((r) => r.id === selectedIconId)
      const download = item?.download ?? item?.variants[0]?.download
      if (!download) {
        const context = node.getContext('2d')!
        context.fillStyle = 'black'
        context.fillRect(0, 0, node.width, node.height)
        context.fillStyle = 'white'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = `${Math.max(14, Math.round(node.width * 0.032))}px sans-serif`
        context.fillText('icon', node.width / 2, node.height / 2)
        return () => {
          live = false
        }
      }
      void (async () => {
        try {
          const svgText = await fetch(download).then((r) => {
            if (!r.ok) throw new Error('svg fetch')
            return r.text()
          })
          if (!live) return
          const recolored = svgText
            .replace(/currentColor/g, 'white')
            .replace(/#000000/gi, 'white')
            .replace(/#000\b/gi, 'white')
            .replace(/\bblack\b/gi, 'white')
          const blob = new Blob([recolored], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          const img = new window.Image()
          await new Promise<void>((res, rej) => {
            img.onload = () => res()
            img.onerror = () => rej(new Error('img'))
            img.src = url
          })
          if (!live) {
            URL.revokeObjectURL(url)
            return
          }
          const context = node.getContext('2d')!
          context.fillStyle = 'black'
          context.fillRect(0, 0, node.width, node.height)
          const nw = (img as unknown as { naturalWidth: number }).naturalWidth || img.width || 24
          const nh = (img as unknown as { naturalHeight: number }).naturalHeight || img.height || 24
          const scale = Math.min((node.width * 0.8) / nw, (node.height * 0.8) / nh)
          const dw = nw * scale,
            dh = nh * scale
          context.drawImage(img, (node.width - dw) / 2, (node.height - dh) / 2, dw, dh)
          URL.revokeObjectURL(url)
        } catch {
          if (!live) return
          const context = node.getContext('2d')!
          context.fillStyle = 'black'
          context.fillRect(0, 0, node.width, node.height)
        }
      })()
      return () => {
        live = false
      }
    }
    void document.fonts.load(`16px "${family}"`).then(() => {
      if (!live) return
      const context = node.getContext('2d')!
      context.fillStyle = 'black'
      context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'white'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const text = effectiveMask || ' '
      const size = fitTextMaskSize(
        (px) => {
          context.font = `${px}px "${family}"`
          return context.measureText(text).width
        },
        node.width * 0.9,
        node.height * 0.92,
      )
      context.font = `${size}px "${family}"`
      context.fillText(text, node.width / 2, node.height / 2)
    })
    return () => {
      live = false
    }
  }, [effectiveMask, family, isBlank, isIconMode, selectedIconId, iconResults])
  function runFill(clientX: number, clientY: number) {
    const node = maskPreview.current
    if (!node || isBlank) return
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const seedX = Math.floor(((clientX - rect.left) / rect.width) * node.width)
    const seedY = Math.floor(((clientY - rect.top) / rect.height) * node.height)
    if (seedX < 0 || seedY < 0 || seedX >= node.width || seedY >= node.height) return
    const context = node.getContext('2d')!
    const image = context.getImageData(0, 0, node.width, node.height)
    const data = image.data
    const width = node.width
    const height = node.height
    const walls = new Uint8Array(width * height)
    for (let i = 0; i < walls.length; i++) {
      const offset = i * 4
      const luma = (299 * data[offset]! + 587 * data[offset + 1]! + 114 * data[offset + 2]!) / 1000
      walls[i] = data[offset + 3]! >= 128 && luma >= 128 ? 1 : 0
    }
    const filled = computeFillRegion(walls, width, height, seedX, seedY)
    if (!filled) {
      setStatus('Open region — click inside an enclosed area.')
      return
    }
    let painted = 0
    for (let i = 0; i < filled.length; i++) if (filled[i] === 1) painted += 1
    if (painted === 0) {
      setStatus('Nothing to fill here.')
      return
    }
    // Hidden 1px overlap under the anti-aliased wall fringe so the binary
    // fill edge does not leave a hairline seam. The dilated mask is only for
    // rendering; the returned fill logic remains strictly binary.
    const dilated = new Uint8Array(width * height)
    dilated.set(filled)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (filled[y * width + x] !== 1) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            dilated[ny * width + nx] = 1
          }
        }
      }
    }
    // Composite: white fill underneath, original anti-aliased artwork on top.
    // Coverage is derived from the original luma/alpha, so the visual boundary
    // stays the original anti-aliased edge (over black outside, over white
    // inside where the dilated fill hides the binary seam).
    const orig = new Uint8ClampedArray(data)
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4
      const r = orig[offset]!
      const g = orig[offset + 1]!
      const b = orig[offset + 2]!
      const a = orig[offset + 3]!
      const luma = (299 * r + 587 * g + 114 * b) / 1000
      const coverage = (a / 255) * (luma / 255)
      const base = dilated[i] === 1 ? 255 : 0
      const out = Math.round(coverage * 255 + (1 - coverage) * base)
      data[offset] = out
      data[offset + 1] = out
      data[offset + 2] = out
      data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
    setStatus(`Filled ${painted} pixels.`)
    onFillCommit?.(node)
  }
  return (
    <div {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.toolbar)}>
        <button
          {...stylex.props(ui.button, fillActive && ui.fontCardSelected)}
          type="button"
          aria-pressed={fillActive}
          aria-label="Fill region"
          title={isBlank ? 'Blank canvas is already fully selected' : 'Fill an enclosed mask area'}
          disabled={isBlank}
          onClick={() => setFillActive((active) => !active)}
        >
          🪣 Fill
        </button>
      </div>
      {fillActive && !isBlank && (
        <p {...stylex.props(ui.hint)}>Click inside an enclosed area to fill it. Esc exits fill.</p>
      )}
      <div {...stylex.props(styles.wrap)}>
        <canvas
          {...stylex.props(styles.canvas, isBlank && styles.blankCanvas)}
          ref={maskPreview}
          width={600}
          height={600}
          aria-label="Mask text preview"
          style={fillActive ? { cursor: BUCKET_CURSOR } : undefined}
          onClick={(e) => {
            if (fillActive) runFill(e.clientX, e.clientY)
          }}
        />
      </div>
      {status && (
        <p {...stylex.props(ui.hint, ui.status)} role="status">
          {status}
        </p>
      )}
    </div>
  )
}
