import * as stylex from '@stylexjs/stylex'
import type { State } from '../../../lib/editor/state'
import { ui } from '../../../styles/ui.stylex'

const styles = stylex.create({
  nav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
})

export default function StepAdjust({
  state,
  ready,
  onAssemble,
  onGoto,
}: {
  state: State
  ready: boolean
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
        Original poster pixels. Size snaps to whole QR modules. Drag or resize the QR in the preview, or rotate it
        with the handle. Hover a finder or alignment marker to edit it. Other pattern settings are beside the preview.
      </p>
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
