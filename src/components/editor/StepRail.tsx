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
    <ol className="steps" aria-label="Poster steps">
      {steps.map((label, i) => {
        const index = i + 1
        return (
          <li key={label} aria-current={step === index ? 'step' : undefined}>
            <button disabled={!canEnter(index)} onClick={() => onGoto(index)}>
              <span>Step {index}</span> {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
