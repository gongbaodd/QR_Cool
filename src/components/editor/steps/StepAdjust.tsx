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
  patternHeading: {
    cursor: 'default',
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
      <p {...stylex.props(ui.hint)}>
        Original poster pixels. Size snaps to whole QR modules. Drag the QR in the preview or use the arrow keys.
      </p>
      <div {...stylex.props(ui.details, styles.advanced)}>
        <div {...stylex.props(ui.summary, styles.patternHeading)}>Pattern settings</div>
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
          Rim
          <input
            {...stylex.props(ui.checkbox)}
            type="checkbox"
            checked={state.settings.rimModules !== 0}
            onChange={(e) => onSettings({ rimModules: e.target.checked ? 1 : 0, rimRounded: false })}
          />{' '}
          Add Rim (1 module)
        </label>
      </div>
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
