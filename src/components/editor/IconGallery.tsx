import * as stylex from '@stylexjs/stylex'
import type { IconItem } from '../../lib/editor/text-mask'
import { tokens } from '../../styles/tokens.stylex'
import { ui } from '../../styles/ui.stylex'

const styles = stylex.create({
  wrap: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    overflow: 'hidden',
    backgroundColor: tokens.card,
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    margin: 0,
    fontSize: 18,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
    gap: 10,
    maxHeight: 560,
    padding: 4,
    overflow: 'auto',
    scrollbarWidth: 'thin',
  },
  card: {
    minHeight: 84,
  },
  glyph: {
    width: 44,
    height: 44,
    color: 'white',
    backgroundColor: 'black',
    borderRadius: 6,
  },
  glyphInitial: {
    fontSize: 20,
  },
  thumb: {
    marginTop: -34,
    filter: 'invert(1)',
    objectFit: 'contain',
  },
})

export default function IconGallery({
  query,
  total,
  items,
  selectedIconId,
  onSelect,
  onClose,
}: {
  query: string
  total: number
  items: IconItem[]
  selectedIconId: string | null
  onSelect: (index: number) => void
  onClose: () => void
}) {
  return (
    <div {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.header)}>
        <h3 {...stylex.props(styles.title)}>
          Icons for “{query}” — {total || items.length}
        </h3>
        <button {...stylex.props(ui.button, ui.textButton)} onClick={onClose}>
          Back to preview
        </button>
      </div>
      <div {...stylex.props(styles.grid)} data-testid="icon-gallery">
        {items.map((item, idx) => {
          const thumb = item.download || item.variants[0]?.download
          const selected = selectedIconId === item.id
          return (
            <button
              key={item.id}
              {...stylex.props(ui.button, ui.fontCard, styles.card, selected && ui.fontCardSelected)}
              type="button"
              aria-label={`Gallery icon ${item.name}`}
              title={`${item.vendor}/${item.name}`}
              onClick={() => onSelect(idx)}
            >
              <span {...stylex.props(ui.fontGlyph, styles.glyph)}>
                <span aria-hidden="true" {...stylex.props(styles.glyphInitial)}>
                  {(item.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <img
                  {...stylex.props(styles.thumb)}
                  src={thumb}
                  alt=""
                  width={28}
                  height={28}
                  loading="lazy"
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              </span>
              <span {...stylex.props(ui.fontName)}>{item.name}</span>
            </button>
          )
        })}
        {items.length === 0 && <p {...stylex.props(ui.hint)}>No icons to show.</p>}
      </div>
    </div>
  )
}
