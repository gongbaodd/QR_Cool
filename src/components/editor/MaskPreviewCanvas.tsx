'use client'
import { useEffect, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'
import { fitTextMaskSize } from '../../lib/editor/text-mask'
import type { IconItem } from '../../lib/editor/text-mask'
import { tokens } from '../../styles/tokens.stylex'

const styles = stylex.create({
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
})

export interface MaskPreviewCanvasProps {
  effectiveMask: string
  family: string
  isBlank: boolean
  isIconMode: boolean
  iconResults: IconItem[]
  selectedIconId: string | null
}

/** Step 2's white-on-black mask preview, mirroring the uploaded mask canvas. */
export default function MaskPreviewCanvas({
  effectiveMask,
  family,
  isBlank,
  isIconMode,
  iconResults,
  selectedIconId,
}: MaskPreviewCanvasProps) {
  const maskPreview = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const node = maskPreview.current
    if (!node) return
    let live = true
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
          const scale = Math.min((node.width * 0.9) / nw, (node.height * 0.92) / nh, 1)
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
  return (
    <div {...stylex.props(styles.wrap)}>
      <canvas
        {...stylex.props(styles.canvas)}
        ref={maskPreview}
        width={600}
        height={600}
        aria-label="Mask text preview"
      />
    </div>
  )
}
