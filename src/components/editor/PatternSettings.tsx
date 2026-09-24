'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { toast } from 'react-toastify'
import { encode } from 'uqr'
import '@simonwep/pickr/dist/themes/monolith.min.css'
import type { Settings } from '@/lib/editor/schema'
import { DEFAULT_PALETTE, paletteGuard, suggestPalette, type QrPalette } from '@/core/palette'
import { usePickr } from './hooks/use-pickr'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

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

const styles = stylex.create({
  panel: {
    minWidth: 0,
    padding: 18,
    containerType: 'inline-size',
    containerName: 'pattern-settings',
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  panelTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  eccFieldset: {
    borderWidth: 0,
    padding: 0,
    margin: '12px 0 0',
  },
  eccLegend: {
    fontSize: '0.9375rem',
    color: tokens.ink,
    marginBottom: 8,
    fontWeight: 600,
  },
  eccGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8,
    '@container pattern-settings (max-width: 23.75rem)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@container pattern-settings (max-width: 15rem)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  pixelGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    '@container pattern-settings (max-width: 23.75rem)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@container pattern-settings (max-width: 15rem)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  eccCard: {
    minWidth: 0,
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
      backgroundColor: tokens.accentSoftest,
    },
  },
  eccCardSelected: {
    backgroundColor: tokens.accentSoft,
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
    fontSize: '0.75rem',
    color: tokens.danger,
    textAlign: 'center',
    lineHeight: 1.3,
    paddingInline: 4,
  },
  eccLabel: {
    fontSize: '0.9375rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    lineHeight: 1,
  },
  eccRecovery: {
    fontSize: '0.75rem',
    color: tokens.inkMuted,
    lineHeight: 1,
  },
  colorsFieldset: {
    borderWidth: 0,
    padding: 0,
    margin: '12px 0 0',
  },
  colorsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    alignItems: 'start',
    gap: 6,
  },
  colorRow: {
    minWidth: 0,
  },
  colorButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    width: '100%',
    minWidth: 0,
    paddingInline: 4,
    paddingBlock: 6,
    backgroundColor: 'white',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: 999,
    boxShadow: tokens.shadowField,
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.accentSoftest },
  },
  colorChip: {
    width: 18,
    height: 18,
    flex: 'none',
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchAlt,
  },
  colorLabel: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: tokens.ink,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
})

function MiniPixelQrPreview({
  content,
  ecc,
  pixelStyle,
  allowEmpty = false,
}: {
  content: string
  ecc: 'L' | 'M' | 'Q' | 'H'
  pixelStyle: 'square' | 'rounded' | 'dot'
  allowEmpty?: boolean
}) {
  const ink = 'black'
  const light = 'white'
  const text = content.trim()
  if (!text && !allowEmpty) return <span {...stylex.props(styles.eccPreviewFallback)}>Generate content</span>
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
        <rect width={total} height={total} fill={light} />
        {rects.map((pos) => {
          const [x, y] = pos.split(',').map(Number) as [number, number]
          return <rect key={pos} x={x} y={y} width={1} height={1} fill={ink} />
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
        <rect width={total} height={total} fill={light} />
        {dots.map((pos) => {
          const [x, y] = pos.split(',').map(Number) as [number, number]
          return <circle key={pos} cx={x + 0.5} cy={y + 0.5} r={0.5} fill={ink} />
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
      <rect width={total} height={total} fill={light} />
      <path fill={ink} d={circles.join('')} />
      <path fill={ink} d={wedges.join('')} />
    </svg>
  )
}

type ColorKey = keyof QrPalette
const COLOR_PALETTE_TOAST_ID = 'editor-color-palette-error'
const COLOR_LABELS: Record<ColorKey, string> = {
  pixel: 'Pixel',
  marker: 'Marker',
  background: 'Background',
}
type RowCallbacks = {
  onChange: (hex: string) => void
  onCommit: (hex: string) => void
  onCancel: () => void
  onRevert: () => void
}

/**
 * One color control. The pickr popover renders inside the owning <dialog>; dragged
 * edits stay pending locally and every commit attempt passes the palette guard.
 */
function ColorRow({
  name,
  label,
  value,
  callbacks,
}: {
  name: ColorKey
  label: string
  value: string
  callbacks: RowCallbacks
}) {
  const pickrButtonRef = useRef<HTMLButtonElement | null>(null)
  usePickr({ buttonRef: pickrButtonRef, color: value, callbacks })
  return (
    <div {...stylex.props(styles.colorRow)}>
      <button
        ref={pickrButtonRef}
        type="button"
        {...stylex.props(styles.colorButton)}
        aria-haspopup="dialog"
        aria-label={`${label} color, currently ${value}. Opens the ${name} color picker`}
      >
        <span {...stylex.props(styles.colorChip)} style={{ backgroundColor: value }} />
        <span {...stylex.props(styles.colorLabel)}>{label}</span>
      </button>
    </div>
  )
}

export default function PatternSettings({
  settings,
  onSettings,
  onClose,
  closeButtonRef,
  isDialog,
}: {
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
  isDialog: boolean
}) {
  const ecc = (settings.ecc ?? 'M') as 'L' | 'M' | 'Q' | 'H'
  const pixelStyle = (settings.pixelStyle ?? 'dot') as 'square' | 'rounded' | 'dot'
  const committed: QrPalette = settings.colors ?? DEFAULT_PALETTE
  // Transient local UI state (the MarkerDialog precedent): uncommitted colors and which
  // rows the user customized this session. Only guard-passing palettes reach the store.
  const [pending, setPending] = useState<QrPalette | null>(null)
  const [customized, setCustomized] = useState<{ marker: boolean; background: boolean }>({
    marker: false,
    background: false,
  })
  const view: QrPalette = pending ?? committed
  const guard = paletteGuard(view)
  const paletteErrorVisible = useRef(false)
  useEffect(
    () => () => {
      toast.dismiss(COLOR_PALETTE_TOAST_ID)
    },
    [],
  )
  useEffect(() => {
    // A live correction or a cancel/revert can make the pending palette valid
    // without another explicit Save event. Remove feedback for that stale error.
    if (paletteErrorVisible.current && guard.ok) {
      toast.dismiss(COLOR_PALETTE_TOAST_ID)
      paletteErrorVisible.current = false
    }
  }, [guard.ok])
  const samePalette = (left: QrPalette, right: QrPalette): boolean =>
    left.pixel === right.pixel && left.marker === right.marker && left.background === right.background
  /** Commits when the guard passes; otherwise keeps pending colors and reports every issue once. */
  const attempt = (next: QrPalette) => {
    const result = paletteGuard(next)
    if (result.ok) {
      toast.dismiss(COLOR_PALETTE_TOAST_ID)
      paletteErrorVisible.current = false
      setPending(null)
      onSettings({ colors: next })
    } else {
      setPending(next)
      paletteErrorVisible.current = true
      const content = (
        <div>
          <span>Choose colors that keep the QR readable:</span>
          <ul>
            {result.issues.map((issue, index) => (
              <li key={`${issue.color}-${index}`}>
                {COLOR_LABELS[issue.color]}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )
      const options = {
        toastId: COLOR_PALETTE_TOAST_ID,
        autoClose: false as const,
        closeOnClick: false,
        role: 'alert' as const,
        ariaLabel: 'Color palette validation error',
      }
      if (toast.isActive(COLOR_PALETTE_TOAST_ID)) {
        toast.update(COLOR_PALETTE_TOAST_ID, { render: content, type: 'error', ...options })
      } else {
        toast.error(content, options)
      }
    }
  }
  const revertRow = (key: ColorKey) => {
    toast.dismiss(COLOR_PALETTE_TOAST_ID)
    paletteErrorVisible.current = false
    setPending((current) => {
      if (!current) return null
      const next: QrPalette = { ...current, [key]: committed[key] }
      return samePalette(next, committed) ? null : next
    })
  }
  const pixelCallbacks = {
    onChange: (hex: string) => setPending((current) => ({ ...(current ?? committed), pixel: hex })),
    onCommit: (hex: string) => {
      const suggested = suggestPalette(hex)
      attempt({
        pixel: hex,
        marker: customized.marker ? view.marker : suggested.marker,
        background: customized.background ? view.background : suggested.background,
      })
    },
    onCancel: () => revertRow('pixel'),
    onRevert: () => revertRow('pixel'),
  }
  const markerCallbacks = {
    onChange: (hex: string) => setPending((current) => ({ ...(current ?? committed), marker: hex })),
    onCommit: (hex: string) => {
      setCustomized((current) => ({ ...current, marker: true }))
      attempt({ ...view, marker: hex })
    },
    onCancel: () => revertRow('marker'),
    onRevert: () => revertRow('marker'),
  }
  const backgroundCallbacks = {
    onChange: (hex: string) => setPending((current) => ({ ...(current ?? committed), background: hex })),
    onCommit: (hex: string) => {
      setCustomized((current) => ({ ...current, background: true }))
      attempt({ ...view, background: hex })
    },
    onCancel: () => revertRow('background'),
    onRevert: () => revertRow('background'),
  }
  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelTop)}>
        <h2 {...stylex.props(ui.panelTitle)}>Pattern settings</h2>
        {isDialog && (
          <button ref={closeButtonRef} {...stylex.props(ui.button, ui.textButton)} type="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <fieldset {...stylex.props(styles.eccFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Error correction</legend>
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
                  <MiniPixelQrPreview content="" ecc={opt.value} pixelStyle="rounded" allowEmpty />
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
        <div {...stylex.props(styles.pixelGrid)} role="radiogroup" aria-label="Pixel style">
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
                  <MiniPixelQrPreview content="" ecc={ecc} pixelStyle={opt.value} allowEmpty />
                </span>
                <span {...stylex.props(styles.eccLabel)}>{opt.label}</span>
                <span {...stylex.props(styles.eccRecovery)}>{opt.hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset {...stylex.props(styles.colorsFieldset)}>
        <legend {...stylex.props(styles.eccLegend)}>Colors</legend>
        <div {...stylex.props(styles.colorsRow)}>
          <ColorRow name="pixel" label="Pixel" value={view.pixel} callbacks={pixelCallbacks} />
          <ColorRow name="marker" label="Marker" value={view.marker} callbacks={markerCallbacks} />
          <ColorRow name="background" label="Background" value={view.background} callbacks={backgroundCallbacks} />
        </div>
      </fieldset>
    </div>
  )
}
