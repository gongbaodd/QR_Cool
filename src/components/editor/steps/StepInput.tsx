import PreparationError from '../PreparationError'

export default function StepInput({
  content,
  contentError,
  canContinue,
  suggestedMask,
  preparationError,
  onContentChange,
  onContinue,
  onRetry,
}: {
  content: string
  contentError: string | null
  canContinue: boolean
  suggestedMask: string
  preparationError: string | null
  onContentChange: (value: string) => void
  onContinue: () => void
  onRetry: () => void
}) {
  return (
    <div className="workspace-centered">
      <aside>
        <div className="panel-heading">
          <span className="eyebrow">POSTER STUDIO · STEP 1 OF 4</span>
          <h1>
            Make the code
            <br />
            part of the art.
          </h1>
        </div>
        <section>
          <h2>
            <span>01</span> Input text
          </h2>
          <label htmlFor="content">Text or URL</label>
          <textarea
            id="content"
            rows={2}
            value={content}
            aria-invalid={!!contentError}
            aria-describedby={contentError ? 'content-error' : 'content-hint'}
            onChange={(e) => onContentChange(e.target.value)}
          />
          {contentError ? (
            <p id="content-error" className="error">
              {contentError}
            </p>
          ) : (
            <p id="content-hint" className="hint">
              One line. Links are encoded exactly as entered.
            </p>
          )}
          {!contentError &&
            (suggestedMask ? (
              <p className="hint">
                Website detected — step 2 will suggest <strong>{suggestedMask}</strong> as the mask letter.
              </p>
            ) : (
              <p className="hint">Plain text — step 2 starts from a blank full-canvas region.</p>
            ))}
          <div className="step-nav">
            <button className="primary" disabled={!canContinue} onClick={onContinue}>
              Continue
            </button>
          </div>
        </section>
        {preparationError && <PreparationError message={preparationError} onRetry={onRetry} />}
      </aside>
    </div>
  )
}
