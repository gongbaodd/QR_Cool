import PreparationError from '../PreparationError'
import type { State } from '../../../lib/editor/state'

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
    <section>
      <h2>
        <span>04</span> Generate
      </h2>
      <div className="assemble-controls">
        <button className="primary" disabled={!ready && !state.result} onClick={onAssemble}>
          {state.busy === 'assemble' ? 'Assembling…' : 'Assemble poster'}
        </button>
        <div aria-live="polite" role="status">
          {state.busy === 'prepare' && 'Checking region and QR placement…'}
          {state.busy === 'assemble' && 'Drawing full-resolution modules and verifying pixels…'}
        </div>
      </div>
      {preparationError && <PreparationError message={preparationError} onRetry={onRetry} />}
      <div className="step-nav">
        <button onClick={onBack}>Back to adjust</button>
      </div>
    </section>
  )
}
