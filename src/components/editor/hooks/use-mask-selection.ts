import { useCallback, useEffect, useRef, useState } from 'react'
import { BLANK_POSTER_HEIGHT as DEFAULT_HEIGHT, BLANK_POSTER_WIDTH as DEFAULT_WIDTH } from '@/lib/editor/blank'
import {
  DEFAULT_AUTO_MASK,
  DEFAULT_AUTO_MASK_FONT_ID,
  TEXT_MASK_FILENAME,
  TEXT_MASK_FONTS,
  defaultTextMaskSize,
  fitTextMaskSize,
} from '@/lib/editor/text-mask'
import type { IconItem, TextMaskFont } from '@/lib/editor/text-mask'
import { MAX_IMAGE_BYTES } from '@/lib/editor/schema'
import { parsePngHeader } from '@/lib/editor/png-guard'
import { isSelectedMaskPixel } from '@/core/mask'
import { useEditorStore, useEditorStoreApi } from '@/components/editor/EditorStoreProvider'
import { selectEffectiveMask, selectMaskFont, selectSuggestedMask } from '@/lib/editor/selectors'

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
  closeGallery?: () => void
}

export interface MaskSelection {
  text: string
  setText: (value: string) => void
  fontId: string
  font: TextMaskFont
  selectedIconId: string | null
  selectedIcon: IconItem | null
  selection: 'auto' | 'font' | 'icon' | 'custom'
  customFileName: string | null
  effectiveMask: string
  origin: 'auto' | 'manual'
  busy: boolean
  uploading: boolean
  uploadError: string | null
  setUploadError: (message: string | null) => void
  selectFont: (fontId: string) => void
  selectIcon: (item: IconItem) => void
  selectCustomMask: (file: File) => Promise<void>
}

/** Reactive automatic/manual mask controller. */
export function useMaskSelection({ closeGallery }: MaskSelectionOptions): MaskSelection {
  const store = useEditorStoreApi()
  const origin = useEditorStore((state) => state.maskSelection.origin)
  const maskText = useEditorStore((state) => state.maskSelection.text)
  const maskFontId = useEditorStore((state) => state.maskSelection.fontId)
  const selectedIcon = useEditorStore((state) => state.maskSelection.selectedIcon)
  const selection = useEditorStore((state) => state.maskSelection.selection)
  const maskBusy = useEditorStore((state) => state.maskSelection.busy)
  const customFileName = useEditorStore((state) =>
    state.maskSelection.selection === 'custom' ? (state.sources.mask?.name ?? null) : null,
  )
  const prepared = useEditorStore((state) => state.document.prepared)
  const suggestedMask = useEditorStore(selectSuggestedMask)
  const maskFont = useEditorStore(selectMaskFont)
  const effectiveMask = useEditorStore(selectEffectiveMask)
  const token = useRef(0)
  const uploadToken = useRef(0)
  const lastSignature = useRef('')
  const mounted = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const width = prepared?.width ?? DEFAULT_WIDTH
  const height = prepared?.height ?? DEFAULT_HEIGHT

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      token.current += 1
      uploadToken.current += 1
      lastSignature.current = ''
      store.getState().actions.setMaskBusy(false)
    }
  }, [store])

  const renderMask = useCallback(
    async (nextOrigin: 'auto' | 'manual', text: string, fontId: string, icon: IconItem | null) => {
      uploadToken.current += 1
      setUploadError(null)
      const entry = TEXT_MASK_FONTS.find((item) => item.id === fontId) ?? TEXT_MASK_FONTS[1]!
      const signature = [nextOrigin, text, entry.id, icon?.id ?? '', width, height].join('|')
      if (signature === lastSignature.current) return
      lastSignature.current = signature
      const currentToken = ++token.current
      store.getState().actions.setMaskBusy(true)
      ;(closeGallery ?? store.getState().actions.closeGallery)()
      try {
        let canvas: HTMLCanvasElement
        if (icon) {
          const download = icon.download || icon.variants[0]?.download
          if (!download) throw new Error('icon unavailable')
          const svg = await fetch(download).then((response) => {
            if (!response.ok) throw new Error('svg fetch')
            return response.text()
          })
          canvas = await drawIconMask(width, height, svg, defaultTextMaskSize(width, height))
        } else if (entry.id === 'blank') {
          canvas = drawBlankMask(width, height)
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
              store.getState().actions.replaceMask(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }))
            resolve()
          }, 'image/png')
        })
      } catch {
        if (currentToken === token.current) {
          lastSignature.current = ''
          const currentRevision = store.getState().document.revision
          store
            .getState()
            .actions.failEngine(
              currentRevision,
              `Could not load the ${icon ? 'selected icon' : entry.label} mask. Please retry.`,
              'mask',
            )
        }
      } finally {
        if (currentToken === token.current) store.getState().actions.setMaskBusy(false)
      }
    },
    [closeGallery, height, store, width],
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
    store.getState().actions.setMaskText(next)
    void renderMask('manual', next, maskFontId, null)
  }
  function selectFont(fontId: string) {
    const nextText = effectiveMask || DEFAULT_AUTO_MASK
    store.getState().actions.selectMaskFont(fontId)
    void renderMask('manual', nextText, fontId, null)
  }
  function selectIcon(item: IconItem) {
    store.getState().actions.selectMaskIcon(item)
    void renderMask('manual', effectiveMask || DEFAULT_AUTO_MASK, maskFontId, item)
    ;(closeGallery ?? store.getState().actions.closeGallery)()
  }

  const selectCustomMask = useCallback(
    async (file: File) => {
      const currentUpload = ++uploadToken.current
      setUploading(true)
      setUploadError(null)
      const posterAtStart = store.getState().sources.poster
      try {
        if (file.size > MAX_IMAGE_BYTES) throw new Error('Choose a mask PNG no larger than 10 MiB.')
        const [maskBytes, posterBytes] = await Promise.all([
          file.arrayBuffer(),
          posterAtStart?.arrayBuffer() ?? Promise.resolve(null),
        ])
        if (currentUpload !== uploadToken.current || !mounted.current) return
        const maskDimensions = parsePngHeader(new Uint8Array(maskBytes), 'mask')
        const posterDimensions = posterBytes
          ? parsePngHeader(new Uint8Array(posterBytes), 'poster')
          : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
        if (maskDimensions.width !== posterDimensions.width || maskDimensions.height !== posterDimensions.height) {
          throw new Error(
            `Mask dimensions must match the poster (${posterDimensions.width} × ${posterDimensions.height}px).`,
          )
        }

        const bitmap = await createImageBitmap(file)
        let hasSelectedPixels = false
        try {
          if (bitmap.width !== maskDimensions.width || bitmap.height !== maskDimensions.height)
            throw new Error('The PNG dimensions could not be read consistently. Choose another mask file.')
          const canvas = document.createElement('canvas')
          canvas.width = maskDimensions.width
          canvas.height = maskDimensions.height
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) throw new Error('This browser could not read the mask image.')
          context.drawImage(bitmap, 0, 0)
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
          for (let offset = 0; offset < data.length; offset += 4) {
            if (isSelectedMaskPixel(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!)) {
              hasSelectedPixels = true
              break
            }
          }
        } finally {
          bitmap.close()
        }
        if (!hasSelectedPixels) throw new Error('This mask has no opaque white pixels to select a region.')

        const currentSources = store.getState().sources
        const samePoster = currentSources.poster === posterAtStart
        const initializedBlankPoster =
          posterAtStart === null && currentSources.poster !== null && currentSources.transparentBlank
        if (currentUpload !== uploadToken.current || !mounted.current) return
        if (!samePoster && !initializedBlankPoster)
          throw new Error('The poster changed while checking this mask. Choose the mask again.')
        token.current += 1
        lastSignature.current = ''
        store.getState().actions.selectCustomMask(file)
      } catch (cause) {
        if (currentUpload === uploadToken.current && mounted.current) {
          setUploadError(cause instanceof Error ? cause.message : 'Could not read this mask PNG.')
        }
      } finally {
        if (mounted.current) setUploading(false)
      }
    },
    [store],
  )
  return {
    // Keep the editable mask text defaulted to A even while empty automatic
    // content uses the blank full-canvas mask visually.
    text: origin === 'auto' ? effectiveMask || DEFAULT_AUTO_MASK : maskText,
    setText,
    fontId: maskFontId,
    font: maskFont,
    selectedIconId: selectedIcon?.id ?? null,
    selectedIcon,
    selection,
    customFileName,
    effectiveMask,
    origin,
    busy: maskBusy,
    uploading,
    uploadError,
    setUploadError,
    selectFont,
    selectIcon,
    selectCustomMask,
  }
}
