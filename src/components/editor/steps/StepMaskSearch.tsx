import { TEXT_MASK_FONTS, TEXT_MASK_MAX_LENGTH } from '../../../lib/editor/text-mask'
import type { SearchControlState } from '../../../lib/editor/text-mask'
import type { IconSearch } from '../hooks/use-icon-search'
import type { MaskSelection } from '../hooks/use-mask-selection'

export default function StepMaskSearch({
  mask,
  search,
  suggestedMask,
  searchState,
  prepared,
  onSearch,
  onGoto,
}: {
  mask: MaskSelection
  search: IconSearch
  suggestedMask: string
  searchState: SearchControlState
  prepared: boolean
  onSearch: () => void
  onGoto: (index: number) => void
}) {
  const { text, font, fontId, isBlank, isIconMode, busy, tooSmall, effectiveMask, selectedIconId } = mask
  const { total, loading, error, fetchedQuery, galleryMode, results } = search
  const searchQuery = text.trim()
  return (
    <section>
      <h2>
        <span>02</span> Mask Search
      </h2>
      <label htmlFor="maskSearch">
        Mask Search
        <input
          id="maskSearch"
          aria-label="Mask search"
          aria-describedby="mask-search-hint"
          value={text}
          maxLength={TEXT_MASK_MAX_LENGTH}
          placeholder="Search icons or type a letter…"
          onChange={(e) => mask.setText(e.target.value.slice(0, TEXT_MASK_MAX_LENGTH))}
        />
      </label>
      <span id="mask-search-compat" style={{ display: 'none' }}>
        <label htmlFor="maskSearch">Mask text</label>
      </span>
      {suggestedMask ? (
        <p id="mask-search-hint" className="hint">
          Suggested letter <strong>{suggestedMask}</strong> from your link.
          {!isBlank && !isIconMode && (text.trim()[0] ?? '') !== suggestedMask && (
            <button className="text-button" onClick={() => mask.setText(suggestedMask)}>
              Use suggested letter
            </button>
          )}
        </p>
      ) : (
        <p id="mask-search-hint" className="hint">
          Plain text uses a blank region — pick any letter or search icons.
        </p>
      )}
      {loading && (
        <p className="hint" role="status">
          Searching icons…
        </p>
      )}
      {error && fetchedQuery === searchQuery && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && fetchedQuery === searchQuery && fetchedQuery && results.length === 0 && (
        <p className="hint">No icons found for “{fetchedQuery}”. Try another term.</p>
      )}
      {!loading && fetchedQuery === searchQuery && fetchedQuery && results.length > 0 && (
        <p className="hint">
          Found {total || results.length} icons for “{fetchedQuery}”.
        </p>
      )}
      <div className="font-row" role="radiogroup" aria-label="Mask options">
        {TEXT_MASK_FONTS.map((entry) => {
          const isBlankEntry = entry.id === 'blank'
          const selected = !selectedIconId && fontId === entry.id
          const glyph = effectiveMask || 'A'
          const disabled = busy || (!isBlankEntry && !effectiveMask)
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Mask font ${entry.label}`}
              title={entry.label}
              disabled={disabled}
              onClick={() => mask.selectFont(entry.id)}
              className={selected ? 'font-card selected' : 'font-card'}
            >
              {isBlankEntry ? (
                <>
                  <span className="font-glyph" style={{ fontSize: 14 }}>
                    blank
                  </span>
                  <span className="font-name">{entry.label}</span>
                </>
              ) : (
                <>
                  <span className="font-glyph" style={{ fontFamily: `"${entry.family}", sans-serif` }}>
                    {glyph}
                  </span>
                  <span className="font-name">{entry.label}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          aria-label="More icons"
          title={
            searchState === 'idle'
              ? 'Type a letter or word to search icons'
              : searchState === 'more'
                ? `Show ${total || results.length} icons for ${searchQuery}`
                : `Search icons for ${searchQuery}`
          }
          disabled={busy || loading}
          onClick={onSearch}
          className={galleryMode ? 'font-card selected' : 'font-card'}
          style={{ width: '100%' }}
        >
          <span className="font-glyph" style={{ fontSize: 16 }}>
            {loading
              ? '⋯ searching…'
              : searchState === 'more'
                ? `⋯ more — ${total || results.length} icons`
                : searchState === 'idle'
                  ? '⋯ search icons'
                  : `⋯ search ${searchQuery.slice(0, 10)}`}
          </span>
          <span className="font-name">{loading ? 'searching' : searchState === 'more' ? 'more icons' : 'search'}</span>
        </button>
        {searchState === 'idle' && !loading && <p className="hint">Type a letter or word to search icons.</p>}
      </div>
      {!isBlank && !isIconMode && font.note && (
        <p className="hint">
          {font.label}: {font.note}
        </p>
      )}
      {busy && (
        <p className="hint" role="status">
          Drawing mask…
        </p>
      )}
      {tooSmall && (
        <p className="error" role="alert">
          This {isIconMode ? 'icon' : 'letter'} leaves no room for the QR even at full height. Use a wider{' '}
          {isIconMode ? 'icon' : 'letter'}.
        </p>
      )}
      <div className="step-nav">
        <button onClick={() => onGoto(1)}>Back</button>
        <button className="primary" disabled={!prepared} onClick={() => onGoto(3)}>
          Continue
        </button>
      </div>
    </section>
  )
}
