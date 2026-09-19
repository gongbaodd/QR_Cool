'use client'
import dynamic from 'next/dynamic'
import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import { BLANK_MASK_FILENAME, BLANK_POSTER_FILENAME, BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH, buildBlankMaskRgba, buildBlankPosterRgba } from '../../lib/editor/blank'
import { TEXT_MASK_DEFAULT_TEXT, TEXT_MASK_FILENAME, TEXT_MASK_FONTS, TEXT_MASK_MAX_LENGTH, defaultTextMaskSize, deriveMaskLetter, fitTextMaskSize, largestWhiteSquare, searchControlState } from '../../lib/editor/text-mask'
import type { IconItem } from '../../lib/editor/text-mask'
import type { Placement } from '../../lib/editor/schema'
const Canvas = dynamic(() => import('./Canvas'), { ssr: false })
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
function drawTextMask(width: number, height: number, text: string, family: string, capPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = 'black'; context.fillRect(0, 0, width, height)
  context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
  const capped = Math.min(capPx, height)
  const size = fitTextMaskSize(px => { context.font = `${px}px "${family}"`; return context.measureText(text).width }, width * 0.94, capped)
  context.font = `${size}px "${family}"`
  context.fillText(text, width / 2, height / 2)
  return canvas
}
function drawBlankMask(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = 'white'; context.fillRect(0, 0, width, height)
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
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('icon load failed')); img.src = url })
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'black'; ctx.fillRect(0, 0, width, height)
  const naturalW = (img as unknown as { naturalWidth: number }).naturalWidth || img.width || 24
  const naturalH = (img as unknown as { naturalHeight: number }).naturalHeight || img.height || 24
  const maxW = width * 0.94, maxH = Math.min(capPx, height * 0.94)
  const scale = Math.min(maxW / naturalW, maxH / naturalH, 1)
  const drawW = naturalW * scale, drawH = naturalH * scale
  ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH)
  URL.revokeObjectURL(url)
  return canvas
}
function blobFromBase64(value: string, type: string) { return new Blob([Uint8Array.from(atob(value), c => c.charCodeAt(0))], { type }) }
function useBlobUrls(values: Record<string, string>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = JSON.stringify(values)
  useEffect(() => { const next = Object.fromEntries(Object.entries(JSON.parse(key) as Record<string, string>).map(([name, bytes]) => [name, URL.createObjectURL(blobFromBase64(bytes, name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : 'image/png'))])); setUrls(next); return () => Object.values(next).forEach(URL.revokeObjectURL) }, [key])
  return urls
}
export default function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [step, setStep] = useState(1)
  const [textConfirmed, setTextConfirmed] = useState(false)
  const [poster, setPoster] = useState<File | null>(null), [mask, setMask] = useState<File | null>(null), [posterUrl, setPosterUrl] = useState('')
  const [maskText, setMaskText] = useState(TEXT_MASK_DEFAULT_TEXT), [maskFontId, setMaskFontId] = useState('blank'), [maskBusy, setMaskBusy] = useState(false)
  const [maskFit, setMaskFit] = useState<number | null>(null)
  const [iconResults, setIconResults] = useState<IconItem[]>([])
  const [iconTotal, setIconTotal] = useState(0)
  const [iconLoading, setIconLoading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)
  const [fetchedQuery, setFetchedQuery] = useState('')
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null)
  const [galleryMode, setGalleryMode] = useState(false)

  const maskPreview = useRef<HTMLCanvasElement | null>(null)
  const maskFont = TEXT_MASK_FONTS.find(entry => entry.id === maskFontId) ?? TEXT_MASK_FONTS[0]!
  useEffect(() => {
    if (step !== 2 || typeof document === 'undefined' || !('fonts' in document)) return
    for (const entry of TEXT_MASK_FONTS) {
      if (!entry.family) continue
      void document.fonts.load(`34px "${entry.family}"`).catch(() => {})
    }
  }, [step])
  const contentCheck = contentSchema.safeParse(state.content)
  const contentError = !contentCheck.success ? contentCheck.error.issues[0]!.message : state.field === 'content' ? state.error : null
  const suggestedMask = deriveMaskLetter(state.content)
  const effectiveMask = (maskText.trim()[0] || suggestedMask).slice(0, 1).toUpperCase()
  const isBlank = maskFontId === 'blank' && !selectedIconId
  const isIconMode = !!selectedIconId
  const searchQuery = maskText.trim()
  const searchState = searchControlState(searchQuery, fetchedQuery, iconResults.length)
  const searchQueryRef = useRef(searchQuery)
  searchQueryRef.current = searchQuery
  useEffect(() => {
    const node = maskPreview.current
    if (!node) return
    let live = true
    if (galleryMode) return () => { live = false }
    if (isBlank) {
      const context = node.getContext('2d')!
      context.fillStyle = 'white'; context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'black'; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.font = `${Math.max(14, Math.round(node.width * 0.032))}px sans-serif`
      context.fillText('blank — full canvas', node.width / 2, node.height / 2)
      return () => { live = false }
    }
    if (isIconMode) {
      const item = iconResults.find(r => r.id === selectedIconId)
      const download = item?.download ?? item?.variants[0]?.download
      if (!download) {
        const context = node.getContext('2d')!
        context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
        context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
        context.font = `${Math.max(14, Math.round(node.width * 0.032))}px sans-serif`
        context.fillText('icon', node.width / 2, node.height / 2)
        return () => { live = false }
      }
      void (async () => {
        try {
          const svgText = await fetch(download).then(r => { if (!r.ok) throw new Error('svg fetch'); return r.text() })
          if (!live) return
          const recolored = recolorSvgToWhite(svgText)
          const blob = new Blob([recolored], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          const img = new window.Image()
          await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = url })
          if (!live) { URL.revokeObjectURL(url); return }
          const context = node.getContext('2d')!
          context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
          const nw = (img as unknown as { naturalWidth:number }).naturalWidth || img.width || 24
          const nh = (img as unknown as { naturalHeight:number }).naturalHeight || img.height || 24
          const scale = Math.min(node.width * 0.9 / nw, node.height * 0.92 / nh, 1)
          const dw = nw * scale, dh = nh * scale
          context.drawImage(img, (node.width - dw)/2, (node.height - dh)/2, dw, dh)
          URL.revokeObjectURL(url)
        } catch {
          if (!live) return
          const context = node.getContext('2d')!
          context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
        }
      })()
      return () => { live = false }
    }
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const context = node.getContext('2d')!
      context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
      const text = effectiveMask || ' '
      const size = fitTextMaskSize(px => { context.font = `${px}px "${maskFont.family}"`; return context.measureText(text).width }, node.width * 0.9, node.height * 0.92)
      context.font = `${size}px "${maskFont.family}"`
      context.fillText(text, node.width / 2, node.height / 2)
    })
    return () => { live = false }
  }, [effectiveMask, maskFontId, maskFont.family, isBlank, isIconMode, selectedIconId, iconResults, galleryMode])
  // One request per clicked term, cached for that term only. Returns whether icons came back.
  async function fetchIconsForQuery(query: string): Promise<boolean> {
    setIconLoading(true); setIconError(null)
    try {
      const res = await fetch(`/api/icons?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error('search failed')
      const data = await res.json() as { total:number; count:number; items: IconItem[] }
      const items = data.items ?? []
      setIconResults(items); setIconTotal(data.total ?? items.length); setFetchedQuery(query)
      return items.length > 0
    } catch {
      setIconError('Could not search icons.'); setIconResults([]); setIconTotal(0); setFetchedQuery(query)
      return false
    } finally { setIconLoading(false) }
  }
  // The combined search/more control: one click searches a new term and shows the
  // results, reopens the gallery for a cached term, and stays put on an empty input.
  async function handleSearchClick() {
    const query = searchQuery
    if (maskBusy || iconLoading) return
    if (!query) { setGalleryMode(false); return }
    if (fetchedQuery === query && iconResults.length > 0) { setGalleryMode(true); return }
    const found = await fetchIconsForQuery(query)
    // A response for an abandoned term never opens a stale gallery.
    if (found && searchQueryRef.current === query) setGalleryMode(true)
  }
  // Typing never searches; it only closes the gallery so no stale results are shown.
  useEffect(() => {
    if (galleryMode) setGalleryMode(false)
  }, [maskText]) // eslint-disable-line react-hooks/exhaustive-deps
  // Entering step 2 re-derives the control from the input and starts on the mask preview.
  useEffect(() => { setGalleryMode(false) }, [step])
  const abort = useRef<AbortController | null>(null), latest = useRef(state)
  latest.current = state
  const previews = useBlobUrls(state.prepared ? { 'mask.png': state.prepared.overlay, 'region.png': state.prepared.mask, 'qr.png': state.prepared.qr } : {})
  const artifacts = useBlobUrls(state.result?.artifacts ?? {})
  useEffect(() => { if (!poster) return; const url = URL.createObjectURL(poster); setPosterUrl(url); return () => URL.revokeObjectURL(url) }, [poster])
  function edit(patch: Parameters<typeof reducer>[1] & { type: 'edit' }) { abort.current?.abort(); if (patch.patch.content !== undefined) setTextConfirmed(false); dispatch(patch) }
  async function request(mode: 'prepare' | 'assemble', automatic = false) {
    if (!poster || poster.size > MAX_IMAGE_BYTES || (mask && mask.size > MAX_IMAGE_BYTES) || !contentSchema.safeParse(latest.current.content).success) return
    abort.current?.abort()
    const controller = new AbortController(); abort.current = controller
    const current = latest.current
    dispatch({ type: 'busy', mode, revision: current.revision })
    const form = new FormData(); form.set('poster', poster); if (mask) form.set('mask', mask)
    form.set('data', JSON.stringify({ revision: current.revision, content: current.content, settings: current.settings, ...(!automatic && current.placement ? { placement: current.placement, ...(mode === 'prepare' && current.prepared ? { previousTotalModules: current.prepared.qrMetadata.totalModules } : {}) } : {}) }))
    try {
      const response = await fetch(`/api/${mode}`, { method: 'POST', body: form, signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(data.message), { field: data.field })
      dispatch({ type: mode === 'prepare' ? 'prepared' : 'result', data })
    } catch (error) { if (!controller.signal.aborted) dispatch({ type: 'error', revision: current.revision, message: error instanceof Error ? error.message : 'Request failed. Please retry.', ...(error && typeof error === 'object' && 'field' in error && typeof error.field === 'string' ? { field: error.field } : {}) }) }
  }
  useEffect(() => { if (!poster) return; const timer = setTimeout(() => { void request('prepare') }, 450); return () => { clearTimeout(timer); abort.current?.abort() } }, [state.revision, poster, mask]) // Responses never increment the revision.
  function uploadMaskFile(file: File | undefined) {
    if (!file) return
    setMask(file); edit({ type: 'edit', patch: {}, reset: true })
    if (file.size > MAX_IMAGE_BYTES) dispatch({ type: 'error', revision: state.revision + 1, message: 'Each PNG must be 10 MiB or smaller.', field: 'mask' })
  }
  function ensureBlankPoster() {
    if (poster) return
    const width = BLANK_POSTER_WIDTH, height = BLANK_POSTER_HEIGHT
    const posterCanvas = document.createElement('canvas')
    posterCanvas.width = width; posterCanvas.height = height
    posterCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buildBlankPosterRgba(width, height)), width, height), 0, 0)
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width; maskCanvas.height = height
    maskCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buildBlankMaskRgba(width, height)), width, height), 0, 0)
    posterCanvas.toBlob(posterBlob => {
      maskCanvas.toBlob(maskBlob => {
        if (!posterBlob || !maskBlob) return
        abort.current?.abort()
        setPoster(new File([posterBlob], BLANK_POSTER_FILENAME, { type: 'image/png' }))
        setMask(new File([maskBlob], BLANK_MASK_FILENAME, { type: 'image/png' }))
        dispatch({ type: 'edit', patch: { settings: { ...latest.current.settings, seed: freshSeed() } }, reset: true })
      }, 'image/png')
    }, 'image/png')
  }
  useEffect(() => { if (step === 2) ensureBlankPoster() }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (textConfirmed && !poster) ensureBlankPoster() }, [textConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps
  async function applyTextMask(fontId = maskFontId) {
    if (maskBusy) return
    setSelectedIconId(null)
    setGalleryMode(false)
    const entry = TEXT_MASK_FONTS.find(item => item.id === fontId) ?? maskFont
    const blank = entry.id === 'blank'
    if (blank) {
      const prepared = state.prepared
      const width = prepared?.width ?? BLANK_POSTER_WIDTH, height = prepared?.height ?? BLANK_POSTER_HEIGHT
      const canvas = drawBlankMask(width, height)
      canvas.toBlob(blob => { if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' })) }, 'image/png')
      return
    }
    const prepared = state.prepared, text = effectiveMask
    if (!prepared || !text) return
    setMaskBusy(true)
    try {
      await document.fonts.load(`16px "${entry.family}"`)
      if (!document.fonts.check(`16px "${entry.family}"`)) throw new Error('font unavailable')
    } catch {
      dispatch({ type: 'error', revision: state.revision, message: `Could not load the ${entry.label} mask font. Please retry.`, field: 'mask' })
      setMaskBusy(false)
      return
    }
    const canvas = drawTextMask(prepared.width, prepared.height, text, entry.family, defaultTextMaskSize(prepared.width, prepared.height))
    canvas.toBlob(blob => { setMaskBusy(false); if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' })) }, 'image/png')
  }
  async function applyIconMask(item: IconItem) {
    if (maskBusy) return
    const prepared = state.prepared
    if (!prepared) return
    const download = item.download || item.variants[0]?.download
    if (!download) return
    setMaskBusy(true)
    setSelectedIconId(item.id)
    try {
      const svgText = await fetch(download).then(r => { if (!r.ok) throw new Error('svg fetch'); return r.text() })
      const cap = defaultTextMaskSize(prepared.width, prepared.height)
      const canvas = await drawIconMask(prepared.width, prepared.height, svgText, cap)
      canvas.toBlob(blob => { setMaskBusy(false); if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' })) }, 'image/png')
    } catch {
      setMaskBusy(false)
      dispatch({ type: 'error', revision: state.revision, message: `Could not load icon ${item.name}. Please retry.`, field: 'mask' })
    }
  }
  function handleGallerySelect(idx: number) {
    const item = iconResults[idx]
    if (!item) return
    void applyIconMask(item)
    setGalleryMode(false)
  }
  useEffect(() => {
    if (isBlank) { setMaskFit(null); return }
    if (isIconMode) {
      const item = iconResults.find(r => r.id === selectedIconId)
      const download = item?.download ?? item?.variants[0]?.download
      if (!item || !download || !state.prepared) { setMaskFit(null); return }
      const cap = defaultTextMaskSize(state.prepared.width, state.prepared.height)
      let live = true
      void fetch(download).then(r => r.text()).then(async svgText => {
        if (!live) return
        const canvas = await drawIconMask(state.prepared!.width, state.prepared!.height, svgText, cap)
        if (!live) return
        setMaskFit(largestWhiteSquare(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height))
      }).catch(() => { if (live) setMaskFit(null) })
      return () => { live = false }
    }
    const prepared = state.prepared, text = effectiveMask
    if (!prepared || !text) { setMaskFit(null); return }
    const cap = defaultTextMaskSize(prepared.width, prepared.height)
    let live = true
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const canvas = drawTextMask(prepared.width, prepared.height, text, maskFont.family, cap)
      setMaskFit(largestWhiteSquare(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height))
    })
    return () => { live = false }
  }, [state.prepared, effectiveMask, maskFontId, maskFont.family, isBlank, isIconMode, selectedIconId, iconResults])
  const minMaskSquare = state.prepared ? state.prepared.qrMetadata.totalModules * 4 : 0
  const maskTooSmall = !isBlank && maskFit !== null && maskFit < minMaskSquare
  const ready = !!state.prepared && state.prepared.revision === state.revision && !state.error && !state.busy && contentCheck.success
  const move = (box: Placement) => edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared!.qrMetadata.totalModules) } })
  const steps = ['Input text', 'Mask Search', 'Adjust QR', 'Generate']
  const canEnter = (index: number) => {
    if (index <= 1) return true
    if (index >= 2 && (!textConfirmed || !contentCheck.success)) return false
    if (index === 2) return true
    if (index === 3) return !!poster
    if (index === 4) return !!state.prepared && !!state.placement
    return !!state.prepared
  }
  function goto(index: number) { if (index >= 1 && index <= 4 && canEnter(index)) setStep(index) }
  function continueFromText() {
    if (!contentCheck.success) return
    if (suggestedMask && (maskText.trim()[0] ?? '') !== suggestedMask) setMaskText(suggestedMask)
    setTextConfirmed(true)
    ensureBlankPoster()
    setStep(2)
  }
  useEffect(() => { if (state.showingResult) setStep(4) }, [state.showingResult])
  return <main>
    <header><a href="/" className="wordmark">QR<span> / </span>COOL</a><span className="header-note">The artistic poster editor</span><span className="local-note">No account. No saved uploads.</span></header>
    <ol className="steps" aria-label="Poster steps">{steps.map((label, i) => {
      const index = i + 1
      return <li key={label} aria-current={step === index ? 'step' : undefined}><button disabled={!canEnter(index)} onClick={() => goto(index)}><span>Step {index}</span> {label}</button></li>
    })}</ol>
    {step === 1 ? <div className="workspace-centered"><aside>
      <div className="panel-heading"><span className="eyebrow">POSTER STUDIO · STEP 1 OF 4</span><h1>Make the code<br />part of the art.</h1></div>
      <section><h2><span>01</span> Input text</h2><label htmlFor="content">Text or URL</label><textarea id="content" rows={2} value={state.content} aria-invalid={!!contentError} aria-describedby={contentError ? 'content-error' : 'content-hint'} onChange={e => edit({ type: 'edit', patch: { content: e.target.value } })} />{contentError ? <p id="content-error" className="error">{contentError}</p> : <p id="content-hint" className="hint">One line. Links are encoded exactly as entered.</p>}{!contentError && (suggestedMask ? <p className="hint">Website detected — step 2 will suggest <strong>{suggestedMask}</strong> as the mask letter.</p> : <p className="hint">Plain text — step 2 starts from a blank full-canvas region.</p>)}<div className="step-nav"><button className="primary" disabled={!contentCheck.success} onClick={continueFromText}>Continue</button></div>
      </section>
      {state.error && state.field !== 'content' && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
    </aside></div> : <div className={step === 2 ? "workspace workspace-step2" : "workspace"}><aside>
      <div className="panel-heading"><span className="eyebrow">POSTER STUDIO · STEP {step} OF 4</span><h1>Make the code<br />part of the art.</h1></div>
      {step === 2 && <section><h2><span>02</span> Mask Search</h2>
          <label htmlFor="maskSearch">Mask Search<input id="maskSearch" aria-label="Mask search" aria-describedby="mask-search-hint" value={maskText} maxLength={TEXT_MASK_MAX_LENGTH} placeholder="Search icons or type a letter…" onChange={e => setMaskText(e.target.value.slice(0, TEXT_MASK_MAX_LENGTH))} /></label><span id="mask-search-compat" style={{display:'none'}}><label htmlFor="maskSearch">Mask text</label></span>
          {suggestedMask ? <p id="mask-search-hint" className="hint">Suggested letter <strong>{suggestedMask}</strong> from your link.{!isBlank && !isIconMode && (maskText.trim()[0] ?? '') !== suggestedMask && <button className="text-button" onClick={() => setMaskText(suggestedMask)}>Use suggested letter</button>}</p> : <p id="mask-search-hint" className="hint">Plain text uses a blank region — pick any letter or search icons.</p>}
          {iconLoading && <p className="hint" role="status">Searching icons…</p>}
          {iconError && fetchedQuery === searchQuery && <p className="error" role="alert">{iconError}</p>}
          {!iconLoading && !iconError && fetchedQuery === searchQuery && fetchedQuery && iconResults.length === 0 && <p className="hint">No icons found for “{fetchedQuery}”. Try another term.</p>}
          {!iconLoading && fetchedQuery === searchQuery && fetchedQuery && iconResults.length > 0 && <p className="hint">Found {iconTotal || iconResults.length} icons for “{fetchedQuery}”.</p>}
          <div className="font-row" role="radiogroup" aria-label="Mask options">{TEXT_MASK_FONTS.map(entry => { const isBlankEntry = entry.id === 'blank'; const selected = !selectedIconId && maskFontId === entry.id; const glyph = effectiveMask || 'A'; const disabled = maskBusy || (!isBlankEntry && !effectiveMask); return <button key={entry.id} type="button" role="radio" aria-checked={selected} aria-label={`Mask font ${entry.label}`} title={entry.label} disabled={disabled} onClick={() => { setMaskFontId(entry.id); void applyTextMask(entry.id) }} className={selected ? 'font-card selected' : 'font-card'}>{isBlankEntry ? <><span className="font-glyph" style={{ fontSize: 14 }}>blank</span><span className="font-name">{entry.label}</span></> : <><span className="font-glyph" style={{ fontFamily: `"${entry.family}", sans-serif` }}>{glyph}</span><span className="font-name">{entry.label}</span></>}</button> })}</div>
          <div style={{ marginTop: 10 }}><button aria-label="More icons" title={searchState === 'idle' ? 'Type a letter or word to search icons' : searchState === 'more' ? `Show ${iconTotal || iconResults.length} icons for ${searchQuery}` : `Search icons for ${searchQuery}`} disabled={maskBusy || iconLoading} onClick={() => { void handleSearchClick() }} className={galleryMode ? 'font-card selected' : 'font-card'} style={{ width: '100%' }}><span className="font-glyph" style={{ fontSize: 16 }}>{iconLoading ? '⋯ searching…' : searchState === 'more' ? `⋯ more — ${iconTotal || iconResults.length} icons` : searchState === 'idle' ? '⋯ search icons' : `⋯ search ${searchQuery.slice(0, 10)}`}</span><span className="font-name">{iconLoading ? 'searching' : searchState === 'more' ? 'more icons' : 'search'}</span></button>{searchState === 'idle' && !iconLoading && <p className="hint">Type a letter or word to search icons.</p>}</div>
          {!isBlank && !isIconMode && maskFont.note && <p className="hint">{maskFont.label}: {maskFont.note}</p>}
          {maskBusy && <p className="hint" role="status">Drawing mask…</p>}
          {maskTooSmall && <p className="error" role="alert">This {isIconMode ? 'icon' : 'letter'} leaves no room for the QR even at full height. Use a wider {isIconMode ? 'icon' : 'letter'}.</p>}
          <div className="step-nav"><button onClick={() => goto(1)}>Back</button><button className="primary" disabled={!state.prepared} onClick={() => goto(3)}>Continue</button></div>
      </section>}
      {step === 3 && <section><h2><span>03</span> Adjust QR</h2><p className="file-meta">Encoding: {state.content || '—'}</p><button className="text-button" onClick={() => goto(1)}>Change text</button><div className="coordinates">{(['x','y','size'] as const).map(key => <label key={key}>{key === 'size' ? 'Size' : key.toUpperCase()}<input aria-label={key === 'size' ? 'QR size' : `QR ${key.toUpperCase()}`} type="number" step={key === 'size' ? state.prepared?.qrMetadata.totalModules ?? 1 : 1} value={state.placement?.[key] ?? ''} disabled={!state.prepared} onChange={e => move({ ...state.placement!, [key]: Number(e.target.value) })} /></label>)}</div><button className="text-button" disabled={!poster || !contentCheck.success} onClick={() => edit({ type: 'edit', patch: { placement: null } })}>Reset to automatic placement</button><p className="hint">Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.</p>
      <details className="advanced"><summary>Pattern settings</summary><label>Seed<input type="number" min={0} max={4294967295} value={state.settings.seed} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) } } })} /></label><button onClick={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}>New pattern</button><label>Finder margin<span className="hint">1 module (fixed)</span></label><label>Marker corners<select value={state.settings.plateCorners} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, plateCorners: e.target.value as 'light' | 'texture' } } })}><option value="texture">Continue texture</option><option value="light">Keep light</option></select></label><label>Rim thickness<select value={state.settings.rimModules} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, rimModules: Number(e.target.value) } } })}>{[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n} module{n!==1?'s':''}</option>)}</select></label><label>Round rim<input type="checkbox" checked={state.settings.rimRounded} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, rimRounded: e.target.checked } } })} /> antialiased</label></details>
      <div className="step-nav"><button onClick={() => goto(2)}>Back</button><button className="primary" disabled={!ready} onClick={() => { void request('assemble'); setStep(4) }}>{state.busy === 'assemble' ? 'Assembling…' : 'Continue to generate'}</button></div></section>}
      {step === 4 && <section><h2><span>04</span> Generate</h2>
      <div className="assemble-controls"><button className="primary" disabled={!ready && !state.result} onClick={() => void request('assemble')}>{state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}</button><div aria-live="polite" role="status">{state.busy === 'prepare' && 'Checking region and QR placement…'}{state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}</div></div>
      {state.error && state.field !== 'content' && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
      <div className="step-nav"><button onClick={() => { dispatch({ type: 'view', result: false }); goto(3) }}>Back to adjust</button></div></section>}
      {state.error && state.field !== 'content' && step !== 4 && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
    </aside><div className="preview-panel"><div className="preview-heading"><div><span className="eyebrow">{state.showingResult ? 'FINISHED POSTER' : step === 2 ? 'MASK PREVIEW' : 'PREVIEW'}</span><h2>{state.showingResult ? 'Ready for the real world.' : step === 2 ? 'Preview your mask region.' : 'Place your QR inside the region.'}</h2></div>{state.prepared && <span className="badge">{state.prepared.width} × {state.prepared.height}</span>}</div>
      {state.showingResult && state.result ? <div className="result"><img src={artifacts['poster.png']} alt="Assembled artistic QR poster" /><div className="result-actions"><a className="primary" href={artifacts['poster.png']} download="poster.png">Download poster.png</a><button onClick={() => dispatch({ type: 'view', result: false })}>Return to editing</button></div><p className="scan-note">Artistic margins can affect scanning. Test the downloaded poster with your phone.</p><details><summary>Artifacts & verification</summary><div className="downloads">{Object.keys(state.result.artifacts).filter(name => name !== 'poster.png').map(name => <a key={name} href={artifacts[name]} download={name}>{name}</a>)}</div></details></div> : step === 2 ? galleryMode ? <div className="mask-preview-wrap mask-gallery-wrap" style={{ border: '2.5px solid var(--ink)', borderRadius: 'var(--sketch-card)', overflow: 'hidden', background: 'var(--card)', boxShadow: 'var(--shadow-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}><h3 style={{ margin:0, fontSize:18 }}>Icons for “{maskText.trim()}” — {iconTotal || iconResults.length}</h3><button className="text-button" onClick={() => setGalleryMode(false)}>Back to preview</button></div><div className="gallery-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(72px,1fr))', gap:10, overflow:'auto', maxHeight: 560, padding: 4 }}>{iconResults.map((item, idx) => { const thumb = item.download || item.variants[0]?.download; const selected = selectedIconId === item.id; return <button key={item.id} type="button" aria-label={`Gallery icon ${item.name}`} title={`${item.vendor}/${item.name}`} onClick={() => handleGallerySelect(idx)} className={selected ? 'font-card selected' : 'font-card'} style={{ minHeight: 84 }}><span className="font-glyph" style={{ background:'black', borderRadius:6, width:44, height:44, display:'grid', placeItems:'center', color:'white' }}><span aria-hidden="true" style={{ fontSize:20 }}>{(item.name || '?').slice(0,1).toUpperCase()}</span><img src={thumb} alt="" width={28} height={28} style={{ filter:'invert(1)', objectFit:'contain', marginTop:-34 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} /></span><span className="font-name">{item.name}</span></button> })}{iconResults.length===0 && <p className="hint">No icons to show.</p>}</div></div> : <div className="mask-preview-wrap" style={{ border: '2.5px solid var(--ink)', borderRadius: 'var(--sketch-card)', overflow: 'hidden', background: 'var(--paper)', boxShadow: 'var(--shadow-lg)', padding: 18, display: 'flex', justifyContent: 'center', alignItems: 'center' }}><canvas ref={maskPreview} width={600} height={600} aria-label="Mask text preview" style={{ width: '100%', maxWidth: 560, aspectRatio: '1 / 1', borderRadius: 12, background: 'black' }} /></div> : state.prepared && state.placement && posterUrl ? <Canvas mask={previews['region.png'] ?? ''} poster={posterUrl} overlay={previews['mask.png'] ?? ''} qr={previews['qr.png'] ?? ''} width={state.prepared.width} height={state.prepared.height} placement={state.placement} modules={state.prepared.qrMetadata.totalModules} onChange={move} invalid={!!state.error} /> : <div className="empty"><div className="empty-icon">＋</div><h3>Your poster goes here</h3><p>Pick a canvas and place your QR.</p></div>}
      <div className="workspace-note"><span>Original dimensions. Precise placement.</span><span>Pixels outside your region stay untouched.</span></div>
    </div></div>}
  </main>
}
