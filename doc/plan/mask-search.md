# Plan: Step 2 — Mask Search (3×4 grid + icons.grida.co)

Status: draft for review — no code changed yet. Implements user request:
> step 2, sidebar, Mask Letter turn into "Mask Search", allow me to input more in the input field and search, options keep 3x4. the last one is "more", click more can see all the icons searched from "https://icons.grida.co/api/search?q=". Front 3 still keeps first letter rule, last 9 show the search result if the search content length > 1

## 1. Current behavior (for diff)

- `src/lib/editor/text-mask.ts:15-31` defines `TEXT_MASK_FONTS` (blank + 11 display fonts) and `TEXT_MASK_MAX_LENGTH = 1`, `TEXT_MASK_DEFAULT_TEXT = 'Q'`.
- `deriveMaskLetter()` suggests one letter from step 1 URL (`http://ABCD.com` → `A`).
- `src/components/editor/Editor.tsx:42-197` renders step 2:
  - header `02 select mask`
  - `<input aria-label="Mask text" maxLength=1 disabled={isBlank}>` bound to `maskText`
  - hint about suggested letter
  - `.font-row` grid (`globals.css:210` = `repeat(auto-fill, minmax(78px,1fr))`) listing all fonts as `role=radio`; click calls `applyTextMask(fontId)` which does `drawTextMask(width,height,text,family,capPx)` on a fixed 1000×1000 canvas (or `drawBlankMask` for blank) and uploads as `text-mask.png`.
  - preview canvas `maskPreview` mirrors same draw logic.
  - no network except poster/prepare/assemble.
- `doc/plan/web-qr-poster.md:14`, `README.md:27`, `e2e/editor.spec.ts:99-132` assert the single-char, full-height default and warning for too-small letters.

## 2. Target behavior

### 2.1 Heading & input

- Rename step 2 heading/label from `select mask` / `Mask letter` to `Mask Search` (keep `02` badge, eyebrow `STEP 2 OF 4`).
- Input: `aria-label="Mask search"` (keep `aria-label="Mask text"` as alias for e2e compat if needed, or update tests). Behaviors:
  - `maxLength` = **10** (new constant `TEXT_MASK_SEARCH_MAX_LENGTH = 10`, replacing `TEXT_MASK_MAX_LENGTH = 1`). Per latest requirement. Allow typing query like `heart`, `star`, `arrow1234`.
  - `disabled` no longer tied to `isBlank` — input always editable except while `maskBusy`. Blank is now just tile 0 of the grid, not a mode that disables typing.
  - `onChange` debounces search (300 ms) when `trimmed.length > 1`; otherwise clears icon results.
  - Placeholder: `Search icons or type a letter…` Hint line below: when `length <=1` show existing suggested-letter hint; when `>1` show `Searching icons for "…"` / result count.
  - Keep `effectiveMask = (maskSearch.trim()[0] || suggestedMask).slice(0,1).toUpperCase()` for the front-3 letter tiles — first char rule unchanged, capped at 10 but only first char used for letters.

### 2.2 Grid: strict 3×4 = 12 tiles

Change `globals.css`:
```css
.font-row { grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; gap: 10px; }
```
12 tiles always rendered, no auto-fill.

Layout proposal (to satisfy literal spec “front 3 letter, last 9 icons, last one more” — see §7 open question):

**Option A — strict 12 incl. More (proposed default):**
| idx | content | rule |
| 0 | `blank` — full canvas | always |
| 1 | Letter tile — first char in `Fathead` (or current `maskFontId` family?) | derived from `effectiveMask` (fallback `A`) |
| 2 | Letter tile — first char in `FatC` | same letter |
| 3-10 | Icon tiles — up to 8 results from search | visible only if `query.trim().length > 1` and results exist; otherwise show placeholder/disabled empty state (“Type 2+ chars to search icons”) |
| 11 | `more` tile | always last; enabled iff `searchTotal > 8`; label `more (+N)` where N = total - 8. Click opens gallery modal |

This yields 3 letter-rule tiles (0 is blank — counts as letter-rule family, 1-2 are the “front 3” if you count blank), 8 icon tiles + 1 more = 9 slots devoted to search. If strict “front 3 = three letter fonts” is required without blank counting, shift to 3 letter fonts at 0-2 and move blank to a separate “Blank” affordance above grid — alternatives in §7.

**Option B — 12 icon/content tiles + More outside grid (satisfies “last 9 are icons” literally):**
- Grid = 3 + 9 =12 content tiles (0-2 letters, 3-11 icons = 9 icons)
- `more` is a separate button/row below grid (`<button aria-label="More icons">More — see all N results</button>`) that opens gallery. Grid stays 3×4 pure content.

Pick one; implementation keeps grid size fixed either way so `pnpm test:e2e` viewport math unchanged.

Tiles:
- Letter tile: `<span class="font-glyph" style="fontFamily: 'Fathead'">A</span>` + font name below. Selected state when `maskFontId` matches and query’s first char is active.
- Icon tile: render `item.variants[0].download` or primary `download` SVG as `<img>` or inline `<svg>` (fetched). Use white-on-black preview? For grid thumbnail, show black bg with white icon centered (same as mask preview). Selected state highlights same as letter.
- Empty/disabled icon tile: dashed border, hint text.
- `more` tile: centered `⋯ more` + count; `aria-label="More icons"`.

Click behavior:
- Letter tile click → `setMaskFontId(fontId)` + `applyTextMask(fontId)` with `effectiveMask` char.
- Icon tile click → `setMaskFontId('icon:'+iconId)` or new `maskIconId` state, then `applyIconMask(iconSvgUrl)` (see §4).
- More click → open modal (see §5).

### 2.3 Search trigger

- Condition: `query.trim().length > 1` (spec) — single char stays letter-only, no icon fetch. Prevent noisy 1-char queries.
- Debounce 350 ms, abort previous fetch via `AbortController`.
- Source: `GET https://icons.grida.co/api/search?q=<encoded>` — response shape verified 2026-09-19: `{ total, count, limit, offset, items: [{ id, vendor, name, tags, download, variants: [{ download }] }] }` (see `webfetch` test with `q=heart` → 41 items).
- Client will not call grida directly if CORS blocks; route through Next proxy (see §3).

### 2.4 Selection & mask preview

Reuse existing `maskPreview` canvas (600×600). For preview:
- If selected is letter/blank → current `drawTextMask` / `drawBlankMask` logic.
- If selected is icon → new `drawIconMask(width, height, svgText, capPx)` draws white icon on black, centered, scaled to fit `width*0.94` × `capPx` (same cap as letters: `defaultTextMaskSize(width,height)`). Keep `largestWhiteSquare` check for too-small icon (same `maskTooSmall` warning).

Upload path unchanged: `canvas.toBlob → File(TEXT_MASK_FILENAME) → setMask → request('prepare')`.

### 2.5 Accessibility

- Grid remains `role="radiogroup"`; tiles `role="radio" aria-checked`.
- Input `aria-label="Mask search"` + `aria-describedby` hint.
- More tile `role="button"` or `radio`? Use `button` outside radiogroup to avoid a11y confusion; separate.

## 3. API / Network

Add proxy to avoid CORS and allow mocking in tests:

- `src/app/api/icons/route.ts` (Node runtime):
  ```ts
  export async function GET(req: Request) {
    const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
    if (q.length <= 1) return Response.json({ total:0, count:0, items:[] })
    const upstream = await fetch(`https://icons.grida.co/api/search?q=${encodeURIComponent(q)}`, { next: { revalidate: 60 } })
    // pass through JSON, handle errors, Cache-Control: no-store or short cache
  }
  ```
- Client fetches `/api/icons?q=...` instead of grida directly.
- Tests never make paid calls: mock `fetch` for `/api/icons` (Vitest) and stub Playwright `route` for `**/api/icons*`.
- Rate limit / timeout handling: map upstream failure to empty result + hint “Couldn’t search icons — try again”.

Consider caching: in-memory `Map<q, items>` on client for session, plus `SWR` style dedupe.

## 4. Rendering icons to mask PNG

New helper in `src/lib/editor/text-mask.ts` or `src/components/editor/Editor.tsx`:

```ts
async function drawIconMask(width:number, height:number, svgUrl:string, capPx:number): Promise<HTMLCanvasElement> {
  const svgText = await fetch(svgUrl).then(r=>r.text())
  // optionally sanitize, ensure viewBox
  const img = new Image()
  const blob = new Blob([svgText], {type:'image/svg+xml'})
  const url = URL.createObjectURL(blob)
  await new Promise((res, rej)=>{ img.onload=res; img.onerror=rej; img.src=url })
  const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle='black'; ctx.fillRect(0,0,width,height)
  // compute fit: preserve aspect, cap by height and width*0.94
  const maxW = width*0.94, maxH = capPx
  const scale = Math.min(maxW/img.width, maxH/img.height, 1)
  const drawW = img.width*scale, drawH = img.height*scale
  ctx.fillStyle='white'
  // For SVG-as-image, we need to draw white: easiest is to draw image then use globalCompositeOperation to tint white where opaque.
  // Approach: draw image to temp canvas, then fill white where alpha>0.
  // Simpler: if SVG is single-color currentColor, we can recolor by replacing `fill="currentColor"` with `white` in svgText before loading.
  ctx.drawImage(img, (width-drawW)/2, (height-drawH)/2, drawW, drawH)
  URL.revokeObjectURL(url)
  return canvas
}
```

Alternative robust path: parse SVG, replace strokes/fills with white, ensure `viewBox` exists, then draw.

Keep `largestWhiteSquare` validation same as letter path.

Note: need `document.fonts` not needed for icons; `maskBusy` guards both.

## 5. “More” — gallery lives in the Mask Preview area + nearest-12 paging

Per latest requirement: **maxlength 10; show-more shows options in Mask preview area; when selecting one, the 12 sidebar options turn into the nearest 12 ones.**

Spec refined:

- **No modal/portal.** Step 2 right pane is dual-mode:
  - **Default (maskPreviewMode):** existing 600×600 `<canvas ref={maskPreview}>` shows black/white preview of the current selection (letter or icon at `effectiveMask` / `selectedIcon`).
  - **GalleryMode (triggered by tile 11 “more” click):** the same `.mask-preview-wrap` container swaps the canvas for a scrollable gallery grid rendering **all** `iconResults` (up to `limit=100` from `GET /api/icons?q=`). The sidebar stays visible. Gallery header shows `Icons for "query" (N)` and a `Back to preview` button.

- **Gallery grid inside preview area:**
  - Layout: `display:grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap:10px; overflow:auto; max-height: 560px` (fits the `600×600` preview frame; keeps `.mask-preview-wrap` styling but with `background: var(--card)` when in gallery).
  - Each cell: icon thumbnail (white on black, same as sidebar tiles), `aria-label` = `icon.id`, `role=button`. Hover/selected highlight matches `.font-card.selected`.
  - Gallery supports keyboard navigation and click. Data source is the already-fetched `iconResults` (no second fetch). If `total > iconResults.length` (paginate), “Load more” at bottom can fetch `?offset=` — v1 can just show first 100.

- **Selection from gallery → sidebar “nearest 12” windowing:**

  Define:
  ```ts
  const SIDEBAR_LETTER_COUNT = 3   // tiles 0-2 (blank + 2 fonts) — keep first-letter rule, fixed
  const SIDEBAR_ICON_WINDOW = 8    // tiles 3-10 show a window of icons
  const SIDEBAR_MORE_IDX = 11      // tile 11 = "more"
  // sidebar display when in default mode:
  // [0 blank, 1 letter Fathead, 2 letter FatC, 3..10 iconWindow, 11 more]
  ```

  When user clicks gallery icon at global index `selectedIdx` (0-based in `iconResults`):
  1. Apply mask immediately: `selectedIconId = iconResults[selectedIdx].id`, call `applyIconMask(icon)` (draws 1000×1000 mask PNG, `setMask`, preview canvas exits galleryMode back to maskPreviewMode).
  2. **Re-window sidebar:** compute `iconWindowOffset = clamp(selectedIdx - Math.floor(SIDEBAR_ICON_WINDOW/2), 0, max(0, total - SIDEBAR_ICON_WINDOW))`. E.g. selected 20 out of 41 → window `16..23` (8 icons). This is the “nearest 12” — 12 total tiles includes 3 letters + 8 window icons + more =12; nearest refers to nearest icons around selection, letters stay fixed (still first-char rule). If spec intends whole 12 to be icons (letters replaced), we instead set `window = 12` and statement means all 12 tiles become icons around selection; see §7 Q1.
  3. Sidebar icon tiles 3-10 re-render to `iconResults.slice(iconWindowOffset, iconWindowOffset+8)`. The clicked icon is marked selected. `more` tile stays enabled if there are icons outside the window.

  Edge: if query changes, reset `iconWindowOffset = 0` and exit galleryMode if open.

- **More tile behavior when galleryMode is active:** toggles back to preview (same as Back button). More tile gets `aria-pressed` to indicate gallery open.

- **Alternative literal “nearest 12” = sidebar becomes 12 icons (letters hidden) after gallery select:** if that is intended, the window size becomes `12` (not 8) and after selection the grid renders `iconResults.slice(offset, offset+12)` occupying all 3×4 cells (tile 11 still “more” would be tile 12 overlapping — would need to keep more as 13th affordance). Plan keeps letters fixed (3) per “Front 3 still keeps first letter rule” — so nearest-12 is interpreted as nearest-8 icons + 3 letters + more =12. Open question clarified in §7 (now updated).

No extra route beyond proxy; reuse already-fetched items.

## 6. File changes inventory

- `src/lib/editor/text-mask.ts`
  - Set `TEXT_MASK_MAX_LENGTH = 10` (breaking: was 1). Export alias `TEXT_MASK_SEARCH_MAX_LENGTH = 10` if needed. Update JSDoc.
  - Add types: `IconItem`, `IconVariant`, `IconSearchResponse`, plus window constants `MASK_SEARCH_LETTER_TILES=3`, `MASK_SEARCH_ICON_WINDOW=8`, `MASK_SEARCH_GRID_SIZE=12`.
  - Add pure helper `nearestWindow(selectedIdx, total, windowSize)` for paging tests.

- `src/components/editor/Editor.tsx`
  - Rename state `maskText` → `maskSearch` (keep `maskText` alias for compat) with `maxLength=10`.
  - New states: `iconResults`, `iconTotal`, `iconLoading`, `iconError`, `selectedIconId`, `galleryMode` (bool, controls preview-pane swap), `iconWindowOffset` (number).
  - Debounced `useEffect` for search → `/api/icons?q=` (trimmed len>1). Reset `iconWindowOffset=0` on new query.
  - Update `<section><h2>Mask Search</h2>` and input `aria-label="Mask search"` (keep `Mask text` alias for old e2e). Allow 10 chars, `onChange e.target.value.slice(0,10)`.
  - Replace `.font-row` rendering: fixed 3 letter tiles (blank + 2 fonts) + windowed icon tiles `iconResults.slice(offset, offset+8)` + more tile (idx 11). Ensure 12 children always.
  - Add `applyIconMask(icon)` parallel to `applyTextMask` (fetch SVG, draw white-on-black at 1000×1000, `toBlob` → `TEXT_MASK_FILENAME`).
  - Update `useEffect` for `maskPreview` to handle both letter/icon; when `galleryMode` true skip canvas draw.
  - Preview pane: conditional `galleryMode ? <IconGalleryGrid> : <canvas ref={maskPreview}>` inside `.mask-preview-wrap`; gallery grid click → `applyIconMask` + compute `nearestWindow` + set `iconWindowOffset` + exit galleryMode.
  - Keep `isBlank` but now tile 0; `maskBusy` guards both paths. Preserve `maskTooSmall` for both.

- `src/app/api/icons/route.ts` — new proxy (Node runtime, `GET ?q=` → `https://icons.grida.co/api/search?q=`).

- `src/app/globals.css`
  - Replace `.font-row` auto-fill with `grid-template-columns: repeat(3, 1fr);`.
  - Add `.gallery-grid` + `.gallery-cell` styles for preview-area gallery (reuses `.font-card` look); and `.font-glyph img` sizing.

- `doc/plan/web-qr-poster.md` and `README.md` — update step 2: mask search, 10-char input, 3×4 grid (3 letters inc. blank, 8 icons + more), icons.grida.co attribution, preview-area gallery + nearest-12 paging.

- `e2e/editor.spec.ts` — add cases:
  - Input longer query (len>1, ≤10) triggers icon grid (mock `/api/icons` returns 20 items, assert 8 tiles + more).
  - More click swaps preview canvas to gallery grid in preview area.
  - Selecting icon in gallery applies mask, exits gallery, sidebar shows nearest 8 window around selected index.
  - MaxLength 10 enforced (fill 12 chars → value length 10).
  - Keep existing single-letter first-char test updated.

- `test/text-mask.test.ts` — add tests for `TEXT_MASK_MAX_LENGTH=10`, `nearestWindow` helper, keep `deriveMaskLetter`.

## 7. Open questions / decisions (updated per latest input)

1. **Exact composition of front 3 letter tiles**: Now fixed as `blank + 2 letter fonts` (counts as the “front 3” keeping first-letter rule). If you want 3 letter fonts + blank separate, we move blank above grid. Which to ship?
2. **When query length ≤1, what to show in the 8 icon slots?** Placeholder disabled tiles with hint “Type 2+ characters to search icons” (current plan).
3. **Gallery placement**: Confirmed — gallery lives in preview area (not modal). Do you want gallery to be scrollable grid with vendor filter, or plain full list?
4. **“Nearest 12” windowing details**: Plan interprets as nearest-8 icons (tiles 3-10) + 3 fixed letter tiles + more =12. Alternative literal: all 12 become icons after gallery select (letters hidden). Confirm the former (keep letters)?
5. **Icon color handling**: Force solid white silhouette (`fill=white stroke=white`) vs respect original thin strokes (may trigger `maskTooSmall` warning). Proposal: force white.
6. **Search debounce & limit**: 350 ms, `limit=100`, client window 8, gallery shows all. Need `offset` pagination or just first 100?
7. **MaxLength 10 edge**: Should input truncate at 10 (`.slice(0,10)`) or show error? Plan is truncate.

## 8. Implementation steps (after approval)

1. Add proxy route + types, verify CORS, add Vitest mock.
2. Update `text-mask.ts` constants & helpers.
3. Refactor `Editor.tsx` step 2 panel: input, grid, search hook, preview, applyIconMask, more modal.
4. Update `globals.css` grid to 3 columns.
5. Add `IconGallery` component (or inline modal in Editor).
6. Update docs.
7. Add/adjust unit + e2e tests (mock `/api/icons`).
8. Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (mocked).

## 9. Risks & mitigations

- CORS/availability of icons.grida.co → proxy; fallback to empty + retry hint; e2e mocked so not flaky.
- SVG rasterization cross-browser → test `Image` + `URL.createObjectURL` path; fallback to `fetch` + `canvg` if needed.
- Icon thin strokes → `maskTooSmall` will fire; user can pick bolder variant or letter tile.
- Performance: search on every keystroke → debounce + abort + cache.

## 10. Non-goals

- No change to placement/assembly engine, poster dimensions, or verification contracts.
- No persistent storage of search history.
- No write to `output/` or `dist/` beyond build.

---

Please confirm/correct §7 choices, especially (1) blank placement and (3) More-inside-vs-outside grid. After that, implementation can proceed without further spec churn.
