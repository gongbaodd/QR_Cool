'use client'
import dynamic from 'next/dynamic'
import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import { BLANK_MASK_FILENAME, BLANK_POSTER_FILENAME, BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH, buildBlankMaskRgba, buildBlankPosterRgba } from '../../lib/editor/blank'
import { TEXT_MASK_DEFAULT_TEXT, TEXT_MASK_FILENAME, TEXT_MASK_FONTS, TEXT_MASK_MAX_LENGTH, defaultTextMaskSize, deriveMaskLetter, fitTextMaskSize, largestWhiteSquare } from '../../lib/editor/text-mask'
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
  const [maskText, setMaskText] = useState(TEXT_MASK_DEFAULT_TEXT), [maskFontId, setMaskFontId] = useState(TEXT_MASK_FONTS[0]!.id), [maskSize, setMaskSize] = useState<number | null>(null), [maskBusy, setMaskBusy] = useState(false)
  const [maskFit, setMaskFit] = useState<number | null>(null)
  const maskPreview = useRef<HTMLCanvasElement | null>(null)
  const maskFont = TEXT_MASK_FONTS.find(entry => entry.id === maskFontId) ?? TEXT_MASK_FONTS[0]!
  const contentCheck = contentSchema.safeParse(state.content)
  const contentError = !contentCheck.success ? contentCheck.error.issues[0]!.message : state.field === 'content' ? state.error : null
  const suggestedMask = deriveMaskLetter(state.content)
  const effectiveMask = (maskText.trim() || suggestedMask).slice(0, TEXT_MASK_MAX_LENGTH)
  const isBlank = maskFontId === 'blank'
  useEffect(() => {
    const node = maskPreview.current
    if (!node) return
    let live = true
    if (isBlank) {
      const context = node.getContext('2d')!
      context.fillStyle = 'white'; context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'black'; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.font = '14px sans-serif'
      context.fillText('blank — full canvas', node.width / 2, node.height / 2)
      return () => { live = false }
    }
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const context = node.getContext('2d')!
      context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
      const text = effectiveMask || ' '
      const size = fitTextMaskSize(px => { context.font = `${px}px "${maskFont.family}"`; return context.measureText(text).width }, node.width * 0.9, 44)
      context.font = `${size}px "${maskFont.family}"`
      context.fillText(text, node.width / 2, node.height / 2)
    })
    return () => { live = false }
  }, [effectiveMask, maskFontId, maskFont.family, isBlank])
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
  async function applyTextMask() {
    if (maskBusy) return
    if (isBlank) {
      const prepared = state.prepared
      const width = prepared?.width ?? BLANK_POSTER_WIDTH, height = prepared?.height ?? BLANK_POSTER_HEIGHT
      const canvas = drawBlankMask(width, height)
      canvas.toBlob(blob => { if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' })) }, 'image/png')
      return
    }
    const prepared = state.prepared, text = effectiveMask
    if (!prepared || !text) return
    const font = maskFont
    setMaskBusy(true)
    try {
      await document.fonts.load(`16px "${font.family}"`)
      if (!document.fonts.check(`16px "${font.family}"`)) throw new Error('font unavailable')
    } catch {
      dispatch({ type: 'error', revision: state.revision, message: `Could not load the ${font.label} mask font. Please retry.`, field: 'mask' })
      setMaskBusy(false)
      return
    }
    const canvas = drawTextMask(prepared.width, prepared.height, text, font.family, maskSize ?? defaultTextMaskSize(prepared.width, prepared.height))
    canvas.toBlob(blob => { setMaskBusy(false); if (blob) uploadMaskFile(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' })) }, 'image/png')
  }
  useEffect(() => {
    if (isBlank) { setMaskFit(null); return }
    const prepared = state.prepared, text = effectiveMask
    if (!prepared || !text) { setMaskFit(null); return }
    const cap = maskSize ?? defaultTextMaskSize(prepared.width, prepared.height)
    let live = true
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const canvas = drawTextMask(prepared.width, prepared.height, text, maskFont.family, cap)
      setMaskFit(largestWhiteSquare(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height))
    })
    return () => { live = false }
  }, [state.prepared, effectiveMask, maskSize, maskFontId, maskFont.family, isBlank])
  const minMaskSquare = state.prepared ? state.prepared.qrMetadata.totalModules * 4 : 0
  const maskTooSmall = !isBlank && maskFit !== null && maskFit < minMaskSquare
  const maskAtMax = !!state.prepared && (maskSize ?? defaultTextMaskSize(state.prepared.width, state.prepared.height)) >= state.prepared.height
  const ready = !!state.prepared && state.prepared.revision === state.revision && !state.error && !state.busy && contentCheck.success
  const move = (box: Placement) => edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared!.qrMetadata.totalModules) } })
  const steps = ['Input text', 'select mask', 'Adjust QR', 'Generate']
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
    if (suggestedMask && maskText.trim() !== suggestedMask) setMaskText(suggestedMask)
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
    </aside></div> : <div className="workspace"><aside>
      <div className="panel-heading"><span className="eyebrow">POSTER STUDIO · STEP {step} OF 4</span><h1>Make the code<br />part of the art.</h1></div>
      {step === 2 && <section><h2><span>02</span> select mask</h2>
          <canvas ref={maskPreview} width={276} height={76} aria-label="Mask text preview" style={{ width: '100%', borderRadius: 6, background: 'black' }} /><label>Mask letter<input aria-label="Mask text" value={maskText} maxLength={TEXT_MASK_MAX_LENGTH} disabled={isBlank} onChange={e => setMaskText(e.target.value.slice(-TEXT_MASK_MAX_LENGTH))} /></label>{suggestedMask ? <p className="hint">Suggested letter <strong>{suggestedMask}</strong> from your link.{!isBlank && maskText.trim() !== suggestedMask && <button className="text-button" onClick={() => setMaskText(suggestedMask)}>Use suggested letter</button>}</p> : <p className="hint">Plain text uses a blank region — pick any letter or keep the full canvas.</p>}<div className="font-row" role="radiogroup" aria-label="Mask font">{TEXT_MASK_FONTS.map(entry => { const selected = entry.id === maskFontId; const glyph = isBlank ? '' : (effectiveMask || 'A'); const isBlankEntry = entry.id === 'blank'; return <button key={entry.id} type="button" role="radio" aria-checked={selected} aria-label={`Mask font ${entry.label}`} title={entry.label} onClick={() => setMaskFontId(entry.id)} className={selected ? 'font-card selected' : 'font-card'}>{isBlankEntry ? <><span className="font-glyph" style={{ fontSize: 14 }}>blank</span><span className="font-name">{entry.label}</span></> : <><span className="font-glyph" style={{ fontFamily: `"${entry.family}"` }}>{glyph}</span><span className="font-name">{entry.label}</span></>}</button> })}</div>{!isBlank && maskFont.note && <p className="hint">{maskFont.label}: {maskFont.note}</p>}<label>Mask text size (px)<input aria-label="Mask text size" type="number" min={8} max={state.prepared ? state.prepared.height : undefined} value={maskSize ?? (state.prepared ? defaultTextMaskSize(state.prepared.width, state.prepared.height) : '')} disabled={isBlank || !state.prepared} onChange={e => setMaskSize(Math.max(8, Math.round(Number(e.target.value))))} /></label><button disabled={maskBusy || (!isBlank && (!effectiveMask || maskTooSmall))} onClick={() => void applyTextMask()}>{maskBusy ? 'Drawing mask…' : isBlank ? 'Use blank mask' : 'Use letter as mask'}</button>{maskTooSmall && <p className="error" role="alert">{maskAtMax ? 'This letter leaves no room for the QR even at full height. Use a wider letter.' : 'This letter leaves no room for the QR at this size. Enlarge the size or use a wider letter.'}</p>}<div className="step-nav"><button onClick={() => goto(1)}>Back</button><button className="primary" disabled={!state.prepared} onClick={() => goto(3)}>Continue</button></div>
      </section>}
      {step === 3 && <section><h2><span>03</span> Adjust QR</h2><p className="file-meta">Encoding: {state.content || '—'}</p><button className="text-button" onClick={() => goto(1)}>Change text</button><div className="coordinates">{(['x','y','size'] as const).map(key => <label key={key}>{key === 'size' ? 'Size' : key.toUpperCase()}<input aria-label={key === 'size' ? 'QR size' : `QR ${key.toUpperCase()}`} type="number" step={key === 'size' ? state.prepared?.qrMetadata.totalModules ?? 1 : 1} value={state.placement?.[key] ?? ''} disabled={!state.prepared} onChange={e => move({ ...state.placement!, [key]: Number(e.target.value) })} /></label>)}</div><button className="text-button" disabled={!poster || !contentCheck.success} onClick={() => edit({ type: 'edit', patch: { placement: null } })}>Reset to automatic placement</button><p className="hint">Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.</p>
      <details className="advanced"><summary>Pattern settings</summary><label>Seed<input type="number" min={0} max={4294967295} value={state.settings.seed} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) } } })} /></label><button onClick={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}>New pattern</button><label>Finder margin<select value={state.settings.qrMargin} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, qrMargin: Number(e.target.value) as 1 | 2 } } })}><option value={1}>1 module</option><option value={2}>2 modules</option></select></label><label>Marker corners<select value={state.settings.plateCorners} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, plateCorners: e.target.value as 'light' | 'texture' } } })}><option value="texture">Continue texture</option><option value="light">Keep light</option></select></label></details>
      <div className="step-nav"><button onClick={() => goto(2)}>Back</button><button className="primary" disabled={!ready} onClick={() => { void request('assemble'); setStep(4) }}>{state.busy === 'assemble' ? 'Assembling…' : 'Continue to generate'}</button></div></section>}
      {step === 4 && <section><h2><span>04</span> Generate</h2>
      <div className="assemble-controls"><button className="primary" disabled={!ready && !state.result} onClick={() => void request('assemble')}>{state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}</button><div aria-live="polite" role="status">{state.busy === 'prepare' && 'Checking region and QR placement…'}{state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}</div></div>
      {state.error && state.field !== 'content' && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
      <div className="step-nav"><button onClick={() => { dispatch({ type: 'view', result: false }); goto(3) }}>Back to adjust</button></div></section>}
      {state.error && state.field !== 'content' && step !== 4 && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
    </aside><div className="preview-panel"><div className="preview-heading"><div><span className="eyebrow">{state.showingResult ? 'FINISHED POSTER' : 'PREVIEW'}</span><h2>{state.showingResult ? 'Ready for the real world.' : 'Place your QR inside the region.'}</h2></div>{state.prepared && <span className="badge">{state.prepared.width} × {state.prepared.height}</span>}</div>
      {state.showingResult && state.result ? <div className="result"><img src={artifacts['poster.png']} alt="Assembled artistic QR poster" /><div className="result-actions"><a className="primary" href={artifacts['poster.png']} download="poster.png">Download poster.png</a><button onClick={() => dispatch({ type: 'view', result: false })}>Return to editing</button></div><p className="scan-note">Artistic margins can affect scanning. Test the downloaded poster with your phone.</p><details><summary>Artifacts & verification</summary><div className="downloads">{Object.keys(state.result.artifacts).filter(name => name !== 'poster.png').map(name => <a key={name} href={artifacts[name]} download={name}>{name}</a>)}</div></details></div> : state.prepared && state.placement && posterUrl ? <Canvas mask={previews['region.png'] ?? ''} poster={posterUrl} overlay={previews['mask.png'] ?? ''} qr={previews['qr.png'] ?? ''} width={state.prepared.width} height={state.prepared.height} placement={state.placement} modules={state.prepared.qrMetadata.totalModules} onChange={move} invalid={!!state.error} /> : <div className="empty"><div className="empty-icon">＋</div><h3>Your poster goes here</h3><p>Pick a canvas and place your QR.</p></div>}
      <div className="workspace-note"><span>Original dimensions. Precise placement.</span><span>Pixels outside your region stay untouched.</span></div>
    </div></div>}
  </main>
}
