'use client'
import * as stylex from '@stylexjs/stylex'
import { TEXT_MASK_FONTS, TEXT_MASK_MAX_LENGTH, searchControlState } from '@/lib/editor/text-mask'
import type { IconSearch } from './hooks/use-icon-search'
import type { MaskSelection } from './hooks/use-mask-selection'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  card: {
    padding: 18,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  status: { fontSize: 15, color: tokens.green, margin: 0 },
  fontGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  search: { marginTop: 4 },
  iconButton: { width: '100%' },
  blankGlyph: {
    display: 'block',
    width: 24,
    height: 24,
    marginBlock: 10,
    backgroundColor: tokens.ink,
    borderWidth: 4,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 3,
  },
})

export default function MaskPanel({
  mask,
  search,
  onSearch,
}: {
  mask: MaskSelection
  search: IconSearch
  onSearch: () => void | Promise<void>
}) {
  const query = mask.text.trim()
  const searchState = searchControlState(query, search.fetchedQuery, search.results.length)
  return (
    <section {...stylex.props(styles.panel)} aria-label="Mask selection">
      <div {...stylex.props(styles.card)}>
        <span {...stylex.props(ui.eyebrow)}>MASK SELECTION</span>
        {!mask.isFollowingInput && (
          <>
            <p {...stylex.props(styles.status)} role="status">
              {`Custom mask · ${mask.isIconMode ? 'icon' : mask.isBlank ? 'blank' : mask.effectiveMask}`}
            </p>
            <p {...stylex.props(ui.hint)}>This mask stays fixed while the QR content changes.</p>
          </>
        )}
        {!mask.isFollowingInput && (
          <button {...stylex.props(ui.button, ui.textButton)} type="button" onClick={mask.followInput}>
            Follow input
          </button>
        )}
        <label {...stylex.props(ui.label)} htmlFor="maskSearch">
          Mask text or icon search
          <input
            {...stylex.props(ui.field)}
            id="maskSearch"
            name="maskSearch"
            value={mask.text}
            maxLength={TEXT_MASK_MAX_LENGTH}
            placeholder="Type a letter or search icons…"
            onChange={(event) => mask.setText(event.target.value)}
          />
        </label>
        <div {...stylex.props(styles.fontGrid)} role="radiogroup" aria-label="Mask font">
          {TEXT_MASK_FONTS.map((entry) => {
            const selected = !mask.selectedIconId && mask.fontId === entry.id
            return (
              <button
                key={entry.id}
                {...stylex.props(ui.button, ui.fontCard, selected && ui.fontCardSelected)}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={mask.busy}
                onClick={() => mask.selectFont(entry.id)}
              >
                {entry.id === 'blank' ? (
                  <span {...stylex.props(styles.blankGlyph)} aria-label="Blank full-canvas mask" />
                ) : (
                  <span {...stylex.props(ui.fontGlyph)} style={{ fontFamily: `"${entry.family}", sans-serif` }}>
                    {mask.effectiveMask || 'A'}
                  </span>
                )}
                <span {...stylex.props(ui.fontName)}>{entry.label}</span>
              </button>
            )
          })}
        </div>
        <div {...stylex.props(styles.search)}>
          <button
            {...stylex.props(ui.button, ui.fontCard, styles.iconButton)}
            type="button"
            aria-haspopup="dialog"
            disabled={mask.busy || search.loading || searchState === 'idle'}
            onClick={onSearch}
          >
            {search.loading
              ? 'Searching icons…'
              : searchState === 'more'
                ? `More icons (${search.total || search.results.length})`
                : `Search icons for “${query}”`}
          </button>
          {search.error && search.fetchedQuery === query && (
            <p {...stylex.props(ui.error)} role="alert">
              {search.error}
            </p>
          )}
        </div>
        {mask.busy && (
          <p {...stylex.props(ui.hint, ui.status)} role="status">
            Drawing mask…
          </p>
        )}
      </div>
    </section>
  )
}
