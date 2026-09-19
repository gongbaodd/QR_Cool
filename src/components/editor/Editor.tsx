'use client'
import dynamic from 'next/dynamic'
import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import { BLANK_MASK_FILENAME, BLANK_POSTER_FILENAME, BLANK_POSTER_HEIGHT, BLANK_POSTER_WIDTH, buildBlankMaskRgba, buildBlankPosterRgba } from '../../lib/editor/blank'
import { TEXT_MASK_DEFAULT_TEXT, TEXT_MASK_FILENAME, TEXT_MASK_FONTS, defaultTextMaskSize, fitTextMaskSize, largestWhiteSquare } from '../../lib/editor/text-mask'
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
  const [blankWidth, setBlankWidth] = useState(BLANK_POSTER_WIDTH), [blankHeight, setBlankHeight] = useState(BLANK_POSTER_HEIGHT)
  const [poster, setPoster] = useState<File | null>(null), [mask, setMask] = useState<File | null>(null), [posterUrl, setPosterUrl] = useState('')
  const [maskText, setMaskText] = useState(TEXT_MASK_DEFAULT_TEXT), [maskFontId, setMaskFontId] = useState(TEXT_MASK_FONTS[0]!.id), [maskSize, setMaskSize] = useState<number | null>(null), [maskBusy, setMaskBusy] = useState(false)
  const [maskFit, setMaskFit] = useState<number | null>(null)
  const maskPreview = useRef<HTMLCanvasElement | null>(null)
  const maskFont = TEXT_MASK_FONTS.find(entry => entry.id === maskFontId) ?? TEXT_MASK_FONTS[0]!
  useEffect(() => {
    const node = maskPreview.current
    if (!node) return
    let live = true
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const context = node.getContext('2d')!
      context.fillStyle = 'black'; context.fillRect(0, 0, node.width, node.height)
      context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
      const text = maskText.trim() || ' '
      const size = fitTextMaskSize(px => { context.font = `${px}px "${maskFont.family}"`; return context.measureText(text).width }, node.width * 0.9, 44)
      context.font = `${size}px "${maskFont.family}"`
      context.fillText(text, node.width / 2, node.height / 2)
    })
    return () => { live = false }
  }, [maskText, maskFontId, maskFont.family])
  const abort = useRef<AbortController | null>(null), latest = useRef(state)
  latest.current = state
  const previews = useBlobUrls(state.prepared ? { 'mask.png': state.prepared.overlay, 'region.png': state.prepared.mask, 'qr.png': state.prepared.qr } : {})
  const artifacts = useBlobUrls(state.result?.artifacts ?? {})
  const contentCheck = contentSchema.safeParse(state.content)
  const contentError = !contentCheck.success ? contentCheck.error.issues[0]!.message : state.field === 'content' ? state.error : null
  useEffect(() => { if (!poster) return; const url = URL.createObjectURL(poster); setPosterUrl(url); return () => URL.revokeObjectURL(url) }, [poster])
  function edit(patch: Parameters<typeof reducer>[1] & { type: 'edit' }) { abort.current?.abort(); dispatch(patch) }
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
  function upload(file: File | undefined, kind: 'poster' | 'mask') {
    if (!file) return
    if (kind === 'poster') { setPoster(file); setMask(null); edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } }, reset: true }) }
    else { setMask(file); edit({ type: 'edit', patch: {}, reset: true }) }
    if (file.size > MAX_IMAGE_BYTES) dispatch({ type: 'error', revision: state.revision + 1, message: 'Each PNG must be 10 MiB or smaller.', field: kind })
  }
  function useBlankCanvas() {
    const width = Math.max(64, Math.min(2000, Math.round(blankWidth) || BLANK_POSTER_WIDTH))
    const height = Math.max(64, Math.min(2000, Math.round(blankHeight) || BLANK_POSTER_HEIGHT))
    if (width * height > 4000000) {
      dispatch({ type: 'error', revision: state.revision, message: 'Blank canvas must be 4 megapixels or smaller.', field: 'poster' })
      return
    }
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
  async function applyTextMask() {
    const prepared = state.prepared, text = maskText.trim()
    if (!prepared || !text || maskBusy) return
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
    canvas.toBlob(blob => { setMaskBusy(false); if (blob) upload(new File([blob], TEXT_MASK_FILENAME, { type: 'image/png' }), 'mask') }, 'image/png')
  }
  useEffect(() => {
    const prepared = state.prepared, text = maskText.trim()
    if (!prepared || !text) { setMaskFit(null); return }
    const cap = maskSize ?? defaultTextMaskSize(prepared.width, prepared.height)
    let live = true
    void document.fonts.load(`16px "${maskFont.family}"`).then(() => {
      if (!live) return
      const canvas = drawTextMask(prepared.width, prepared.height, text, maskFont.family, cap)
      setMaskFit(largestWhiteSquare(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height))
    })
    return () => { live = false }
  }, [state.prepared, maskText, maskSize, maskFontId, maskFont.family])
  const minMaskSquare = state.prepared ? state.prepared.qrMetadata.totalModules * 4 : 0
  const maskTooSmall = maskFit !== null && maskFit < minMaskSquare
  const maskAtMax = !!state.prepared && (maskSize ?? defaultTextMaskSize(state.prepared.width, state.prepared.height)) >= state.prepared.height
  const ready = !!state.prepared && state.prepared.revision === state.revision && !state.error && !state.busy && contentCheck.success
  const move = (box: Placement) => edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared!.qrMetadata.totalModules) } })
  const steps = ['Blank size', 'Mask or poster', 'Adjust QR', 'Generate']
  const canEnter = (index: number) => {
    if (index <= 1) return true
    if (index === 2) return !!poster
    if (index === 3) return !!state.prepared && !!state.placement
    return !!state.prepared
  }
  function goto(index: number) { if (index >= 1 && index <= 4 && canEnter(index)) setStep(index) }
  useEffect(() => { if (poster && step === 1) setStep(2) }, [poster, step])
  useEffect(() => { if (state.showingResult) setStep(4) }, [state.showingResult])
  return <main>
    <header><a href="/" className="wordmark">QR<span> / </span>COOL</a><span className="header-note">The artistic poster editor</span><span className="local-note">No account. No saved uploads.</span></header>
    <ol className="steps" aria-label="Poster steps">{steps.map((label, i) => {
      const index = i + 1
      return <li key={label} aria-current={step === index ? 'step' : undefined}><button disabled={!canEnter(index)} onClick={() => goto(index)}><span>Step {index}</span> {label}</button></li>
    })}</ol>
    <div className="workspace"><aside>
      <div className="panel-heading"><span className="eyebrow">POSTER STUDIO · STEP {step} OF 4</span><h1>Make the code<br />part of the art.</h1></div>
      {step === 1 && <section><h2><span>01</span> Blank size</h2><div className="coordinates"><label>Width<input aria-label="Blank width" type="number" min={64} max={2000} value={blankWidth} onChange={e => setBlankWidth(Math.round(Number(e.target.value)))} /></label><label>Height<input aria-label="Blank height" type="number" min={64} max={2000} value={blankHeight} onChange={e => setBlankHeight(Math.round(Number(e.target.value)))} /></label></div><p className="hint">White canvas size in pixels, up to 4 megapixels total. The whole canvas becomes the region.</p><button onClick={() => { useBlankCanvas(); setStep(2) }}>Use blank canvas</button><p className="hint">Or upload a poster PNG instead — you will continue at step 2.</p><label className="upload">Poster PNG<input aria-label="Poster PNG" type="file" accept="image/png" onChange={e => { upload(e.target.files?.[0], 'poster'); }} /></label><p className="hint">Use a poster with a solid black region. PNG · up to 10 MiB and 4 megapixels.</p>{poster && <p className="file-meta">{poster.name}{state.prepared && ` · ${state.prepared.width} × ${state.prepared.height} px`}</p>}<div className="step-nav"><button className="primary" disabled={!poster} onClick={() => goto(2)}>Continue</button></div>
      </section>}
      {step === 2 && <section><h2><span>02</span> Mask or poster</h2><label className="upload">Poster PNG<input aria-label="Poster PNG" type="file" accept="image/png" onChange={e => upload(e.target.files?.[0], 'poster')} /></label>{poster && <p className="file-meta">{poster.name}{state.prepared && ` · ${state.prepared.width} × ${state.prepared.height} px`}</p>}<p className="hint">Optional same-size PNG mask. White selects the region; black excludes it. Without a mask the dense black shape is detected automatically.</p><label>Region mask PNG<input type="file" accept="image/png" aria-label="Region mask PNG" onChange={e => upload(e.target.files?.[0], 'mask')} /></label>{mask && <p className="file-meta">Mask: {mask.name}</p>}{mask && <button onClick={() => { setMask(null); edit({ type: 'edit', patch: {}, reset: true }) }}>Use automatic detection</button>}
          <p className="hint">Or draw the region from a word in a display font.</p><canvas ref={maskPreview} width={276} height={76} aria-label="Mask text preview" style={{ width: '100%', borderRadius: 6, background: 'black' }} /><p className="hint">Supports A–Z, a–z, 0–9 and punctuation.</p><label>Mask text<input aria-label="Mask text" value={maskText} maxLength={24} disabled={!state.prepared} onChange={e => setMaskText(e.target.value)} /></label><label>Mask font<select aria-label="Mask font" value={maskFontId} disabled={!state.prepared} onChange={e => setMaskFontId(e.target.value)}>{TEXT_MASK_FONTS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Mask text size (px)<input aria-label="Mask text size" type="number" min={8} max={state.prepared ? state.prepared.height : undefined} value={maskSize ?? (state.prepared ? defaultTextMaskSize(state.prepared.width, state.prepared.height) : '')} disabled={!state.prepared} onChange={e => setMaskSize(Math.max(8, Math.round(Number(e.target.value))))} /></label><button disabled={!state.prepared || !maskText.trim() || maskBusy || maskTooSmall} onClick={() => void applyTextMask()}>{maskBusy ? 'Drawing mask…' : 'Use text as mask'}</button>{maskTooSmall && <p className="error" role="alert">{maskAtMax ? 'This word leaves no room for the QR even at full height. Use fewer letters.' : 'This word leaves no room for the QR at this size. Enlarge the size or use fewer letters.'}</p>}{!state.prepared && <p className="hint">Upload a poster or use blank canvas first.</p>}<div className="step-nav"><button onClick={() => goto(1)}>Back</button><button className="primary" disabled={!state.prepared} onClick={() => goto(3)}>Continue</button></div>
      </section>}
      {step === 3 && <section><h2><span>03</span> Adjust QR with the mask</h2><label htmlFor="content">Text or URL</label><textarea id="content" rows={2} value={state.content} aria-invalid={!!contentError} aria-describedby={contentError ? 'content-error' : 'content-hint'} onChange={e => edit({ type: 'edit', patch: { content: e.target.value } })} />{contentError ? <p id="content-error" className="error">{contentError}</p> : <p id="content-hint" className="hint">One line. Links are encoded exactly as entered.</p>}<div className="coordinates">{(['x','y','size'] as const).map(key => <label key={key}>{key === 'size' ? 'Size' : key.toUpperCase()}<input aria-label={key === 'size' ? 'QR size' : `QR ${key.toUpperCase()}`} type="number" step={key === 'size' ? state.prepared?.qrMetadata.totalModules ?? 1 : 1} value={state.placement?.[key] ?? ''} disabled={!state.prepared} onChange={e => move({ ...state.placement!, [key]: Number(e.target.value) })} /></label>)}</div><button className="text-button" disabled={!poster || !contentCheck.success} onClick={() => edit({ type: 'edit', patch: { placement: null } })}>Reset to automatic placement</button><p className="hint">Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.</p>
      <details className="advanced"><summary>Pattern settings</summary><label>Seed<input type="number" min={0} max={4294967295} value={state.settings.seed} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) } } })} /></label><button onClick={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}>New pattern</button><label>Finder margin<select value={state.settings.qrMargin} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, qrMargin: Number(e.target.value) as 1 | 2 } } })}><option value={1}>1 module</option><option value={2}>2 modules</option></select></label><label>Marker corners<select value={state.settings.plateCorners} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, plateCorners: e.target.value as 'light' | 'texture' } } })}><option value="texture">Continue texture</option><option value="light">Keep light</option></select></label></details>
      <div className="step-nav"><button onClick={() => goto(2)}>Back</button><button className="primary" disabled={!ready} onClick={() => { void request('assemble'); setStep(4) }}>{state.busy === 'assemble' ? 'Assembling…' : 'Continue to generate'}</button></div></section>}
      {step === 4 && <section><h2><span>04</span> Generate</h2>
      <div className="assemble-controls"><button className="primary" disabled={!ready && !state.result} onClick={() => void request('assemble')}>{state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}</button><div aria-live="polite" role="status">{state.busy === 'prepare' && 'Checking region and QR placement…'}{state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}</div></div>
      {state.error && state.field !== 'content' && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
      <div className="step-nav"><button onClick={() => { dispatch({ type: 'view', result: false }); goto(3) }}>Back to adjust</button></div></section>}
      {state.error && state.field !== 'content' && step !== 4 && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
    </aside><div className="preview-panel"><div className="preview-heading"><div><span className="eyebrow">{state.showingResult ? 'FINISHED POSTER' : 'LIVE WORKSPACE'}</span><h2>{state.showingResult ? 'Ready for the real world.' : 'A little code. A lot of character.'}</h2></div>{state.prepared && <span className="badge">{state.prepared.width} × {state.prepared.height}</span>}</div>
      {state.showingResult && state.result ? <div className="result"><img src={artifacts['poster.png']} alt="Assembled artistic QR poster" /><div className="result-actions"><a className="primary" href={artifacts['poster.png']} download="poster.png">Download poster.png</a><button onClick={() => dispatch({ type: 'view', result: false })}>Return to editing</button></div><p className="scan-note">Artistic margins can affect scanning. Test the downloaded poster with your phone.</p><details><summary>Artifacts & verification</summary><div className="downloads">{Object.keys(state.result.artifacts).filter(name => name !== 'poster.png').map(name => <a key={name} href={artifacts[name]} download={name}>{name}</a>)}</div></details></div> : state.prepared && state.placement && posterUrl ? <Canvas mask={previews['region.png'] ?? ''} poster={posterUrl} overlay={previews['mask.png'] ?? ''} qr={previews['qr.png'] ?? ''} width={state.prepared.width} height={state.prepared.height} placement={state.placement} modules={state.prepared.qrMetadata.totalModules} onChange={move} invalid={!!state.error} /> : <div className="empty"><div className="empty-icon">＋</div><h3>Your poster goes here</h3><p>Upload a PNG to find its black region<br />and place your QR inside it.</p></div>}
      <div className="workspace-note"><span>Original dimensions. Precise placement.</span><span>Pixels outside your region stay untouched.</span></div>
    </div></div>
  </main>
}
