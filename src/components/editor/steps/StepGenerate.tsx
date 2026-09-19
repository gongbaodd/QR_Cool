import * as stylex from '@stylexjs/stylex'
import PreparationError from '../PreparationError'
import type { State } from '../../../lib/editor/state'
import { ui } from '../../../styles/ui.stylex'

const styles = stylex.create({
  assembleControls: {
    marginTop: 22,
  },
  nav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
})

export default function StepGenerate({
  state,
  ready,
  preparationError,
  onAssemble,
  onRetry,
  onBack,
}: {
  state: State
  ready: boolean
  preparationError: string | null
  onAssemble: () => void
  onRetry: () => void
  onBack: () => void
}) {
  return (
    <section {...stylex.props(ui.section, ui.sectionFirst)}>
      <h2 {...stylex.props(ui.sectionHeading)}>
        <span {...stylex.props(ui.sectionNumber)}>04</span> Generate
      </h2>
      <div {...stylex.props(styles.assembleControls)}>
        <button
          {...stylex.props(ui.button, ui.primary, ui.primaryFill, ui.primaryShadow)}
          disabled={!ready && !state.result}
          onClick={onAssemble}
        >
          {state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}
        </button>
        <div {...stylex.props(ui.status)} aria-live="polite" role="status">
          {state.busy === 'prepare' && 'Checking region and QR placement…'}
          {state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}
        </div>
      </div>
      {preparationError && <PreparationError message={preparationError} onRetry={onRetry} />}
      <div {...stylex.props(styles.nav)}>
        <button {...stylex.props(ui.button)} onClick={onBack}>
          Back to adjust
        </button>
      </div>
    </section>
  )
}
