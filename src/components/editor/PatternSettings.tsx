'use client'
import * as stylex from '@stylexjs/stylex'
import { encode } from 'uqr'
import type { Settings } from '../../lib/editor/schema'
import { tokens } from '../../styles/tokens.stylex'
import { ui } from '../../styles/ui.stylex'

const ECC_OPTIONS = [
  { value: 'L' as const, label: 'L', recovery: '~7%', hint: 'Low' },
  { value: 'M' as const, label: 'M', recovery: '~15%', hint: 'Medium' },
  { value: 'Q' as const, label: 'Q', recovery: '~25%', hint: 'Quartile' },
  { value: 'H' as const, label: 'H', recovery: '~30%', hint: 'High' },
] as const

const styles = stylex.create({
  panel: {
    padding: 18,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  heading: {
    fontSize: 16,
    fontWeight: 600,
    color: tokens.ink,
    marginBottom: 4,
  },
  eccFieldset: {
    borderWidth: 0,
    padding: 0,
    margin: '12px 0 0',
  },
  eccLegend: {
    fontSize: 15,
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
  seedRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'end',
    marginTop: 12,
    '@media (max-width: 600px)': {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
  },
  seedField: {
    flex: 1,
  },
})

function MiniQrPreview({ content, ecc }: { content: string; ecc: 'L' | 'M' | 'Q' | 'H' }) {
  const text = content.trim().length > 0 ? content : 'https://example.com'
  if (/[\r\n]/.test(text)) return <span {...stylex.props(styles.eccPreviewFallback)}>Single line only</span>
  let encoded: ReturnType<typeof encode> | null = null
  try {
    encoded = encode(text, { ecc, maskPattern: -1, border: 0 })
  } catch {
    return <span {...stylex.props(styles.eccPreviewFallback)}>Too long for {ecc}</span>
  }
  const size = encoded.size
  const margin = 2
  const total = size + margin * 2
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

export default function PatternSettings({
  content,
  settings,
  onSettings,
  onNewSeed,
}: {
  content: string
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onNewSeed: () => void
}) {
  const ecc = (settings.ecc ?? 'M') as 'L' | 'M' | 'Q' | 'H'
  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.heading)}>Pattern settings</div>
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
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
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
                  <MiniQrPreview content={content} ecc={opt.value} />
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

      <div {...stylex.props(styles.seedRow)}>
        <label {...stylex.props(ui.label, styles.seedField)}>
          Seed
          <input
            {...stylex.props(ui.field)}
            type="number"
            min={0}
            max={4294967295}
            value={settings.seed}
            onChange={(e) =>
              onSettings({ seed: Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)))) })
            }
          />
        </label>
        <button {...stylex.props(ui.button)} onClick={onNewSeed}>
          New pattern
        </button>
      </div>
      <label {...stylex.props(ui.label, ui.detailsLabel)}>
        Rim
        <input
          {...stylex.props(ui.checkbox)}
          type="checkbox"
          checked={settings.rimModules !== 0}
          onChange={(e) => onSettings({ rimModules: e.target.checked ? 1 : 0, rimRounded: false })}
        />{' '}
        Add Rim (1 module)
      </label>
    </div>
  )
}
