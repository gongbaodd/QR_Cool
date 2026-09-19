import type { Placement, Settings } from '../../../lib/editor/schema'
import type { State } from '../../../lib/editor/state'

export default function StepAdjust({
  state,
  ready,
  canReset,
  onMove,
  onSettings,
  onNewSeed,
  onResetPlacement,
  onAssemble,
  onGoto,
}: {
  state: State
  ready: boolean
  canReset: boolean
  onMove: (box: Placement) => void
  onSettings: (patch: Partial<Settings>) => void
  onNewSeed: () => void
  onResetPlacement: () => void
  onAssemble: () => void
  onGoto: (index: number) => void
}) {
  return (
    <section>
      <h2>
        <span>03</span> Adjust QR
      </h2>
      <p className="file-meta">Encoding: {state.content || '—'}</p>
      <button className="text-button" onClick={() => onGoto(1)}>
        Change text
      </button>
      <div className="coordinates">
        {(['x', 'y', 'size'] as const).map((key) => (
          <label key={key}>
            {key === 'size' ? 'Size' : key.toUpperCase()}
            <input
              aria-label={key === 'size' ? 'QR size' : `QR ${key.toUpperCase()}`}
              type="number"
              step={key === 'size' ? (state.prepared?.qrMetadata.totalModules ?? 1) : 1}
              value={state.placement?.[key] ?? ''}
              disabled={!state.prepared}
              onChange={(e) => onMove({ ...state.placement!, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <button className="text-button" disabled={!canReset} onClick={onResetPlacement}>
        Reset to automatic placement
      </button>
      <p className="hint">
        Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.
      </p>
      <details className="advanced">
        <summary>Pattern settings</summary>
        <label>
          Seed
          <input
            type="number"
            min={0}
            max={4294967295}
            value={state.settings.seed}
            onChange={(e) =>
              onSettings({ seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) })
            }
          />
        </label>
        <button onClick={onNewSeed}>New pattern</button>
        <label>
          Finder margin<span className="hint">1 module (fixed)</span>
        </label>
        <label>
          Marker corners
          <select
            value={state.settings.plateCorners}
            onChange={(e) => onSettings({ plateCorners: e.target.value as 'light' | 'texture' })}
          >
            <option value="texture">Continue texture</option>
            <option value="light">Keep light</option>
          </select>
        </label>
        <label>
          Rim thickness
          <select
            value={state.settings.rimModules}
            onChange={(e) => onSettings({ rimModules: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} module{n !== 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Round rim
          <input
            type="checkbox"
            checked={state.settings.rimRounded}
            onChange={(e) => onSettings({ rimRounded: e.target.checked })}
          />{' '}
          antialiased
        </label>
      </details>
      <div className="step-nav">
        <button onClick={() => onGoto(2)}>Back</button>
        <button className="primary" disabled={!ready} onClick={onAssemble}>
          {state.busy === 'assemble' ? 'Assembling…' : 'Continue to generate'}
        </button>
      </div>
    </section>
  )
}
