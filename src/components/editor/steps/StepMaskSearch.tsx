import * as stylex from '@stylexjs/stylex'
import { TEXT_MASK_FONTS, TEXT_MASK_MAX_LENGTH } from '../../../lib/editor/text-mask'
import type { SearchControlState } from '../../../lib/editor/text-mask'
import type { IconSearch } from '../hooks/use-icon-search'
import type { MaskSelection } from '../hooks/use-mask-selection'
import { ui } from '../../../styles/ui.stylex'

const styles = stylex.create({
  /** Kept for the legacy label that some hosts still look up by id. */
  compat: {
    display: 'none',
  },
  fontSizeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    margin: '14px 0',
  },
  glyphSmall: {
    fontSize: 14,
  },
  glyphTight: {
    fontSize: 16,
  },
  searchBlock: {
    marginTop: 10,
  },
  searchButton: {
    width: '100%',
  },
  nav: {
    display: 'flex',
    gap: 12,
    marginTop: 18,
  },
})

export default function StepMaskSearch({
  mask,
  search,
  suggestedMask,
  searchState,
  blockedMessage,
  canContinue,
  onSearch,
  onContinue,
  onGoto,
}: {
  mask: MaskSelection
  search: IconSearch
  suggestedMask: string
  searchState: SearchControlState
  blockedMessage: string | null
  canContinue: boolean
  onSearch: () => void
  onContinue: () => void
  onGoto: (index: number) => void
}) {
  const { text, font, fontId, isBlank, isIconMode, busy, effectiveMask, selectedIconId } = mask
  const { total, loading, error, fetchedQuery, galleryMode, results } = search
  const searchQuery = text.trim()
  return (
    <section {...stylex.props(ui.section, ui.sectionFirst)}>
      <h2 {...stylex.props(ui.sectionHeading)}>
        <span {...stylex.props(ui.sectionNumber)}>02</span> Mask Search
      </h2>
      <label {...stylex.props(ui.label)} htmlFor="maskSearch">
        Mask Search
        <input
          {...stylex.props(ui.field)}
          id="maskSearch"
          aria-label="Mask search"
          aria-describedby="mask-search-hint"
          value={text}
          maxLength={TEXT_MASK_MAX_LENGTH}
          placeholder="Search icons or type a letter…"
          onChange={(e) => mask.setText(e.target.value.slice(0, TEXT_MASK_MAX_LENGTH))}
        />
      </label>
      <span id="mask-search-compat" {...stylex.props(styles.compat)}>
        <label {...stylex.props(ui.label)} htmlFor="maskSearch">
          Mask text
        </label>
      </span>
      {suggestedMask ? (
        <p id="mask-search-hint" {...stylex.props(ui.hint)}>
          Suggested letter <strong>{suggestedMask}</strong> from your link.
          {!isBlank && !isIconMode && (text.trim()[0] ?? '') !== suggestedMask && (
            <button {...stylex.props(ui.button, ui.textButton)} onClick={() => mask.setText(suggestedMask)}>
              Use suggested letter
            </button>
          )}
        </p>
      ) : (
        <p id="mask-search-hint" {...stylex.props(ui.hint)}>
          Plain text uses a blank region — pick any letter or search icons.
        </p>
      )}
      {loading && (
        <p {...stylex.props(ui.hint, ui.status)} role="status">
          Searching icons…
        </p>
      )}
      {error && fetchedQuery === searchQuery && (
        <p {...stylex.props(ui.error)} role="alert">
          {error}
        </p>
      )}
      {!loading && !error && fetchedQuery === searchQuery && fetchedQuery && results.length === 0 && (
        <p {...stylex.props(ui.hint)}>No icons found for “{fetchedQuery}”. Try another term.</p>
      )}
      {!loading && fetchedQuery === searchQuery && fetchedQuery && results.length > 0 && (
        <p {...stylex.props(ui.hint)}>
          Found {total || results.length} icons for “{fetchedQuery}”.
        </p>
      )}
      <div {...stylex.props(styles.fontSizeRow)} role="radiogroup" aria-label="Mask options">
        {TEXT_MASK_FONTS.map((entry, index) => {
          const isBlankEntry = entry.id === 'blank'
          const selected = !selectedIconId && fontId === entry.id
          const glyph = effectiveMask || 'A'
          const disabled = busy || (!isBlankEntry && !effectiveMask)
          return (
            <button
              key={entry.id}
              {...stylex.props(
                ui.button,
                ui.fontCard,
                index % 2 === 1 && ui.buttonAlt,
                selected && ui.fontCardSelected,
              )}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Mask font ${entry.label}`}
              title={entry.label}
              disabled={disabled}
              onClick={() => mask.selectFont(entry.id)}
            >
              {isBlankEntry ? (
                <>
                  <span {...stylex.props(ui.fontGlyph, styles.glyphSmall)}>blank</span>
                  <span {...stylex.props(ui.fontName)}>{entry.label}</span>
                </>
              ) : (
                <>
                  {/* The picked family is per-font data, so it stays an inline value. */}
                  <span {...stylex.props(ui.fontGlyph)} style={{ fontFamily: `"${entry.family}", sans-serif` }}>
                    {glyph}
                  </span>
                  <span {...stylex.props(ui.fontName)}>{entry.label}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div {...stylex.props(styles.searchBlock)}>
        <button
          {...stylex.props(ui.button, ui.fontCard, styles.searchButton, galleryMode && ui.fontCardSelected)}
          aria-label="More icons"
          aria-haspopup="dialog"
          title={
            searchState === 'idle'
              ? 'Type a letter or word to search icons'
              : searchState === 'more'
                ? `Show ${total || results.length} icons for ${searchQuery}`
                : `Search icons for ${searchQuery}`
          }
          disabled={busy || loading}
          onClick={onSearch}
        >
          <span {...stylex.props(ui.fontGlyph, styles.glyphTight)}>
            {loading
              ? '⋯ searching…'
              : searchState === 'more'
                ? `⋯ more — ${total || results.length} icons`
                : searchState === 'idle'
                  ? '⋯ search icons'
                  : `⋯ search ${searchQuery.slice(0, 10)}`}
          </span>
          <span {...stylex.props(ui.fontName)}>
            {loading ? 'searching' : searchState === 'more' ? 'more icons' : 'search'}
          </span>
        </button>
        {searchState === 'idle' && !loading && <p {...stylex.props(ui.hint)}>Type a letter or word to search icons.</p>}
      </div>
      {!isBlank && !isIconMode && font.note && (
        <p {...stylex.props(ui.hint)}>
          {font.label}: {font.note}
        </p>
      )}
      {busy && (
        <p {...stylex.props(ui.hint, ui.status)} role="status">
          Drawing mask…
        </p>
      )}
      {blockedMessage && (
        <p {...stylex.props(ui.error)} role="alert">
          {blockedMessage}
        </p>
      )}
      <div {...stylex.props(styles.nav)}>
        <button {...stylex.props(ui.button)} onClick={() => onGoto(1)}>
          Back
        </button>
        <button
          {...stylex.props(ui.button, ui.primary, ui.buttonAlt, ui.primaryStretch, ui.primaryShadow)}
          disabled={!canContinue}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </section>
  )
}
