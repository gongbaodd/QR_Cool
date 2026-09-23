'use client'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { fitTextMaskSize } from '@/lib/editor/text-mask'
import type { IconItem } from '@/lib/editor/text-mask'
import { fillMaskImageData } from '@/lib/editor/mask-fill'
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
    const painted = fillMaskImageData(image, seedX, seedY)
    if (painted === null) {
      setStatus('Open region — click inside an enclosed area.')
      return
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
