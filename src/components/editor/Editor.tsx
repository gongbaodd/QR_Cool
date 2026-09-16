'use client'
import dynamic from 'next/dynamic'
import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import type { Placement } from '../../lib/editor/schema'
const Canvas = dynamic(() => import('./Canvas'), { ssr: false })
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
function blobFromBase64(value: string, type: string) { return new Blob([Uint8Array.from(atob(value), c => c.charCodeAt(0))], { type }) }
function useBlobUrls(values: Record<string, string>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = JSON.stringify(values)
  useEffect(() => { const next = Object.fromEntries(Object.entries(JSON.parse(key) as Record<string, string>).map(([name, bytes]) => [name, URL.createObjectURL(blobFromBase64(bytes, name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : 'image/png'))])); setUrls(next); return () => Object.values(next).forEach(URL.revokeObjectURL) }, [key])
  return urls
}
export default function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [poster, setPoster] = useState<File | null>(null), [mask, setMask] = useState<File | null>(null), [posterUrl, setPosterUrl] = useState('')
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
  const ready = !!state.prepared && state.prepared.revision === state.revision && !state.error && !state.busy && contentCheck.success
  const move = (box: Placement) => edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared!.qrMetadata.totalModules) } })
  return <main>
    <header><a href="/" className="wordmark">QR<span> / </span>COOL</a><span className="header-note">The artistic poster editor</span><span className="local-note">No account. No saved uploads.</span></header>
    <div className="workspace"><aside>
      <div className="panel-heading"><span className="eyebrow">POSTER STUDIO</span><h1>Make the code<br />part of the art.</h1></div>
      <section><h2><span>01</span> Your poster</h2><label className="upload">Poster PNG<input aria-label="Poster PNG" type="file" accept="image/png" onChange={e => upload(e.target.files?.[0], 'poster')} /></label><p className="hint">Use a poster with a solid black region. PNG · up to 10 MiB and 4 megapixels.</p>{poster && <p className="file-meta">{poster.name}{state.prepared && ` · ${state.prepared.width} × ${state.prepared.height} px`}</p>}
        <details><summary>Adjust region selection</summary><p className="hint">Optional same-size PNG mask. White selects the region; black excludes it.</p><label>Region mask PNG<input type="file" accept="image/png" aria-label="Region mask PNG" onChange={e => upload(e.target.files?.[0], 'mask')} /></label>{mask && <button onClick={() => { setMask(null); edit({ type: 'edit', patch: {}, reset: true }) }}>Use automatic detection</button>}</details>
      </section>
      <section><h2><span>02</span> QR content</h2><label htmlFor="content">Text or URL</label><textarea id="content" rows={2} value={state.content} aria-invalid={!!contentError} aria-describedby={contentError ? 'content-error' : 'content-hint'} onChange={e => edit({ type: 'edit', patch: { content: e.target.value } })} />{contentError ? <p id="content-error" className="error">{contentError}</p> : <p id="content-hint" className="hint">One line. Links are encoded exactly as entered.</p>}</section>
      <section><h2><span>03</span> Position & size</h2><div className="coordinates">{(['x','y','size'] as const).map(key => <label key={key}>{key === 'size' ? 'Size' : key.toUpperCase()}<input aria-label={key === 'size' ? 'QR size' : `QR ${key.toUpperCase()}`} type="number" step={key === 'size' ? state.prepared?.qrMetadata.totalModules ?? 1 : 1} value={state.placement?.[key] ?? ''} disabled={!state.prepared} onChange={e => move({ ...state.placement!, [key]: Number(e.target.value) })} /></label>)}</div><button className="text-button" disabled={!poster || !contentCheck.success} onClick={() => edit({ type: 'edit', patch: { placement: null } })}>Reset to automatic placement</button><p className="hint">Original poster pixels. Size snaps to whole QR modules.</p></section>
      <details className="advanced"><summary>Pattern settings</summary><label>Seed<input type="number" min={0} max={4294967295} value={state.settings.seed} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) } } })} /></label><button onClick={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}>New pattern</button><label>Finder margin<select value={state.settings.qrMargin} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, qrMargin: Number(e.target.value) as 1 | 2 } } })}><option value={1}>1 module</option><option value={2}>2 modules</option></select></label><label>Marker corners<select value={state.settings.plateCorners} onChange={e => edit({ type: 'edit', patch: { settings: { ...state.settings, plateCorners: e.target.value as 'light' | 'texture' } } })}><option value="texture">Continue texture</option><option value="light">Keep light</option></select></label></details>
      <div className="assemble-controls"><button className="primary" disabled={!ready} onClick={() => void request('assemble')}>{state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}</button><div aria-live="polite" role="status">{state.busy === 'prepare' && 'Checking region and QR placement…'}{state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}</div></div>
      {state.error && state.field !== 'content' && <div className="error" role="alert">{state.error}<button onClick={() => void request('prepare')}>Retry preparation</button></div>}
    </aside><div className="preview-panel"><div className="preview-heading"><div><span className="eyebrow">{state.showingResult ? 'FINISHED POSTER' : 'LIVE WORKSPACE'}</span><h2>{state.showingResult ? 'Ready for the real world.' : 'A little code. A lot of character.'}</h2></div>{state.prepared && <span className="badge">{state.prepared.width} × {state.prepared.height}</span>}</div>
      {state.showingResult && state.result ? <div className="result"><img src={artifacts['poster.png']} alt="Assembled artistic QR poster" /><div className="result-actions"><a className="primary" href={artifacts['poster.png']} download="poster.png">Download poster.png</a><button onClick={() => dispatch({ type: 'view', result: false })}>Return to editing</button></div><p className="scan-note">Artistic margins can affect scanning. Test the downloaded poster with your phone.</p><details><summary>Artifacts & verification</summary><div className="downloads">{Object.keys(state.result.artifacts).filter(name => name !== 'poster.png').map(name => <a key={name} href={artifacts[name]} download={name}>{name}</a>)}</div></details></div> : state.prepared && state.placement && posterUrl ? <Canvas mask={previews['region.png'] ?? ''} poster={posterUrl} overlay={previews['mask.png'] ?? ''} qr={previews['qr.png'] ?? ''} width={state.prepared.width} height={state.prepared.height} placement={state.placement} modules={state.prepared.qrMetadata.totalModules} onChange={move} invalid={!!state.error} /> : <div className="empty"><div className="empty-icon">＋</div><h3>Your poster goes here</h3><p>Upload a PNG to find its black region<br />and place your QR inside it.</p></div>}
      <div className="workspace-note"><span>Original dimensions. Precise placement.</span><span>Pixels outside your region stay untouched.</span></div>
    </div></div>
  </main>
}
