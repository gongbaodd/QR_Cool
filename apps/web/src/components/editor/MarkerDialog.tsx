'use client'
import { useEffect, useId, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'
import { DEFAULT_PALETTE } from '@mahu-qr/renderer/core/palette'
import type { QrPalette } from '@mahu-qr/renderer/core/palette'
import { squirclePath } from '@mahu-qr/renderer/core/squircle'
import type { Settings } from '@mahu-qr/renderer/schema'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const MARKER_SHAPE_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
  { value: 'octagon' as const, label: 'Octagon', hint: 'Octagon' },
  { value: 'squircle' as const, label: 'Squircle', hint: 'Squircle' },
] as const

const MARKER_INNER_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
  { value: 'plus' as const, label: 'Plus', hint: 'Plus' },
  { value: 'diamond' as const, label: 'Diamond', hint: 'Diamond' },
  { value: 'squircle' as const, label: 'Squircle', hint: 'Squircle' },
] as const

const MARKER_SUB_OPTIONS = [
  { value: 'square' as const, label: 'Square', hint: 'Square' },
  { value: 'circle' as const, label: 'Round', hint: 'Circle' },
] as const

const styles = stylex.create({
  /**
   * Like IconGallery: no author `display` value, so the UA rule can still hide
   * a closed `<dialog>`.
   */
  dialog: {
    width: 'min(55rem, 92vw)',
    maxHeight: '86vh',
    overflow: 'auto',
    paddingBlock: 20,
    paddingInline: 22,
    color: tokens.ink,
    backgroundColor: tokens.card,
    fontFamily: tokens.handFont,
    fontSize: '1.1875rem',
    lineHeight: 1.85,
    letterSpacing: '0.02em',
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '::backdrop': {
      backgroundColor: 'rgba(16, 18, 17, 0.45)',
      backdropFilter: 'blur(2px)',
    },
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: tokens.card,
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: 400,
  },
  fieldset: {
    borderWidth: 0,
    padding: 0,
    margin: '12px 0 0',
  },
  legend: {
    fontSize: '1rem',
    fontWeight: 600,
    color: tokens.ink,
    marginBottom: 4,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: 10,
    backgroundColor: 'white',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchAlt,
    boxShadow: tokens.shadowField,
  },
  toggleLabel: {
    fontSize: '0.9375rem',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  toggleButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: tokens.ink,
    cursor: 'pointer',
    fontFamily: tokens.handFont,
    fontSize: '0.8125rem',
    fontWeight: 600,
    lineHeight: 1,
  },
  toggleTrack: {
    display: 'flex',
    alignItems: 'center',
    width: 46,
    height: 26,
    padding: 3,
    borderRadius: 999,
    backgroundColor: tokens.inkMuted,
    transitionProperty: 'background-color',
    transitionDuration: '0.12s',
    transitionTimingFunction: 'ease',
  },
  toggleTrackOn: {
    backgroundColor: tokens.ink,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: 'white',
    transform: 'translateX(0)',
    transitionProperty: 'transform',
    transitionDuration: '0.12s',
    transitionTimingFunction: 'ease',
  },
  toggleThumbOn: {
    transform: 'translateX(20px)',
  },
  toggleState: {
    width: '2ch',
    fontSize: '0.8125rem',
    fontWeight: 600,
    textAlign: 'end',
  },
  applyAllRow: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 16,
  },
  grid: {
    display: 'grid',
    gap: 10,
  },
  card: {
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
    transitionProperty: 'transform, box-shadow, background-color, border-color',
    transitionDuration: '0.12s',
    transitionTimingFunction: 'ease',
    ':hover': {
      backgroundColor: tokens.accentSoftest,
    },
  },
  cardSelected: {
    backgroundColor: tokens.accentSoft,
    borderWidth: 3,
    boxShadow: tokens.shadow,
  },
  cardFocus: {
    ':has(input:focus-visible)': {
      outlineWidth: 3,
      outlineStyle: 'dotted',
      outlineColor: tokens.accent,
      outlineOffset: 3,
    },
  },
  radio: {
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0,
    pointerEvents: 'none',
  },
  previewBox: {
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
  label: {
    fontSize: '0.9375rem',
    fontWeight: 700,
    lineHeight: 1,
  },
  sub: {
    fontSize: '0.75rem',
    color: tokens.inkMuted,
    lineHeight: 1,
  },
})

function MiniMarkerShapePreview({
  shape,
  palette,
}: {
  shape: 'square' | 'circle' | 'octagon' | 'squircle'
  palette: QrPalette
}) {
  const ink = palette.marker
  const light = palette.background
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
        <rect width={7} height={7} fill={light} />
        <rect x={ox} y={oy} width={7} height={7} fill={ink} />
        <rect x={1} y={1} width={5} height={5} fill={light} />
        <rect x={2} y={2} width={3} height={3} fill={ink} />
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
        <rect width={7} height={7} fill={light} />
        <circle cx={cx} cy={cy} r={3.5} fill={ink} />
        <circle cx={cx} cy={cy} r={2.5} fill={light} />
        <circle cx={cx} cy={cy} r={1.5} fill={ink} />
      </svg>
    )
  }
  if (shape === 'squircle') {
    return (
      <svg
        viewBox="0 0 7 7"
        width={48}
        height={48}
        role="img"
        aria-label={`marker ${shape}`}
        style={{ display: 'block' }}
      >
        <rect width={7} height={7} fill={light} />
        <path d={squirclePath(cx, cy, 3.5)} fill={ink} />
        <path d={squirclePath(cx, cy, 2.5)} fill={light} />
        <circle cx={cx} cy={cy} r={1.5} fill={ink} />
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
      <rect width={7} height={7} fill={light} />
      <polygon points={outerPts} fill={ink} />
      <polygon points={innerPts} fill={light} />
      <circle cx={cx} cy={cy} r={1.5} fill={ink} />
    </svg>
  )
}

function MiniMarkerInnerPreview({
  inner,
  palette,
}: {
  inner: 'square' | 'circle' | 'plus' | 'diamond' | 'squircle'
  palette: QrPalette
}) {
  const ink = palette.marker
  const light = palette.background
  const cx = 3.5,
    cy = 3.5
  return (
    <svg viewBox="0 0 7 7" width={48} height={48} role="img" aria-label={`inner ${inner}`} style={{ display: 'block' }}>
      <rect width={7} height={7} fill={light} />
      <rect x={0} y={0} width={7} height={7} fill={ink} />
      <rect x={1} y={1} width={5} height={5} fill={light} />
      {inner === 'square' && <rect x={2} y={2} width={3} height={3} fill={ink} />}
      {inner === 'circle' && <circle cx={cx} cy={cy} r={1.5} fill={ink} />}
      {inner === 'plus' && (
        <>
          <rect x={cx - 0.5} y={cy - 1.5} width={1} height={3} fill={ink} />
          <rect x={cx - 1.5} y={cy - 0.5} width={3} height={1} fill={ink} />
        </>
      )}
      {inner === 'diamond' && (
        <polygon points={`${cx},${cy - 1.5} ${cx + 1.5},${cy} ${cx},${cy + 1.5} ${cx - 1.5},${cy}`} fill={ink} />
      )}
      {inner === 'squircle' && <path d={squirclePath(cx, cy, 1.5)} fill={ink} />}
    </svg>
  )
}

function MiniSubMarkerPreview({ sub, palette }: { sub: 'square' | 'circle'; palette: QrPalette }) {
  const ink = palette.marker
  const light = palette.background
  const cx = 2.5,
    cy = 2.5
  if (sub === 'square') {
    return (
      <svg viewBox="0 0 5 5" width={48} height={48} role="img" aria-label={`sub ${sub}`} style={{ display: 'block' }}>
        <rect width={5} height={5} fill={light} />
        <rect x={0} y={0} width={5} height={5} fill={ink} />
        <rect x={1} y={1} width={3} height={3} fill={light} />
        <rect x={2} y={2} width={1} height={1} fill={ink} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 5 5" width={48} height={48} role="img" aria-label={`sub ${sub}`} style={{ display: 'block' }}>
      <rect width={5} height={5} fill={light} />
      <circle cx={cx} cy={cy} r={2.5} fill={ink} />
      <circle cx={cx} cy={cy} r={1.5} fill={light} />
      <circle cx={cx} cy={cy} r={0.5} fill={ink} />
    </svg>
  )
}

function OptionCards<T extends string>({
  name,
  options,
  value,
  ariaLabel,
  onSelect,
  renderPreview,
}: {
  name: string
  options: ReadonlyArray<{ value: T; label: string; hint: string }>
  value: T
  ariaLabel: string
  onSelect: (value: T) => void
  renderPreview: (value: T) => React.ReactNode
}) {
  return (
    <div
      {...stylex.props(styles.grid)}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))' }}
    >
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <label
            key={opt.value}
            {...stylex.props(styles.card, selected ? styles.cardSelected : null, styles.cardFocus)}
            aria-selected={selected}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onSelect(opt.value)}
              {...stylex.props(styles.radio)}
              aria-label={`${opt.label} ${ariaLabel.toLowerCase()}`}
            />
            <span {...stylex.props(styles.previewBox)}>{renderPreview(opt.value)}</span>
            <span {...stylex.props(styles.label)}>{opt.label}</span>
            <span {...stylex.props(styles.sub)}>{opt.hint}</span>
          </label>
        )
      })}
    </div>
  )
}

/**
 * Marker settings dialog for step 3. One native `<dialog>` reused for both the
 * each finder marker (kind="tl" | "tr" | "bl") and the bottom-right
 * alignment marker (kind="sub"); radio changes commit through the normal settings pipeline.
 */
export default function MarkerDialog({
  kind,
  settings,
  onSettings,
  onClose,
}: {
  kind: 'tl' | 'tr' | 'bl' | 'sub' | null
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (kind && !dialog.open) dialog.showModal()
    else if (!kind && dialog.open) dialog.close()
  }, [kind])
  // Esc, the close button and `closedby` handle most dismissals; older browsers
  // get the backdrop click back by measuring the click against the dialog box.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    const onClick = (event: MouseEvent) => {
      if (event.target !== dialog) return
      const rect = dialog.getBoundingClientRect()
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      if (!inside) dialog.close()
    }
    dialog.addEventListener('click', onClick)
    return () => dialog.removeEventListener('click', onClick)
  }, [])
  const finder = kind !== 'sub'
  const finderId = kind === 'tr' || kind === 'bl' ? kind : 'tl'
  const finderPosition = { tl: 'Top Left', tr: 'Top Right', bl: 'Bottom Left' }[finderId]
  const finderMarker = settings.finderMarkers[finderId]
  const markerStyle = finderMarker.style
  const markerShape = finderMarker.shape
  const markerInner = finderMarker.inner
  const markerSub = (settings.markerSub ?? 'square') as 'square' | 'circle'
  const palette = settings.colors ?? DEFAULT_PALETTE
  const updateFinder = (patch: Partial<typeof finderMarker>) =>
    onSettings({ finderMarkers: { ...settings.finderMarkers, [finderId]: { ...finderMarker, ...patch } } })
  return (
    <dialog {...stylex.props(styles.dialog)} ref={dialogRef} closedby="any" aria-labelledby={titleId} onClose={onClose}>
      <div {...stylex.props(styles.header)}>
        <h3 {...stylex.props(styles.title)} id={titleId}>
          {finder ? `${finderPosition} finder marker` : 'Alignment marker'}
        </h3>
        <button
          {...stylex.props(ui.button, ui.focusVisible, ui.textButton)}
          type="button"
          aria-label="Close marker settings"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {finder ? (
        <>
          <div {...stylex.props(styles.fieldset)}>
            <div {...stylex.props(styles.toggleRow)}>
              <span id="rounded-marker-pixels-label" {...stylex.props(styles.toggleLabel)}>
                Rounded marker pixels
              </span>
              <button
                type="button"
                role="switch"
                aria-labelledby="rounded-marker-pixels-label"
                aria-checked={markerStyle === 'rounded'}
                {...stylex.props(styles.toggleButton, ui.focusVisible)}
                onClick={() => updateFinder({ style: markerStyle === 'rounded' ? 'square' : 'rounded' })}
              >
                <span {...stylex.props(styles.toggleTrack, markerStyle === 'rounded' && styles.toggleTrackOn)}>
                  <span {...stylex.props(styles.toggleThumb, markerStyle === 'rounded' && styles.toggleThumbOn)} />
                </span>
                <span aria-hidden="true" {...stylex.props(styles.toggleState)}>
                  {markerStyle === 'rounded' ? 'On' : 'Off'}
                </span>
              </button>
            </div>
          </div>
          <fieldset {...stylex.props(styles.fieldset)}>
            <legend {...stylex.props(styles.legend)}>Marker shape</legend>
            <OptionCards
              name="markerShape"
              options={MARKER_SHAPE_OPTIONS}
              value={markerShape}
              ariaLabel="Marker shape"
              onSelect={(markerShapeValue) => updateFinder({ shape: markerShapeValue })}
              renderPreview={(value) => <MiniMarkerShapePreview shape={value} palette={palette} />}
            />
          </fieldset>
          <fieldset {...stylex.props(styles.fieldset)}>
            <legend {...stylex.props(styles.legend)}>Marker inner</legend>
            <OptionCards
              name="markerInner"
              options={MARKER_INNER_OPTIONS}
              value={markerInner}
              ariaLabel="Marker inner"
              onSelect={(markerInnerValue) => updateFinder({ inner: markerInnerValue })}
              renderPreview={(value) => <MiniMarkerInnerPreview inner={value} palette={palette} />}
            />
          </fieldset>
          <div {...stylex.props(styles.applyAllRow)}>
            <button
              {...stylex.props(ui.button, ui.focusVisible, ui.primary)}
              type="button"
              onClick={() => onSettings({ finderMarkers: { tl: finderMarker, tr: finderMarker, bl: finderMarker } })}
            >
              Apply to all finder markers
            </button>
          </div>
        </>
      ) : (
        <div {...stylex.props(styles.fieldset)}>
          <OptionCards
            name="markerSub"
            options={MARKER_SUB_OPTIONS}
            value={markerSub}
            ariaLabel="Alignment marker shape"
            onSelect={(markerSubValue) => onSettings({ markerSub: markerSubValue })}
            renderPreview={(value) => <MiniSubMarkerPreview sub={value} palette={palette} />}
          />
        </div>
      )}
    </dialog>
  )
}
