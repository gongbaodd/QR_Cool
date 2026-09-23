'use client'
import { useEffect, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'
import { fillMaskImageData } from '@/lib/editor/mask-fill'

const styles = stylex.create({
  canvas: { display: 'block', maxWidth: '100%', maxHeight: 560, objectFit: 'contain' },
})

/** Poster preview with the selected region highlighted, without preparing a QR. */
export default function RegionPreview({
  poster,
  mask,
  fillActive,
  onFillCommit,
  onFillStatus,
}: {
  poster: string
  mask: string
  fillActive: boolean
  onFillCommit: (mask: Blob) => void
  onFillStatus: (message: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const fillJobRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !poster || !mask) return
    let live = true
    fillJobRef.current += 1
    const posterImage = new Image()
    const maskImage = new Image()
    let loaded = 0

    const draw = () => {
      loaded += 1
      if (loaded !== 2 || !live || !canvas) return
      const width = posterImage.naturalWidth
      const height = posterImage.naturalHeight
      if (!width || !height || maskImage.naturalWidth !== width || maskImage.naturalHeight !== height) return

      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return
      const maskSurface = document.createElement('canvas')
      maskSurface.width = width
      maskSurface.height = height
      const maskContext = maskSurface.getContext('2d', { willReadFrequently: true })
      if (!maskContext) return
      maskContext.drawImage(maskImage, 0, 0)
      maskCanvasRef.current = maskSurface

      const redraw = () => {
        if (!live) return
        context.drawImage(posterImage, 0, 0)
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
      }
      redrawRef.current = redraw
      redraw()
    }

    posterImage.onload = draw
    maskImage.onload = draw
    posterImage.src = poster
    maskImage.src = mask
    return () => {
      live = false
      fillJobRef.current += 1
      redrawRef.current = null
      maskCanvasRef.current = null
      posterImage.onload = null
      maskImage.onload = null
    }
  }, [mask, poster])

  function fillAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!canvas || !maskCanvas || !fillActive) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const seedX = Math.floor(((clientX - rect.left) / rect.width) * maskCanvas.width)
    const seedY = Math.floor(((clientY - rect.top) / rect.height) * maskCanvas.height)
    const context = maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const image = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const painted = fillMaskImageData(image, seedX, seedY)
    if (painted === null) {
      onFillStatus('Open region — click inside an enclosed area.')
      return
    }
    context.putImageData(image, 0, 0)
    redrawRef.current?.()
    const job = ++fillJobRef.current
    maskCanvas.toBlob((blob) => {
      if (job !== fillJobRef.current) return
      if (blob) {
        onFillCommit(blob)
        onFillStatus(`Filled ${painted} pixels.`)
      } else {
        onFillStatus('Could not save the filled mask. Try again.')
      }
    }, 'image/png')
  }

  return (
    <canvas
      ref={canvasRef}
      {...stylex.props(styles.canvas)}
      role="img"
      aria-label={fillActive ? 'Poster with selected region highlighted; click an enclosed area to fill it' : 'Poster with selected region highlighted'}
      style={fillActive ? { cursor: 'crosshair' } : undefined}
      onClick={(event) => fillAt(event.clientX, event.clientY)}
    />
  )
}
