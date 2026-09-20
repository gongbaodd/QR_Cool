import { useEffect, useState } from 'react'
import type { Dispatch } from 'react'
import { BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH } from '../../../lib/editor/blank'
import {
  TEXT_MASK_DEFAULT_TEXT,
  TEXT_MASK_FILENAME,
  TEXT_MASK_FONTS,
  defaultTextMaskSize,
  fitTextMaskSize,
  largestWhiteSquare,
} from '../../../lib/editor/text-mask'
import type { IconItem, TextMaskFont } from '../../../lib/editor/text-mask'
import type { Action, Prepared } from '../../../lib/editor/state'

function drawTextMask(width: number, height: number, text: string, family: string, capPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = 'black'
  context.fillRect(0, 0, width, height)
  context.fillStyle = 'white'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const capped = Math.min(capPx, height)
  const size = fitTextMaskSize(
    (px) => {
      context.font = `${px}px "${family}"`
      return context.measureText(text).width
    },
    width * 0.94,
    capped,
  )
  context.font = `${size}px "${family}"`
  context.fillText(text, width / 2, height / 2)
  return canvas
}
function drawBlankMask(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = 'white'
  context.fillRect(0, 0, width, height)
  return canvas
}
function recolorSvgToWhite(svg: string): string {
  return svg
    .replace(/currentColor/g, 'white')
    .replace(/#000000/gi, 'white')
    .replace(/#000\b/gi, 'white')
    .replace(/\bblack\b/gi, 'white')
}
async function drawIconMask(width: number, height: number, svgText: string, capPx: number): Promise<HTMLCanvasElement> {
  const recolored = recolorSvgToWhite(svgText)
  const blob = new Blob([recolored], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const img = new window.Image()
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('icon load failed'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, width, height)
  const naturalW = (img as unknown as { naturalWidth: number }).naturalWidth || img.width || 24
  const naturalH = (img as unknown as { naturalHeight: number }).naturalHeight || img.height || 24
  const maxW = width * 0.8,
    maxH = Math.min(capPx, height) * 0.8
  const scale = Math.min(maxW / naturalW, maxH / naturalH)
  const drawW = naturalW * scale,
    drawH = naturalH * scale
  ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH)
  URL.revokeObjectURL(url)
  return canvas
}

export interface MaskSelectionOptions {
  revision: number
  prepared: Prepared | null
  iconResults: IconItem[]
  suggestedMask: string
  closeGallery: () => void
  onUploadMask: (file: File) => void
  dispatch: Dispatch<Action>
}

export interface MaskSelection {
  text: string
  setText: (value: string) => void
  fontId: string
  font: TextMaskFont
  selectedIconId: string | null
  effectiveMask: string
  isBlank: boolean
  isIconMode: boolean
  busy: boolean
  fit: number | null
  tooSmall: boolean
  selectFont: (fontId: string) => void
  selectIcon: (item: IconItem) => void
}

/**
 * Owns the step-2 mask choice: the search input, the selected font or icon, and
 * the white-on-black canvas that gets uploaded as the region mask.
 */
export function useMaskSelection({
  revision,
  prepared,
  iconResults,
  suggestedMask,
  closeGallery,
  onUploadMask,
  dispatch,
}: MaskSelectionOptions): MaskSelection {
  const [maskText, setMaskText] = useState(TEXT_MASK_DEFAULT_TEXT),
    [maskFontId, setMaskFontId] = useState('blank'),
    [maskBusy, setMaskBusy] = useState(false)
  const [maskFit, setMaskFit] = useState<number | null>(null)
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null)
  const maskFont = TEXT_MASK_FONTS.find((entry) => entry.id === maskFontId) ?? TEXT_MASK_FONTS[0]!
  const effectiveMask = (maskText.trim()[0] || suggestedMask).slice(0, 1).toUpperCase()
  const isBlank = maskFontId === 'blank' && !selectedIconId
  const isIconMode = !!selectedIconId
  async function applyTextMask(fontId = maskFontId) {
    if (maskBusy) return
    setSelectedIconId(null)
    closeGallery()
    const entry = TEXT_MASK_FONTS.find((item) => item.id === fontId) ?? maskFont
    const blank = entry.id === 'blank'
    if (blank) {
      const width = prepared?.width ?? BLANK_POSTER_WIDTH,
        height = prepared?.height ?? BLANK_POSTER_HEIGHT
      const canvas = drawBlankMask(width, height)
      canvas.toBlob((blob) => {
        if (blob) onUploadMask(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
      }, 'image/png')
      return
    }
    const text = effectiveMask
    if (!prepared || !text) return
    setMaskBusy(true)
    try {
      await document.fonts.load(`16px "${entry.family}"`)
      if (!document.fonts.check(`16px "${entry.family}"`)) throw new Error('font unavailable')
    } catch {
      dispatch({
        type: 'error',
        revision,
        message: `Could not load the ${entry.label} mask font. Please retry.`,
        field: 'mask',
      })
      setMaskBusy(false)
      return
    }
    const canvas = drawTextMask(
      prepared.width,
      prepared.height,
      text,
      entry.family,
      defaultTextMaskSize(prepared.width, prepared.height),
    )
    canvas.toBlob((blob) => {
      setMaskBusy(false)
      if (blob) onUploadMask(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
    }, 'image/png')
  }
  async function applyIconMask(item: IconItem) {
    if (maskBusy) return
    if (!prepared) return
    const download = item.download || item.variants[0]?.download
    if (!download) return
    setMaskBusy(true)
    setSelectedIconId(item.id)
    try {
      const svgText = await fetch(download).then((r) => {
        if (!r.ok) throw new Error('svg fetch')
        return r.text()
      })
      const cap = defaultTextMaskSize(prepared.width, prepared.height)
      const canvas = await drawIconMask(prepared.width, prepared.height, svgText, cap)
      canvas.toBlob((blob) => {
        setMaskBusy(false)
        if (blob) onUploadMask(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
      }, 'image/png')
    } catch {
      setMaskBusy(false)
      dispatch({ type: 'error', revision, message: `Could not load icon ${item.name}. Please retry.`, field: 'mask' })
    }
  }
  function selectFont(fontId: string) {
    setMaskFontId(fontId)
    void applyTextMask(fontId)
  }
  function selectIcon(item: IconItem) {
    void applyIconMask(item)
    closeGallery()
  }
  useEffect(() => {
    if (isBlank) {
      setMaskFit(null)
      return
    }
    if (isIconMode) {
      const item = iconResults.find((r) => r.id === selectedIconId)
      const download = item?.download ?? item?.variants[0]?.download
      if (!item || !download || !prepared) {
        setMaskFit(null)
        return
      }
      const current = prepared
      const cap = defaultTextMaskSize(current.width, current.height)
      let live = true
      void fetch(download)
        .then((r) => r.text())
        .then(async (svgText) => {
          if (!live) return
          const canvas = await drawIconMask(current.width, current.height, svgText, cap)
          if (!live) return
          setMaskFit(
            largestWhiteSquare(
              canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
              canvas.width,
              canvas.height,
            ),
          )
        })
        .catch(() => {
          if (live) setMaskFit(null)
        })
      return () => {
        live = false
      }
    }
    const text = effectiveMask
    if (!prepared || !text) {
      setMaskFit(null)
      return
    }
    const current = prepared
    const cap = defaultTextMaskSize(current.width, current.height)
    let live = true
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const canvas = drawTextMask(current.width, current.height, text, maskFont.family, cap)
      setMaskFit(
        largestWhiteSquare(
          canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        ),
      )
    })
    return () => {
      live = false
    }
  }, [prepared, effectiveMask, maskFontId, maskFont.family, isBlank, isIconMode, selectedIconId, iconResults])
  const minMaskSquare = prepared ? prepared.qrMetadata.totalModules * 4 : 0
  const maskTooSmall = !isBlank && maskFit !== null && maskFit < minMaskSquare
  return {
    text: maskText,
    setText: setMaskText,
    fontId: maskFontId,
    font: maskFont,
    selectedIconId,
    effectiveMask,
    isBlank,
    isIconMode,
    busy: maskBusy,
    fit: maskFit,
    tooSmall: maskTooSmall,
    selectFont,
    selectIcon,
  }
}
