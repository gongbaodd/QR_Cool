'use client'
import type { RefObject } from 'react'
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
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  closeButton: { display: 'grid', placeItems: 'center', minWidth: 44, minHeight: 44, padding: 0 },
  fontGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 4.5rem), 1fr))',
    gap: 8,
  },
  inputWrap: { position: 'relative', marginTop: 8 },
  maskField: { marginTop: 0, marginBottom: 12, paddingInlineEnd: '3.75rem' },
  searchButton: {
    position: 'absolute',
    top: 'calc(50% - 1.25rem)',
    right: 8,
    display: 'grid',
    placeItems: 'center',
    width: '2.5rem',
    height: '2.5rem',
    paddingBlock: 0,
    paddingInline: 0,
    transform: 'none',
    transitionProperty: 'background-color',
    transitionDuration: '0ms',
    ':active': { transform: 'none', boxShadow: tokens.shadow },
    ':disabled': { transform: 'none' },
    ':hover:not(:disabled)': { transform: 'none' },
    // Keep the hit area stationary; the shared sketch button's pressed motion
    // makes this small control difficult to track while clicking.
  },
  searchIcon: { width: 22, height: 22, display: 'block' },
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
  onClose,
  closeButtonRef,
  isDialog,
}: {
  mask: MaskSelection
  search: IconSearch
  onSearch: () => void | Promise<void>
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
  isDialog: boolean
}) {
  const query = mask.text.trim()
  const searchState = searchControlState(query, search.fetchedQuery, search.results.length)
  return (
    <section {...stylex.props(styles.panel)} aria-label="Mask selection">
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.cardTop)}>
          <h2 {...stylex.props(ui.panelTitle)}>MASK SELECTION</h2>
          {isDialog && (
            <button
              ref={closeButtonRef}
              aria-label="Close mask selection"
              {...stylex.props(ui.button, ui.focusVisible, styles.closeButton)}
              type="button"
              onClick={onClose}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <label {...stylex.props(ui.label)} htmlFor="maskSearch">
          Mask text or icon search
        </label>
        <div {...stylex.props(styles.inputWrap)}>
          <input
            {...stylex.props(ui.field, ui.focusVisible, styles.maskField)}
            id="maskSearch"
            name="maskSearch"
            value={mask.text}
            maxLength={TEXT_MASK_MAX_LENGTH}
            placeholder="Type a letter or search icons…"
            onChange={(event) => mask.setText(event.target.value)}
          />
          <button
            {...stylex.props(ui.button, ui.focusVisible, styles.searchButton)}
            type="button"
            aria-haspopup="dialog"
            aria-label={
              search.loading
                ? 'Searching icons'
                : searchState === 'more'
                  ? `Show more icons (${search.total || search.results.length})`
                  : query
                    ? `Search icons for “${query}”`
                    : 'Search icons'
            }
            title={search.loading ? 'Searching icons' : 'Search icons'}
            disabled={mask.busy || search.loading || searchState === 'idle'}
            onClick={onSearch}
          >
            <svg {...stylex.props(styles.searchIcon)} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m16 16 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div {...stylex.props(styles.fontGrid)} role="radiogroup" aria-label="Mask font">
          {TEXT_MASK_FONTS.map((entry) => {
            const selected = !mask.selectedIconId && mask.fontId === entry.id
            return (
              <button
                key={entry.id}
                {...stylex.props(ui.button, ui.focusVisible, ui.fontCard, selected && ui.fontCardSelected)}
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
        {mask.busy && (
          <p {...stylex.props(ui.hint, ui.status)} role="status">
            Drawing mask…
          </p>
        )}
      </div>
    </section>
  )
}
