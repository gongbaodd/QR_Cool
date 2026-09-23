'use client'
import { useEffect, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  canvas: { display: 'block', maxWidth: '100%', maxHeight: 560, objectFit: 'contain' },
})

/** Poster preview with the selected region highlighted, without preparing a QR. */
export default function RegionPreview({ poster, mask }: { poster: string; mask: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !poster || !mask) return
    let live = true
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
      context.drawImage(posterImage, 0, 0)

      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = width
      maskCanvas.height = height
      const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })
      if (!maskContext) return
      maskContext.drawImage(maskImage, 0, 0)
      const pixels = maskContext.getImageData(0, 0, width, height).data
      const overlay = context.createImageData(width, height)
      for (let pixel = 0; pixel < width * height; pixel++) {
        const offset = pixel * 4
        const brightness = Math.round(
          (299 * pixels[offset]! + 587 * pixels[offset + 1]! + 114 * pixels[offset + 2]!) / 1000,
        )
        if (pixels[offset + 3]! < 128 || brightness < 128)
          continue
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

    posterImage.onload = draw
    maskImage.onload = draw
    posterImage.src = poster
    maskImage.src = mask
    return () => {
      live = false
      posterImage.onload = null
      maskImage.onload = null
    }
  }, [mask, poster])

  return <canvas ref={canvasRef} {...stylex.props(styles.canvas)} role="img" aria-label="Poster with selected region highlighted" />
}
