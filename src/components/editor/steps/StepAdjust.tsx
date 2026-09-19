import * as stylex from '@stylexjs/stylex'
import type { Placement, Settings } from '../../../lib/editor/schema'
import type { State } from '../../../lib/editor/state'
import { tokens } from '../../../styles/tokens.stylex'
import { ui } from '../../../styles/ui.stylex'

const styles = stylex.create({
  coordinates: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1.3fr',
    gap: 12,
  },
  advanced: {
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopStyle: 'dashed',
    borderTopColor: tokens.ink,
  },
  nav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
})

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
    <section {...stylex.props(ui.section, ui.sectionFirst)}>
      <h2 {...stylex.props(ui.sectionHeading)}>
        <span {...stylex.props(ui.sectionNumber)}>03</span> Adjust QR
      </h2>
      <p {...stylex.props(ui.fileMeta)}>Encoding: {state.content || '—'}</p>
      <button {...stylex.props(ui.button, ui.textButton)} onClick={() => onGoto(1)}>
        Change text
      </button>
      <div {...stylex.props(styles.coordinates)}>
        {(['x', 'y', 'size'] as const).map((key, index) => (
          <label key={key} {...stylex.props(ui.label)}>
            {key === 'size' ? 'Size' : key.toUpperCase()}
            <input
              {...stylex.props(ui.field, index % 2 === 1 && ui.fieldAlt)}
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
      <button {...stylex.props(ui.button, ui.textButton, ui.buttonAlt)} disabled={!canReset} onClick={onResetPlacement}>
        Reset to automatic placement
      </button>
      <p {...stylex.props(ui.hint)}>
        Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.
      </p>
      <details {...stylex.props(ui.details, styles.advanced)}>
        <summary {...stylex.props(ui.summary)}>Pattern settings</summary>
        <label {...stylex.props(ui.label, ui.detailsLabel)}>
          Seed
          <input
            {...stylex.props(ui.field)}
            type="number"
            min={0}
            max={4294967295}
            value={state.settings.seed}
            onChange={(e) =>
              onSettings({ seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) })
            }
          />
        </label>
        <button {...stylex.props(ui.button)} onClick={onNewSeed}>
          New pattern
        </button>
        <label {...stylex.props(ui.label, ui.detailsLabel)}>
          Finder margin
          <span {...stylex.props(ui.hint)}>1 module (fixed)</span>
        </label>
        <label {...stylex.props(ui.label, ui.detailsLabel)}>
          Marker corners
          <select
            {...stylex.props(ui.field, ui.select)}
            value={state.settings.plateCorners}
            onChange={(e) => onSettings({ plateCorners: e.target.value as 'light' | 'texture' })}
          >
            <option value="texture">Continue texture</option>
            <option value="light">Keep light</option>
          </select>
        </label>
        <label {...stylex.props(ui.label, ui.detailsLabel)}>
          Rim thickness
          <select
            {...stylex.props(ui.field, ui.select, ui.fieldAlt)}
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
        <label {...stylex.props(ui.label, ui.detailsLabel)}>
          Round rim
          <input
            {...stylex.props(ui.checkbox)}
            type="checkbox"
            checked={state.settings.rimRounded}
            onChange={(e) => onSettings({ rimRounded: e.target.checked })}
          />{' '}
          antialiased
        </label>
      </details>
      <div {...stylex.props(styles.nav)}>
        <button {...stylex.props(ui.button)} onClick={() => onGoto(2)}>
          Back
        </button>
        <button
          {...stylex.props(ui.button, ui.primary, ui.buttonAlt, ui.primaryStretch, ui.primaryShadow)}
          disabled={!ready}
          onClick={onAssemble}
        >
          {state.busy === 'assemble' ? 'Assembling…' : 'Continue to generate'}
        </button>
      </div>
    </section>
  )
}
