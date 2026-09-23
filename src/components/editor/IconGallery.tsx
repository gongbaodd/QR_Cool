'use client'
import { useEffect, useId, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { IconItem } from '@/lib/editor/text-mask'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  /**
   * The card keeps the dialog's default block layout on purpose: an author `display`
   * value would outrank the UA rule that hides a closed `<dialog>`.
   */
  dialog: {
    width: 'min(880px, 92vw)',
    maxHeight: '86vh',
    overflow: 'auto',
    paddingBlock: 20,
    paddingInline: 22,
    color: tokens.ink,
    backgroundColor: tokens.card,
    fontFamily: tokens.handFont,
    fontSize: 19,
    lineHeight: 1.85,
    letterSpacing: '0.02em',
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
    '::backdrop': {
      backgroundColor: 'rgba(35, 39, 43, 0.45)',
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
    fontSize: 20,
    fontWeight: 400,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  progress: {
    width: 180,
    height: 12,
    accentColor: tokens.ink,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    marginTop: 6,
  },
  glyphFallback: {
    fontSize: 34,
    lineHeight: 1.25,
  },
  thumb: {
    width: 34,
    height: 34,
    objectFit: 'contain',
  },
})

function GalleryGlyph({ item }: { item: IconItem }) {
  const thumb = item.download || item.variants[0]?.download
  const [failed, setFailed] = useState(false)
  if (!thumb || failed) {
    return (
      <span aria-hidden="true" {...stylex.props(styles.glyphFallback)}>
        {(item.name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      {...stylex.props(styles.thumb)}
      src={thumb}
      alt=""
      width={34}
      height={34}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Step 2's icon picker. Opens as a native modal `<dialog>`: the browser owns the
 * top layer, outside-inert content and focus handling, so no focus trap lives here.
 */
export default function IconGallery({
  open,
  query,
  total,
  items,
  loading,
  selectedIconId,
  onSelect,
  onClose,
}: {
  open: boolean
  query: string
  total: number
  items: IconItem[]
  loading: boolean
  selectedIconId: string | null
  onSelect: (index: number) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const hintId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
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
  return (
    <dialog
      {...stylex.props(styles.dialog)}
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      aria-busy={loading}
      onClose={onClose}
    >
      <div {...stylex.props(styles.header)}>
        <h3 {...stylex.props(styles.title)} id={titleId}>
          {loading ? `Searching icons for “${query}”…` : `Icons for “${query}” — ${total || items.length}`}
        </h3>
        <button
          {...stylex.props(ui.button, ui.textButton)}
          type="button"
          aria-label="Close icon gallery"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <p {...stylex.props(ui.hint)} id={hintId}>
        {loading ? 'Loading matching icons…' : 'Pick an icon to draw it as your mask region.'}
      </p>
      {loading ? (
        <div {...stylex.props(styles.loading)}>
          <progress {...stylex.props(styles.progress)} aria-label="Searching icons" />
          <span>Searching the icon library…</span>
        </div>
      ) : (
        <div {...stylex.props(styles.grid)} data-testid="icon-gallery">
          {items.map((item, idx) => {
            const selected = selectedIconId === item.id
            return (
              <button
                key={item.id}
                {...stylex.props(ui.button, ui.fontCard, selected && ui.fontCardSelected)}
                type="button"
                aria-label={`Gallery icon ${item.name}`}
                title={`${item.vendor}/${item.name}`}
                onClick={() => onSelect(idx)}
              >
                <span {...stylex.props(ui.fontGlyph)}>
                  <GalleryGlyph item={item} />
                </span>
                <span {...stylex.props(ui.fontName)}>{item.name}</span>
              </button>
            )
          })}
          {items.length === 0 && <p {...stylex.props(ui.hint)}>No icons to show.</p>}
        </div>
      )}
    </dialog>
  )
}
