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

const PIXEL_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Sharp cells' },
  { value: 'rounded' as const, label: 'Rounded', hint: 'Blended cells' },
  { value: 'dot' as const, label: 'Dot', hint: 'Circles' },
] as const

const MARKER_STYLE_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Sharp' },
  { value: 'rounded' as const, label: 'Round', hint: 'Rounded' },
] as const

const MARKER_SHAPE_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
  { value: 'octagon' as const, label: 'Octagon', hint: 'Octagon' },
] as const

const MARKER_INNER_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
  { value: 'plus' as const, label: 'Plus', hint: 'Plus' },
  { value: 'diamond' as const, label: 'Diamond', hint: 'Diamond' },
] as const

const MARKER_SUB_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
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

function MiniPixelQrPreview({
  content,
  ecc,
  pixelStyle,
}: {
  content: string
  ecc: 'L' | 'M' | 'Q' | 'H'
  pixelStyle: 'square' | 'rounded' | 'dot'
}) {
  const text = content.trim().length > 0 ? content : 'https://example.com'
  if (/[\r\n]/.test(text)) return <span {...stylex.props(styles.eccPreviewFallback)}>Single line only</span>
  let encoded: ReturnType<typeof encode> | null = null
  try {
    encoded = encode(text, { ecc, maskPattern: -1, border: 0 })
  } catch {
    return <span {...stylex.props(styles.eccPreviewFallback)}>Too long</span>
  }
  const size = encoded.size
  const margin = 2
  const total = size + margin * 2
  // helper to test darkness including margin offset
  const dark = (x: number, y: number): boolean => {
    const cx = x - margin
    const cy = y - margin
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return false
    return !!encoded!.data[cy]?.[cx]
  }
  if (pixelStyle === 'square') {
    const rects: string[] = []
    for (let y = 0; y < total; y++) {
      for (let x = 0; x < total; x++) {
        if (dark(x, y)) rects.push(`${x},${y}`)
      }
    }
    return (
      <svg
        viewBox={`0 0 ${total} ${total}`}
        width={64}
        height={64}
        role="img"
        aria-label={`QR preview ${pixelStyle}`}
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
  if (pixelStyle === 'dot') {
    const dots: string[] = []
    for (let y = 0; y < total; y++) {
      for (let x = 0; x < total; x++) {
        if (dark(x, y)) dots.push(`${x},${y}`)
      }
    }
    return (
      <svg
        viewBox={`0 0 ${total} ${total}`}
        width={64}
        height={64}
        role="img"
        aria-label={`QR preview ${pixelStyle}`}
        style={{ display: 'block', width: 64, height: 64 }}
      >
        <rect width={total} height={total} fill="white" />
        {dots.map((pos) => {
          const [x, y] = pos.split(',').map(Number) as [number, number]
          return <circle key={pos} cx={x + 0.5} cy={y + 0.5} r={0.5} fill="black" />
        })}
      </svg>
    )
  }
  // rounded: circles + corner wedges bridging dark neighbours (same as qrcode.antfu.me)
  const circles: string[] = []
  const wedges: string[] = []
  const half = 0.5
  const radius = 0.5
  for (let y = 0; y < total; y++) {
    for (let x = 0; x < total; x++) {
      const up = dark(x, y - 1)
      const down = dark(x, y + 1)
      const left = dark(x - 1, y)
      const right = dark(x + 1, y)
      if (dark(x, y)) {
        circles.push(`M${x},${y + half}a${half},${half} 0 1 0 1,0a${half},${half} 0 1 0 -1,0Z`)
        if (up || left) wedges.push(`M${x},${y} L${x},${y + half} A${radius},${radius} 0 0 1 ${x + half},${y} Z`)
        if (up || right)
          wedges.push(`M${x + 1},${y} L${x + 1},${y + half} A${radius},${radius} 0 0 0 ${x + 0.5},${y} Z`)
        if (down || left)
          wedges.push(`M${x},${y + 1} L${x},${y + 0.5} A${radius},${radius} 0 0 0 ${x + half},${y + 1} Z`)
        if (down || right)
          wedges.push(`M${x + 1},${y + 1} L${x + 1},${y + 0.5} A${radius},${radius} 0 0 1 ${x + 0.5},${y + 1} Z`)
      } else {
        if (up && left && dark(x - 1, y - 1))
          wedges.push(`M${x},${y} L${x},${y + half} A${radius},${radius} 0 0 1 ${x + half},${y} Z`)
        if (up && right && dark(x + 1, y - 1))
          wedges.push(`M${x + 1},${y} L${x + 1},${y + half} A${radius},${radius} 0 0 0 ${x + 0.5},${y} Z`)
        if (down && left && dark(x - 1, y + 1))
          wedges.push(`M${x},${y + 1} L${x},${y + 0.5} A${radius},${radius} 0 0 0 ${x + half},${y + 1} Z`)
        if (down && right && dark(x + 1, y + 1))
          wedges.push(`M${x + 1},${y + 1} L${x + 1},${y + 0.5} A${radius},${radius} 0 0 1 ${x + 0.5},${y + 1} Z`)
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={64}
      height={64}
      role="img"
      aria-label={`QR preview ${pixelStyle}`}
      style={{ display: 'block', width: 64, height: 64 }}
    >
      <rect width={total} height={total} fill="white" />
      <path fill="black" d={circles.join('')} />
      <path fill="black" d={wedges.join('')} />
    </svg>
  )
}

function MiniMarkerShapePreview({ shape }: { shape: 'square' | 'circle' | 'octagon' }) {
  // 7x7 finder preview normalized to 64px
  const ox = 0,
    oy = 0,
    cx = 3.5,
    cy = 3.5
  if (shape === 'square') {
    return (
      <svg
        viewBox="0 0 7 7"
        width={48}
        height={48}
        role="img"
        aria-label={`marker ${shape}`}
        style={{ display: 'block' }}
      >
        <rect width={7} height={7} fill="white" />
        <rect x={ox} y={oy} width={7} height={7} fill="black" />
        <rect x={1} y={1} width={5} height={5} fill="white" />
        <rect x={2} y={2} width={3} height={3} fill="black" />
      </svg>
    )
  }
  if (shape === 'circle') {
    return (
      <svg
        viewBox="0 0 7 7"
        width={48}
        height={48}
        role="img"
        aria-label={`marker ${shape}`}
        style={{ display: 'block' }}
      >
        <rect width={7} height={7} fill="white" />
        <circle cx={cx} cy={cy} r={3.5} fill="black" />
        <circle cx={cx} cy={cy} r={2.5} fill="white" />
        <circle cx={cx} cy={cy} r={1.5} fill="black" />
      </svg>
    )
  }
  // octagon: For small preview we approximate with precomputed points for size 3.5 and 2.5
  const outerPts = `${cx + 1.07},${cy + 3.5} ${cx - 1.07},${cy + 3.5} ${cx - 3.5},${cy + 1.07} ${cx - 3.5},${cy - 1.07} ${cx - 1.07},${cy - 3.5} ${cx + 1.07},${cy - 3.5} ${cx + 3.5},${cy - 1.07} ${cx + 3.5},${cy + 1.07}`
  const innerPts = `${cx + 0.76},${cy + 2.5} ${cx - 0.76},${cy + 2.5} ${cx - 2.5},${cy + 0.76} ${cx - 2.5},${cy - 0.76} ${cx - 0.76},${cy - 2.5} ${cx + 0.76},${cy - 2.5} ${cx + 2.5},${cy - 0.76} ${cx + 2.5},${cy + 0.76}`
  return (
    <svg
      viewBox="0 0 7 7"
      width={48}
      height={48}
      role="img"
      aria-label={`marker ${shape}`}
      style={{ display: 'block' }}
    >
      <rect width={7} height={7} fill="white" />
      <polygon points={outerPts} fill="black" />
      <polygon points={innerPts} fill="white" />
      <circle cx={cx} cy={cy} r={1.5} fill="black" />
    </svg>
  )
}

function MiniMarkerInnerPreview({ inner }: { inner: 'square' | 'circle' | 'plus' | 'diamond' }) {
  const cx = 3.5,
    cy = 3.5
  return (
    <svg viewBox="0 0 7 7" width={48} height={48} role="img" aria-label={`inner ${inner}`} style={{ display: 'block' }}>
      <rect width={7} height={7} fill="white" />
      <rect x={0} y={0} width={7} height={7} fill="black" />
      <rect x={1} y={1} width={5} height={5} fill="white" />
      {inner === 'square' && <rect x={2} y={2} width={3} height={3} fill="black" />}
      {inner === 'circle' && <circle cx={cx} cy={cy} r={1.5} fill="black" />}
      {inner === 'plus' && (
        <>
          <rect x={cx - 0.5} y={cy - 1.5} width={1} height={3} fill="black" />
          <rect x={cx - 1.5} y={cy - 0.5} width={3} height={1} fill="black" />
        </>
      )}
      {inner === 'diamond' && (
        <polygon points={`${cx},${cy - 1.5} ${cx + 1.5},${cy} ${cx},${cy + 1.5} ${cx - 1.5},${cy}`} fill="black" />
      )}
    </svg>
  )
}

function MiniSubMarkerPreview({ sub }: { sub: 'square' | 'circle' }) {
  const cx = 2.5,
    cy = 2.5
  if (sub === 'square') {
    return (
      <svg viewBox="0 0 5 5" width={48} height={48} role="img" aria-label={`sub ${sub}`} style={{ display: 'block' }}>
        <rect width={5} height={5} fill="white" />
        <rect x={0} y={0} width={5} height={5} fill="black" />
        <rect x={1} y={1} width={3} height={3} fill="white" />
        <rect x={2} y={2} width={1} height={1} fill="black" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 5 5" width={48} height={48} role="img" aria-label={`sub ${sub}`} style={{ display: 'block' }}>
      <rect width={5} height={5} fill="white" />
      <circle cx={cx} cy={cy} r={2.5} fill="black" />
      <circle cx={cx} cy={cy} r={1.5} fill="white" />
      <circle cx={cx} cy={cy} r={0.5} fill="black" />
    </svg>
  )
}

function MiniMarkerPixelPreview({ style }: { style: 'square' | 'rounded' }) {
  // Show two adjacent modules to illustrate pixel join
  if (style === 'square') {
    return (
      <svg
        viewBox="0 0 2 1"
        width={48}
        height={32}
        role="img"
        aria-label={`pixel ${style}`}
        style={{ display: 'block' }}
      >
        <rect width={2} height={1} fill="white" />
        <rect x={0} y={0} width={1} height={1} fill="black" />
        <rect x={1} y={0} width={1} height={1} fill="black" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 2 1" width={48} height={32} role="img" aria-label={`pixel ${style}`} style={{ display: 'block' }}>
      <rect width={2} height={1} fill="white" />
      <circle cx={0.5} cy={0.5} r={0.5} fill="black" />
      <circle cx={1.5} cy={0.5} r={0.5} fill="black" />
      <path
        d="M0,0 L0,0.5 A0.5,0.5 0 0 1 0.5,0 Z M1.5,0 A0.5,0.5 0 0 0 2,0.5 L2,0 Z M0,1 L0,0.5 A0.5,0.5 0 0 0 0.5,1 Z M1.5,1 A0.5,0.5 0 0 1 2,0.5 L2,1 Z"
        fill="black"
      />
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
  const pixelStyle = (settings.pixelStyle ?? 'rounded') as 'square' | 'rounded' | 'dot'
  const markerStyle = (settings.markerStyle ?? 'rounded') as 'square' | 'rounded'
  const markerShape = (settings.markerShape ?? 'circle') as 'square' | 'circle' | 'octagon'
  const markerInner = (settings.markerInner ?? 'circle') as 'square' | 'circle' | 'plus' | 'diamond'
  const markerSub = (settings.markerSub ?? 'square') as 'square' | 'circle'
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

      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Pixel style</legend>
        <p {...stylex.props(styles.eccHint)}>
          Shape of each QR module. Rounded blends neighbours like qrcode.antfu.me.
        </p>
        <div
          {...stylex.props(styles.eccGrid)}
          role="radiogroup"
          aria-label="Pixel style"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          {PIXEL_OPTIONS.map((opt) => {
            const selected = pixelStyle === opt.value
            return (
              <label
                key={opt.value}
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
                aria-selected={selected}
              >
                <input
                  type="radio"
                  name="pixelStyle"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onSettings({ pixelStyle: opt.value })}
                  {...stylex.props(styles.eccRadio)}
                  aria-label={`${opt.value} ${opt.hint}`}
                />
                <span {...stylex.props(styles.eccPreviewBox)}>
                  <MiniPixelQrPreview content={content} ecc={ecc} pixelStyle={opt.value} />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Marker pixel style</legend>
        <p {...stylex.props(styles.eccHint)}>Pixel shape for marker modules.</p>
        <div
          {...stylex.props(styles.eccGrid)}
          role="radiogroup"
          aria-label="Marker pixel style"
          style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
        >
          {MARKER_STYLE_OPTIONS.map((opt) => {
            const selected = markerStyle === opt.value
            return (
              <label
                key={opt.value}
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
                aria-selected={selected}
              >
                <input
                  type="radio"
                  name="markerStyle"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onSettings({ markerStyle: opt.value })}
                  {...stylex.props(styles.eccRadio)}
                  aria-label={`${opt.value} ${opt.hint}`}
                />
                <span {...stylex.props(styles.eccPreviewBox)}>
                  <MiniMarkerPixelPreview style={opt.value} />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Marker shape</legend>
        <p {...stylex.props(styles.eccHint)}>Outer shape of the three finder markers.</p>
        <div
          {...stylex.props(styles.eccGrid)}
          role="radiogroup"
          aria-label="Marker shape"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          {MARKER_SHAPE_OPTIONS.map((opt) => {
            const selected = markerShape === opt.value
            return (
              <label
                key={opt.value}
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
                aria-selected={selected}
              >
                <input
                  type="radio"
                  name="markerShape"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onSettings({ markerShape: opt.value })}
                  {...stylex.props(styles.eccRadio)}
                  aria-label={`${opt.value} ${opt.hint}`}
                />
                <span {...stylex.props(styles.eccPreviewBox)}>
                  <MiniMarkerShapePreview shape={opt.value} />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Marker inner</legend>
        <p {...stylex.props(styles.eccHint)}>Center of the finder markers.</p>
        <div
          {...stylex.props(styles.eccGrid)}
          role="radiogroup"
          aria-label="Marker inner"
          style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
        >
          {MARKER_INNER_OPTIONS.map((opt) => {
            const selected = markerInner === opt.value
            return (
              <label
                key={opt.value}
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
                aria-selected={selected}
              >
                <input
                  type="radio"
                  name="markerInner"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onSettings({ markerInner: opt.value })}
                  {...stylex.props(styles.eccRadio)}
                  aria-label={`${opt.value} ${opt.hint}`}
                />
                <span {...stylex.props(styles.eccPreviewBox)}>
                  <MiniMarkerInnerPreview inner={opt.value} />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Sub marker</legend>
        <p {...stylex.props(styles.eccHint)}>Shape of alignment (sub) markers.</p>
        <div
          {...stylex.props(styles.eccGrid)}
          role="radiogroup"
          aria-label="Sub marker"
          style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
        >
          {MARKER_SUB_OPTIONS.map((opt) => {
            const selected = markerSub === opt.value
            return (
              <label
                key={opt.value}
                {...stylex.props(styles.eccCard, selected ? styles.eccCardSelected : null)}
                aria-selected={selected}
              >
                <input
                  type="radio"
                  name="markerSub"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onSettings({ markerSub: opt.value })}
                  {...stylex.props(styles.eccRadio)}
                  aria-label={`${opt.value} ${opt.hint}`}
                />
                <span {...stylex.props(styles.eccPreviewBox)}>
                  <MiniSubMarkerPreview sub={opt.value} />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
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
