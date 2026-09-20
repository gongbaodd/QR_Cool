import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../../styles/tokens.stylex'
import { ui } from '../../../styles/ui.stylex'
import PreparationError from '../PreparationError'
import { QR_EXAMPLES } from '../../../lib/editor/examples'

const styles = stylex.create({
  workspaceCentered: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: 48,
    paddingInline: 24,
    minHeight: 'calc(100vh - 88px)',
    backgroundColor: tokens.paper,
    '@media (max-width: 700px)': {
      paddingBlock: 24,
      paddingInline: 16,
    },
  },
  stepNav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
  exampleGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  exampleTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: tokens.ink,
    marginTop: 18,
    marginBottom: 6,
  },
  exampleButton: {
    paddingBlock: 6,
    paddingInline: 10,
    fontSize: 13,
    backgroundColor: 'white',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
})

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
    <div {...stylex.props(styles.workspaceCentered)}>
      <aside {...stylex.props(ui.aside, ui.asideCentered)}>
        <div>
          <span {...stylex.props(ui.eyebrow)}>POSTER STUDIO · STEP 1 OF 4</span>
          <h1 {...stylex.props(ui.pageTitle)}>
            Make the code
            <br />
            part of the art.
          </h1>
        </div>
        <section {...stylex.props(ui.section, ui.sectionFirst)}>
          <h2 {...stylex.props(ui.sectionHeading)}>
            <span {...stylex.props(ui.sectionNumber)}>01</span> Input text
          </h2>
          <label {...stylex.props(ui.label)} htmlFor="content">
            Text or URL
          </label>
          <textarea
            {...stylex.props(ui.field, ui.textarea)}
            id="content"
            rows={2}
            value={content}
            aria-invalid={!!contentError}
            aria-describedby={contentError ? 'content-error' : 'content-hint'}
            onChange={(e) => onContentChange(e.target.value)}
          />
          {contentError ? (
            <p id="content-error" {...stylex.props(ui.error)}>
              {contentError}
            </p>
          ) : (
            <p id="content-hint" {...stylex.props(ui.hint)}>
              One line. Links are encoded exactly as entered.
            </p>
          )}
          {!contentError &&
            (suggestedMask ? (
              <p {...stylex.props(ui.hint)}>
                Website detected — step 2 will suggest <strong>{suggestedMask}</strong> as the mask letter.
              </p>
            ) : (
              <p {...stylex.props(ui.hint)}>Plain text — step 2 starts from a blank full-canvas region.</p>
            ))}
          <div {...stylex.props(styles.stepNav)}>
            <button
              {...stylex.props(ui.button, ui.primary, ui.primaryStretch, ui.primaryShadow)}
              disabled={!canContinue}
              onClick={onContinue}
            >
              Continue
            </button>
          </div>
          <p {...stylex.props(styles.exampleTitle)}>Or try an example</p>
          <div {...stylex.props(styles.exampleGrid)}>
            {QR_EXAMPLES.map((ex) => (
              <button
                key={ex.value}
                type="button"
                {...stylex.props(styles.exampleButton)}
                onClick={() => onContentChange(ex.value)}
                aria-label={`Use example ${ex.label}`}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </section>
        {preparationError && <PreparationError message={preparationError} onRetry={onRetry} />}
      </aside>
    </div>
  )
}
