import * as stylex from '@stylexjs/stylex'
import { encode } from 'uqr'
import type { Settings } from '../../../lib/editor/schema'
import type { State } from '../../../lib/editor/state'
import { tokens } from '../../../styles/tokens.stylex'
import { ui } from '../../../styles/ui.stylex'

const ECC_OPTIONS = [
  { value: 'L' as const, label: 'L', recovery: '~7%', hint: 'Low' },
  { value: 'M' as const, label: 'M', recovery: '~15%', hint: 'Medium' },
  { value: 'Q' as const, label: 'Q', recovery: '~25%', hint: 'Quartile' },
  { value: 'H' as const, label: 'H', recovery: '~30%', hint: 'High' },
] as const

const styles = stylex.create({
  advanced: {
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopStyle: 'dashed',
    borderTopColor: tokens.ink,
  },
  patternHeading: {
    cursor: 'default',
  },
  eccFieldset: {
    borderWidth: 0,
    padding: 0,
    margin: '14px 0 0',
  },
  eccLegend: {
    fontSize: 16,
    color: tokens.ink,
    marginBottom: 8,
    fontWeight: 600,
  },
  eccHint: {
    fontSize: 13,
    color: tokens.muted,
    marginBottom: 10,
    lineHeight: 1.5,
  },
  eccGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
    '@media (max-width: 700px)': {
      gridTemplateColumns: 'repeat(2, 1fr)',
    },
  },
  eccCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 10,
    paddingInline: 6,
    backgroundColor: 'white',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchAlt,
    boxShadow: tokens.shadowField,
    cursor: 'pointer',
    transform: 'rotate(-0.25deg)',
    transitionProperty: 'transform, box-shadow, background-color, border-color',
    transitionDuration: '0.12s',
    transitionTimingFunction: 'ease',
    ':hover': {
      backgroundColor: tokens.highlightSoft,
    },
  },
  eccCardSelected: {
    backgroundColor: tokens.highlight,
    borderWidth: 3,
    boxShadow: tokens.shadow,
    transform: 'rotate(0.2deg)',
  },
  eccRadio: {
    // visually hidden but accessible
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0,
    pointerEvents: 'none',
  },
  eccPreviewBox: {
    width: 72,
    height: 72,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#d9d9d9',
    borderRadius: 6,
    overflow: 'hidden',
    padding: 4,
  },
  eccPreviewFallback: {
    fontSize: 11,
    color: tokens.danger,
    textAlign: 'center',
    lineHeight: 1.3,
    paddingInline: 4,
  },
  eccLabel: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '0.04em',
    lineHeight: 1,
  },
  eccRecovery: {
    fontSize: 11,
    color: tokens.muted,
    lineHeight: 1,
  },
  eccVersion: {
    fontSize: 10,
    color: tokens.muted,
    lineHeight: 1,
  },
  nav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
})

function MiniQrPreview({ content, ecc }: { content: string; ecc: 'L' | 'M' | 'Q' | 'H' }) {
  const text = content.trim().length > 0 ? content : 'https://example.com'
  // single line only; if multiline, show fallback
  if (/[\r\n]/.test(text))
    return <span {...stylex.props(styles.eccPreviewFallback)}>Single line only</span>
  let encoded: ReturnType<typeof encode> | null = null
  try {
    // uqr throws when capacity exceeded for the chosen ecc/version
    encoded = encode(text, { ecc, maskPattern: -1, border: 0 })
  } catch {
    return <span {...stylex.props(styles.eccPreviewFallback)}>Too long for {ecc}</span>
  }
  const size = encoded.size
  const margin = 2
  const total = size + margin * 2
  // Build rects for dark modules
  const rects: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (encoded.data[y]?.[x]) rects.push(`${x + margin},${y + margin}`)
    }
  }
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={64}
      height={64}
      role="img"
      aria-label={`QR preview ${ecc}`}
      style={{ display: 'block', width: 64, height: 64 }}
    >
      <rect width={total} height={total} fill="white" />
      {rects.map((pos) => {
        const [x, y] = pos.split(',').map(Number) as [number, number]
        return <rect key={pos} x={x} y={y} width={1} height={1} fill="black" />
      })}
    </svg>
  )
}

export default function StepAdjust({
  state,
  ready,
  onSettings,
  onNewSeed,
  onAssemble,
  onGoto,
}: {
  state: State
  ready: boolean
  onSettings: (patch: Partial<Settings>) => void
  onNewSeed: () => void
  onAssemble: () => void
  onGoto: (index: number) => void
}) {
  const ecc = (state.settings.ecc ?? 'M') as 'L' | 'M' | 'Q' | 'H'
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

        <fieldset {...stylex.props(styles.eccFieldset)}>
          <legend {...stylex.props(styles.eccLegend)}>Error correction</legend>
          <p {...stylex.props(styles.eccHint)}>
            Higher levels survive more damage but make the code denser. Tap a preview to switch.
          </p>
          <div {...stylex.props(styles.eccGrid)} role="radiogroup" aria-label="Error correction level">
            {ECC_OPTIONS.map((opt) => {
              const selected = ecc === opt.value
              return (
                <label
                  key={opt.value}
                  {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : undefined)}
                  aria-selected={selected}
                >
                  <input
                    type="radio"
                    name="ecc"
                    value={opt.value}
                    checked={selected}
                    onChange={() => onSettings({ ecc: opt.value })}
                    {...stylex.props(styles.eccRadio)}
                    aria-label={`${opt.value} ${opt.hint} ${opt.recovery}`}
                  />
                  <span {...stylex.props(styles.eccPreviewBox)}>
                    <MiniQrPreview content={state.content} ecc={opt.value} />
                  </span>
                  <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                  <span {...stylex.props(styles.eccRecovery)}>
                    {opt.hint} {opt.recovery}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

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
