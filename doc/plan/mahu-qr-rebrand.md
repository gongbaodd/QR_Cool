# Plan: Rebrand the editor as mahu-QR

Status: **implemented** — a visual reskin plus brand assets. No behavior, layout structure, or engine change. The Wired-Elements sketch shape language (multi-corner radii, decorative tilts, wavy underlines, dashed outlines) and the Gloria Hallelujah handwriting UI font are deliberately **kept**: the rebrand is palette and mascot only. The brand source of truth is the mascot SVG saved verbatim at `public/brand/mahu-tiger.svg` (码码虎虎, copied byte-identical from the design source `~/Downloads/码码虎虎-圆形眼睛.svg`, md5 `ff01e1262bab426a083d01bcc60f2c5f`). Durable constraints landed in `AGENTS.md`, `README.md`, and `doc/plan/web-qr-poster.md`.

## 1. Brand source

The mascot (`public/brand/mahu-tiger.svg`, 1254×1254, transparent background, two `<path>` elements, 49 blob subpaths):

- **Two flat inks.** Near-black `#101211` (head, stripes, muzzle, eye structure — 32 subpaths) and vermilion `#ff321e` (ears, forehead mark, nose, cheek dots — 17 subpaths). No gradients, no outlines.
- **Rounded blob geometry.** Every shape is a smooth closed cubic-Bézier curve; nothing rectangular survives.
- **QR-native personality.** The eyes are circular "positioning-dot" eyes (圆形定位点眼睛, per the SVG's own `<desc>`) — the mascot already speaks QR.
- **Name.** Official project name **mahu-QR**; Chinese tagline **码码虎虎** (码 "code" folded into 马马虎虎). The latin wordmark is what the UI shows; the Chinese name lives in README/subtitle text rendered by system CJK fallback — never as bundled web text.

What the mascot changes about the design language:

| Surface     | Today (QR / COOL)                                 | mahu-QR                                                               |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Geometry    | wobbly `sketch*` multi-corner radii, tilted chips | **kept** — the Wired-Elements sketch shapes and decorative tilts stay |
| Color story | lavender highlighter + deep green accent          | vermilion accent + near-black ink on warm cream                       |
| Type        | Gloria Hallelujah handwriting                     | **kept** — the handwriting UI font stays                              |
| Shadows     | hard offset shadows                               | kept — recolored to the new ink                                       |
| Mascot      | none (text wordmark only)                         | tiger in header lockup, favicon, empty state, OG image                |

## 2. Decisions

| Decision                                                                                         | Verdict                         | Why                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Reskin via token values; **keep the `sketch*` names and geometry**                               | **Adopt**                       | The Wired-Elements shapes are the product's identity; `defineVars` gives every color one home without touching a single radius |
| Keep hard offset shadows                                                                         | **Adopt**                       | Matches the flat two-ink sticker look; only the ink changes (`rgba(16, 18, 17, …)`)                                            |
| Soft blurred shadows                                                                             | **Reject**                      | Breaks the flat illustration language                                                                                          |
| Keep the decorative rotations (`rotate(-0.3deg)` etc.)                                           | **Adopt** (maintainer decision) | The tilts are part of the Wired-Elements sketch language the maintainer wants to keep                                          |
| Keep the wavy underlines and dashed outlines                                                     | **Adopt** (maintainer decision) | Same reason: shape language is out of scope for the rebrand                                                                    |
| Keep the Gloria Hallelujah handwriting UI font                                                   | **Adopt** (maintainer decision) | The handwriting is part of the look the maintainer wants; the mascot's palette carries the rebrand                             |
| Accent `#ff321e` for large text/borders/focus + darkened `accentText #c22312` for body-size text | **Adopt**                       | `#ff321e` on white ≈ 3.7:1 (≥3:1 uses only); `#c22312` ≈ 5.9:1 passes AA — verify programmatically (§9)                        |
| Keep semantic green (canvas "valid") and crimson danger distinct from brand vermilion            | **Adopt**                       | On the canvas, green border = fits, red border = doesn't fit; that signal must not collide with a red brand accent             |
| Mascot as a static `public/` asset used via `<img>`                                              | **Adopt**                       | 204 KB of path data stays out of the client chunk; no SVGR or `next/image` SVG config needed                                   |
| Inline React mascot component                                                                    | **Reject**                      | Bloats the editor bundle; the two inks are fixed brand constants, not themable                                                 |
| `ImageResponse` / `opengraph-image.tsx` codegen                                                  | **Reject**                      | Unverified under the vinext Workers build; committed static PNGs behave identically in both builds                             |
| Tiger preset chip in pattern settings                                                            | **Adopt** (optional step §8)    | Brand-to-product tie-in; engine defaults untouched                                                                             |
| Minify the mascot SVG in place at implementation                                                 | **Adopt**                       | The verbatim copy is provenance; once minified (whitespace only), the repo file is canonical. gzip already softens the cost    |
| Rename `package.json` / `wrangler.jsonc` names now                                               | **Adopt**, flagged              | The Worker rename changes deployment identity — see §10                                                                        |

## 3. Brand assets

Canonical file: `public/brand/mahu-tiger.svg` — **already landed**. The two `fill` hexes in this file define the brand inks; `tokens.stylex.ts` mirrors them and never invents new ones.

| Asset           | Path                                                                 | Notes                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mascot (full)   | `public/brand/mahu-tiger.svg`                                        | done — 2 paths, 32 black + 17 red subpaths, grammar-checked                                                                                                                             |
| Favicon         | `src/app/icon.svg`                                                   | Next file convention (`.svg` allowed in `app/**`; auto `<link rel="icon">`). Start from the full mascot; if it mushes at 16–32 px, commit a tighter head `viewBox` crop — do not redraw |
| Touch icon      | `src/app/apple-icon.png` (180×180)                                   | rasterize once from the SVG (sharp dev dep, or a Playwright screenshot), commit; `.png` only per the convention                                                                         |
| Social image    | `src/app/opengraph-image.png` (1200×630) + `opengraph-image.alt.txt` | compose once offline (mascot + wordmark on paper); commit; ≤ 8 MB                                                                                                                       |
| Wordmark lockup | in `EditorHeader`                                                    | tiger `<img>` ≈ 34 px + `mahu` (ink) `-QR` (accentText), keeping the wordmark tilt                                                                                                      |
| Empty state     | `PreviewPanel`                                                       | the mascot inside the existing circular sketch card, above the "Your poster goes here" copy                                                                                             |

Also:

- `layout.tsx` metadata: title `mahu-QR — Artistic QR poster editor`; keep the product-focused description (a rebrand is not a behavior change).
- `themeColor` goes in a `viewport` export (`export const viewport: Viewport = { themeColor: … }`); it is deprecated inside `metadata` since Next 14 (per the bundled docs). Use the paper value.
- Verify the icon/OG file conventions survive `pnpm build:vinext`; if not, fall back to files under `public/brand/` plus explicit `metadata.icons` / `metadata.openGraph.images` entries.
- The 1.78 MB PNG render in `~/Downloads` is a reference only; every raster the repo ships is regenerated from the SVG.

## 4. Token migration (`src/styles/tokens.stylex.ts`)

```ts
export const tokens = stylex.defineVars({
  ink: '#101211', // mascot black — text, borders, primary bg (was #23272b)
  inkMuted: '#5f6663', // secondary text (was muted #5c665f)
  paper: '#fdf8f2', // warm cream page (was #fffdf8)
  card: '#ffffff',
  accent: '#ff321e', // mascot vermilion — focus, borders, large text
  accentSoft: '#ffe4de', // fills: buttons, chips, highlighter swipes (was highlight #f0e6f4)
  accentSoftest: '#fff1ed', // hover fills (was highlightSoft #f7f0f9)
  accentText: '#c22312', // AA-safe vermilion for body-size text (§9)
  valid: '#0b7a5e', // semantic canvas "placement fits" (was the hard-coded #087f67)
  validSoft: '#e6f4ee',
  danger: '#af2536', // unchanged; crimson stays distinct from vermilion
  dangerSoft: '#fff1f2',
  sketch: '255px 18px 225px 18px/18px 225px 18px 255px', // kept verbatim
  sketchAlt: '18px 225px 18px 255px/255px 18px 255px 18px', // kept verbatim
  sketchCard: '22px 225px 22px 255px/255px 22px 255px 22px', // kept verbatim
  shadow: '2px 3px 0 rgba(16, 18, 17, 0.9)',
  shadowLg: '4px 6px 0 rgba(16, 18, 17, 0.85)',
  shadowField: '1px 2px 0 rgba(16, 18, 17, 0.75)',
  handFont: "'Gloria Hallelujah', 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive", // kept verbatim
})
```

Rules:

- `sketch` / `sketchAlt` / `sketchCard` keep their **names and values** — the Wired-Elements shape language is unchanged, so no consumer renames are needed.
- `handFont` keeps its **name and value** — the handwriting UI font is unchanged.
- `green` / `greenSoft` split into `accent*` (brand) and `valid*` (semantics); nothing keeps a "green" name for brand uses.
- `highlight` / `highlightSoft` become `accentSoft` / `accentSoftest`; `muted` becomes `inkMuted`. Neutral literals (`'white'`, `'#fff'`, `'#000'`, `'#8a938e'`, `#d9d9d9`, `#e7e4e7`) are already achromatic and stay inline.
- Shadow values are recolored to the mascot ink (`rgba(16, 18, 17, …)`) and the step-navigation `primaryShadow` cast becomes vermilion; every radius, rotation, wavy underline, dashed outline, font family, font size, and letter-spacing property is untouched.

## 5. Recipe migration (`src/styles/ui.stylex.ts`)

- **Palette only.** No recipe gains or loses a shape or type property: the `sketch*` radii, static `rotate()` tilts, wavy underlines, dashed `:focus-visible` outlines, `handFont`, `textTransform`, font sizes, and letter spacing all stay exactly as they were.
- `body`: `::selection` → `accentSoft` (font unchanged).
- `eyebrow`, `summary`: `green` → `accentText`; underline decoration → `accentSoft`.
- `pageTitle`: wavy `accentSoft` underline (unchanged shape).
- `sectionNumber` badge: `highlight` → `accentSoft`, keeps `rotate(-4deg)`.
- Buttons: `highlight`/`highlightSoft` → `accentSoft`/`accentSoftest`, keeps the tilts, the active-state press, and the ink `primary`; its cast shadow is recolored to the mascot ink and `primaryShadow` to vermilion.
- Fields keep their `sketch`/`sketchAlt` radii and `'white'` fill; `:focus-visible` outlines and `checkbox` `accentColor` → `accent`.
- `error` / `errorButton`: semantics unchanged (danger/dangerSoft).
- `fontCardSelected`: selected = `accentSoft` background (shape unchanged).
- Card/dialog recipes keep `sketchCard`.

## 6. Font

- **No font change.** Keep the Gloria Hallelujah handwriting `@font-face` (SIL OFL) and its `public/fonts/gloria-hallelujah.woff2`; `handFont` keeps its name and value. A rounded sans (Fredoka was the candidate) was considered and deliberately rejected by the maintainer, who wants the handwriting look kept.
- **Mask fonts are untouched**, including the Fathead default for derived masks; `public/fonts/ATTRIBUTION.md` keeps its current "bundled text-mask fonts" scope.
- No CJK webfont. If a lockup ever needs 码码虎虎 as graphics, it must be outlined inside an SVG, not shipped as web text.

## 7. Component pass (styles and assets only — no DOM/ARIA/behavior changes)

| Component                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorHeader.tsx`                                                 | wordmark → lockup (`<img src="/brand/mahu-tiger.svg" alt="" width={34} height={34}>` + `mahu-QR`, `-QR` in `accentText`); keeps the `sketch` radius, the highlighter swipe (now `accentSoft`), and `rotate(-1.2deg)`; example chips keep `sketch`; focus ring `accent`                                                                                                                                                |
| `layout.tsx`                                                       | metadata title; `viewport` export with `themeColor` (paper)                                                                                                                                                                                                                                                                                                                                                           |
| `PreviewPanel.tsx`                                                 | hoist `'#087f67'` / `'#dd3748'` into module constants (`VALID_INK` / `INVALID_INK`) mirroring `tokens.valid` / `tokens.danger` (Konva cannot read CSS custom properties); marker hover stroke `rgba(16, 18, 17, 0.8)`; `stageFrame` shadow recolored to ink alpha (was `#163c2820`); empty state → mascot inside the existing circular sketch card; the region-highlight overlay tint stays green (selection ≠ error) |
| `Editor.tsx`                                                       | no change — the toast is already token-driven (`card`, `ink`, `sketchCard`)                                                                                                                                                                                                                                                                                                                                           |
| `ResponsiveEditorPanel.tsx`, `MarkerDialog.tsx`, `IconGallery.tsx` | backdrops recolored to `rgba(16, 18, 17, 0.45)`; keep `blur(2px)`; dialog radius stays `sketchCard`; font stack unchanged; preview-box borders stay `#d9d9d9`                                                                                                                                                                                                                                                         |
| `PatternSettings.tsx` + `use-pickr.ts`                             | the pickr monolith theme stays; keep the `sketchAlt` cards and their tilts, recoloring `highlight*` → `accent*`; `swatches: null` → `['#101211', '#ff321e', '#ffffff', '#c22312']`; add the §8 Tiger chip                                                                                                                                                                                                             |
| `MaskPanel.tsx`, `ResultPanel.tsx`                                 | inherit the recipes; `status`/`scanNote` → `accentText`/`inkMuted`; checkerboard stays neutral `#e7e4e7`; details/summary accents                                                                                                                                                                                                                                                                                     |
| `examples.ts`                                                      | `'Hello mahu-QR'`; drop the `qr.cool` domain → a reserved example domain (e.g. `https://shop.example/poster/001`)                                                                                                                                                                                                                                                                                                     |

## 8. Brand tie-in with the QR pattern palette (optional, recommended)

One-tap **Tiger** preset chip in `PatternSettings`, beside (not replacing) the per-row `Suggested` chips. The constant lives in the pure palette module so UI and tests share it:

```ts
// src/core/palette.ts
export const TIGER_PRESET: QrPalette = { pixel: '#101211', marker: '#ff321e', background: '#ffffff' }
```

- Guard math (`GUARD` in `src/core/palette.ts`, Rec.601 luma): pixel 17, marker 109 — both ≤ `inkLumaMax` 120 (the engine's ink threshold is 128, so the vermilion keeps 19 points of headroom); OKLCH lightness separation from white ≈ 0.34 / 0.78 ≥ 0.3. Expected to pass — **pin it with a unit test** next to the existing `test/qr-palette.test.ts` cases.
- `DEFAULT_PALETTE` stays `#000000/#000000/#ffffff`; golden outputs stay byte-identical. Brand colors are a suggestion the user opts into, never engine defaults.
- The preset flows through the existing settings pipeline (`qrCacheKey`, guard, pending-vs-commit) — no new state.

## 9. Accessibility gates

- `accentText` (`#c22312`) ≥ 4.5:1 on `paper`/`card` wherever it styles body-size text (computed ≈ 5.9:1 — verify programmatically during review).
- `accent` (`#ff321e`, ≈ 3.7:1 on white) only where ≥ 3:1 suffices: borders, focus indicators, large text (≥ 24 px / 18.66 px bold), decorative fills.
- Ink on paper ≈ 16:1. Focus-visible outlines are recolored, never removed.
- Valid/invalid on the canvas keep their non-color signals (labels, dashed borders) — hue is never the only signal.
- The mascot is `alt=""` where decorative; OG gets its text via `opengraph-image.alt.txt` and the page title.

## 10. Naming surfaces

| Surface                             | Change                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                      | `name` → `mahu-qr`; description keeps the product sentence                                                                                                                        |
| `wrangler.jsonc`                    | `name` → `mahu-qr` — ⚠ changes the deployed Worker identity/URL; do it with the next deploy and record it in `doc/plan/cloudflare-deployment.md`                                  |
| `vite.config.ts`                    | plugin labels `qr-cool:*` → `mahu-qr:*` (cosmetic)                                                                                                                                |
| `README.md`                         | title `# mahu-QR`; tagline adds 码码虎虎                                                                                                                                          |
| `doc/plan/web-qr-poster.md`         | grep for `QR / COOL` and update mentions (canonical product doc)                                                                                                                  |
| `doc/plan/cloudflare-deployment.md` | title + worker-name note                                                                                                                                                          |
| `AGENTS.md`                         | carries no brand name today; on ship, the durable brand constraints land here (§12 step 7)                                                                                        |
| e2e                                 | `e2e/editor.spec.ts` and `e2e/features/text-input.feature` reference `'Hello QR / COOL'`; per repo rule, journeys change only on request — flag to the maintainer, fix when asked |

## 11. Invariants

Still true:

1. No editor behavior, DOM structure, ARIA, or state change — styles and static assets only (the two additions: the logo `<img>` in the lockup and the empty-state art).
2. `DEFAULT_PALETTE` and every golden fixture stay byte-identical; the engine, worker, and imaging seams are untouched.
3. Mask fonts (incl. the Fathead default) unchanged; `ATTRIBUTION.md` stays the mask-font license record.
4. The pipeline stays client-side; the only server surface remains `GET /api/icons`. Icons/OG are committed static files, not routes.
5. Styling stays StyleX; `globals.css` is untouched (reset, `@font-face`, and `@stylex` slot all unchanged).
6. Store, worker-session, and object-URL lifecycle rules untouched.
7. The Wired-Elements shape language and the Gloria Hallelujah UI font are byte-for-byte unchanged: every `sketch*` radius, decorative `rotate()`, wavy underline, dashed outline, font family, font size, and letter-spacing property survives the rebrand exactly.

Changed (accepted):

- Token color values/names, brand strings, and app icons change; the mascot becomes the visual identity. Geometry, typography, layout, and behavior do not.

## 12. Sequenced implementation and gates

1. **Assets** — mascot (done), `icon.svg`, `apple-icon.png`, `opengraph-image.png` (+ `.alt.txt`), `viewport` + metadata, optional SVG minify.
   Gate: favicon + tab title in `pnpm dev`; `pnpm build:vinext` still green (else the public-asset fallback of §3).
2. **Tokens** — recolored token set (sketch geometry and the Gloria Hallelujah `handFont` kept).
   Gate: `pnpm typecheck` (must resolve every recolored token name).
3. **Recipes** — `ui.stylex.ts` migration per §5.
   Gate: `pnpm typecheck`; manual pass.
4. **Components** — the §7 list.
   Gate: manual browser pass on desktop and < 900 px (drawers, dialogs, toasts, canvas overlays, result view).
5. **Naming + docs** — the §10 list.
   Gate: repo grep for `QR / COOL|qr\.cool|qr-cool` returns only intentional historical records.
6. **Optional §8 preset** + guard unit test.
   Gate: `pnpm test`.
7. **Ship** — promote the durable brand constraints to `AGENTS.md`, update `README.md` + `doc/plan/web-qr-poster.md`, and mark this plan implemented. Kept in place per the maintainer's "save the plan" request (the doc rules would otherwise remove a shipped plan).

Run `pnpm test` / `pnpm typecheck` / `pnpm build` at these checkpoints, not on every step.

## 13. Out of scope

Dark mode; a motion/animation system; layout or IA changes; marketing pages; redrawing or recoloring the mascot (viewBox crops for legibility only); CJK webfonts; changing the UI handwriting font or the mask fonts; touching the QR engine or `DEFAULT_PALETTE`; an e2e journey rewrite (only on request); renaming git remotes or history.

## 14. Implementation principle

The mascot defines the brand: two flat inks, the existing Wired-Elements sketch shapes, and press-down shadows. The engine defines the product and does not rebrand — QR outputs keep their own palette contract, and the tiger only ever _suggests_ itself as a pattern preset.
