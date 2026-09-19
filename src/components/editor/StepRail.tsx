import * as stylex from '@stylexjs/stylex'
import { ui } from '../../styles/ui.stylex'
import { tokens } from '../../styles/tokens.stylex'

const styles = stylex.create({
  steps: {
    display: 'flex',
    gap: 12,
    margin: 0,
    paddingBlock: 14,
    paddingInline: 40,
    listStyle: 'none',
    backgroundColor: tokens.card,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 1000px)': {
      paddingBlock: 12,
      paddingInline: 20,
    },
    '@media (max-width: 700px)': {
      flexWrap: 'wrap',
    },
  },
  step: {
    flex: 1,
    '@media (max-width: 700px)': {
      flex: '1 1 45%',
    },
  },
  stepButton: {
    width: '100%',
    paddingBlock: 9,
    paddingInline: 12,
    fontSize: 14,
    lineHeight: 1.5,
    letterSpacing: '0.05em',
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    boxShadow: tokens.shadow,
    transform: 'rotate(-0.3deg)',
  },
  stepCurrent: {
    backgroundColor: tokens.highlight,
    borderWidth: 3,
    fontWeight: 700,
    ':hover:not(:disabled)': {
      backgroundColor: tokens.highlight,
    },
  },
})

export default function StepRail({
  steps,
  step,
  canEnter,
  onGoto,
}: {
  steps: string[]
  step: number
  canEnter: (index: number) => boolean
  onGoto: (index: number) => void
}) {
  return (
    <ol {...stylex.props(styles.steps)} aria-label="Poster steps">
      {steps.map((label, i) => {
        const index = i + 1
        const current = step === index
        return (
          <li key={label} {...stylex.props(styles.step)} aria-current={current ? 'step' : undefined}>
            <button
              {...stylex.props(
                ui.button,
                styles.stepButton,
                i % 2 === 1 && ui.buttonAlt,
                current && styles.stepCurrent,
              )}
              disabled={!canEnter(index)}
              onClick={() => onGoto(index)}
            >
              <span>Step {index}</span> {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
