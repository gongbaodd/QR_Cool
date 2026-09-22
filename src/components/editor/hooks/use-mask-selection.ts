import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import { BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH } from '../../../lib/editor/blank'
import {
  DEFAULT_AUTO_MASK,
  DEFAULT_AUTO_MASK_FONT_ID,
  TEXT_MASK_FILENAME,
  TEXT_MASK_FONTS,
  defaultTextMaskSize,
  fitTextMaskSize,
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
  const size = fitTextMaskSize(
    (px) => {
      context.font = `${px}px "${family}"`
      return context.measureText(text).width
    },
    width * 0.94,
    Math.min(capPx, height),
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
  const url = URL.createObjectURL(new Blob([recolorSvgToWhite(svgText)], { type: 'image/svg+xml' }))
  const image = new window.Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('icon load failed'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = 'black'
    context.fillRect(0, 0, width, height)
    const naturalWidth = (image as unknown as { naturalWidth: number }).naturalWidth || image.width || 24
    const naturalHeight = (image as unknown as { naturalHeight: number }).naturalHeight || image.height || 24
    const scale = Math.min((width * 0.8) / naturalWidth, (Math.min(capPx, height) * 0.8) / naturalHeight)
    const drawWidth = naturalWidth * scale
    const drawHeight = naturalHeight * scale
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface MaskSelectionOptions {
  revision: number
  prepared: Prepared | null
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
  selectedIcon: IconItem | null
  effectiveMask: string
  isBlank: boolean
  isIconMode: boolean
  origin: 'auto' | 'manual'
  isFollowingInput: boolean
  busy: boolean
  selectFont: (fontId: string) => void
  selectIcon: (item: IconItem) => void
  followInput: () => void
  markManualFill: () => void
  whenSettled: () => Promise<void>
}

/** Reactive automatic/manual mask controller. */
export function useMaskSelection({
  revision,
  prepared,
  suggestedMask,
  closeGallery,
  onUploadMask,
  dispatch,
}: MaskSelectionOptions): MaskSelection {
  const [origin, setOrigin] = useState<'auto' | 'manual'>('auto')
  const [maskText, setMaskText] = useState(DEFAULT_AUTO_MASK)
  const [maskFontId, setMaskFontId] = useState('blank')
  const [selectedIcon, setSelectedIcon] = useState<IconItem | null>(null)
  const [maskBusy, setMaskBusy] = useState(false)
  const token = useRef(0)
  const lastSignature = useRef('')
  const waiters = useRef<Array<() => void>>([])
  const maskFont = TEXT_MASK_FONTS.find((entry) => entry.id === maskFontId) ?? TEXT_MASK_FONTS[1]!
  const effectiveMask = (origin === 'auto' ? suggestedMask : maskText).trim().slice(0, 1).toUpperCase()
  const isBlank = maskFontId === 'blank' && !selectedIcon
  const isIconMode = !!selectedIcon
  const width = prepared?.width ?? BLANK_POSTER_WIDTH
  const height = prepared?.height ?? BLANK_POSTER_HEIGHT

  useEffect(() => {
    if (!maskBusy) for (const resolve of waiters.current.splice(0)) resolve()
  }, [maskBusy])

  const renderMask = useCallback(
    async (nextOrigin: 'auto' | 'manual', text: string, fontId: string, icon: IconItem | null) => {
      const entry = TEXT_MASK_FONTS.find((item) => item.id === fontId) ?? TEXT_MASK_FONTS[1]!
      const signature = [nextOrigin, text, entry.id, icon?.id ?? '', width, height].join('|')
      if (signature === lastSignature.current) return
      lastSignature.current = signature
      const currentToken = ++token.current
      setMaskBusy(true)
      closeGallery()
      try {
        let canvas: HTMLCanvasElement
        if (entry.id === 'blank') {
          canvas = drawBlankMask(width, height)
        } else if (icon) {
          const download = icon.download || icon.variants[0]?.download
          if (!download) throw new Error('icon unavailable')
          const svg = await fetch(download).then((response) => {
            if (!response.ok) throw new Error('svg fetch')
            return response.text()
          })
          canvas = await drawIconMask(width, height, svg, defaultTextMaskSize(width, height))
        } else {
          await document.fonts.load(`16px "${entry.family}"`)
          if (!document.fonts.check(`16px "${entry.family}"`)) throw new Error('font unavailable')
          canvas = drawTextMask(
            width,
            height,
            text || DEFAULT_AUTO_MASK,
            entry.family,
            defaultTextMaskSize(width, height),
          )
        }
        if (currentToken !== token.current) return
        await new Promise<void>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob && currentToken === token.current)
              onUploadMask(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
            resolve()
          }, 'image/png')
        })
      } catch {
        if (currentToken === token.current)
          dispatch({
            type: 'error',
            revision,
            message: `Could not load the ${entry.label} mask. Please retry.`,
            field: 'mask',
          })
      } finally {
        if (currentToken === token.current) setMaskBusy(false)
      }
    },
    [closeGallery, dispatch, height, onUploadMask, revision, width],
  )

  useEffect(() => {
    if (origin === 'auto')
      void renderMask(
        'auto',
        suggestedMask || DEFAULT_AUTO_MASK,
        suggestedMask ? DEFAULT_AUTO_MASK_FONT_ID : 'blank',
        null,
      )
  }, [origin, renderMask, suggestedMask])

  function setText(value: string) {
    const next = value.slice(0, 10)
    setOrigin('manual')
    setMaskText(next)
    setSelectedIcon(null)
    void renderMask('manual', next, maskFontId, null)
  }
  function selectFont(fontId: string) {
    const nextText = effectiveMask || DEFAULT_AUTO_MASK
    setOrigin('manual')
    setMaskText(nextText)
    setMaskFontId(fontId)
    setSelectedIcon(null)
    void renderMask('manual', nextText, fontId, null)
  }
  function selectIcon(item: IconItem) {
    setOrigin('manual')
    setMaskText(effectiveMask || DEFAULT_AUTO_MASK)
    setSelectedIcon(item)
    void renderMask('manual', effectiveMask || DEFAULT_AUTO_MASK, maskFontId, item)
    closeGallery()
  }
  function followInput() {
    setOrigin('auto')
    setMaskText(suggestedMask || DEFAULT_AUTO_MASK)
    setMaskFontId(suggestedMask ? DEFAULT_AUTO_MASK_FONT_ID : 'blank')
    setSelectedIcon(null)
    void renderMask(
      'auto',
      suggestedMask || DEFAULT_AUTO_MASK,
      suggestedMask ? DEFAULT_AUTO_MASK_FONT_ID : 'blank',
      null,
    )
  }
  function markManualFill() {
    setOrigin('manual')
    setMaskText(effectiveMask)
    setSelectedIcon(null)
    lastSignature.current = `fill|${revision}|${width}|${height}`
  }
  function whenSettled() {
    if (!maskBusy) return Promise.resolve()
    return new Promise<void>((resolve) => waiters.current.push(resolve))
  }
  return {
    text: origin === 'auto' ? effectiveMask : maskText,
    setText,
    fontId: maskFontId,
    font: maskFont,
    selectedIconId: selectedIcon?.id ?? null,
    selectedIcon,
    effectiveMask,
    isBlank,
    isIconMode,
    origin,
    isFollowingInput: origin === 'auto',
    busy: maskBusy,
    selectFont,
    selectIcon,
    followInput,
    markManualFill,
    whenSettled,
  }
}
