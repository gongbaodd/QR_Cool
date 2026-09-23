# AGENTS.md

Web editor (Next.js) for artistic QR posters. Upload a PNG with a solid black region, enter one line of text or a URL, position the QR, and assemble a full-resolution poster: a seeded marker-free rounded-cell texture drawn only on whole modules fully inside the selected region, a one-module light margin along the region edge when selected, plus the exact QR on a module plate with a one-module light band beside each finder marker.

## Brand

- The project is **mahu-QR** (码码虎虎). The mascot `public/brand/mahu-tiger.svg` is the visual source of truth: two flat inks, near-black `#101211` and vermilion `#ff321e`, on warm cream `#fdf8f2`. `src/styles/tokens.stylex.ts` mirrors those inks and never invents new brand colors.
- Brand assets are committed static files, never generated routes: the mascot (header lockup and empty state), `src/app/icon.svg`, `src/app/apple-icon.png`, `src/app/opengraph-image.png` + `opengraph-image.alt.txt`. Rasters are regenerated from the SVG. Do not add `ImageResponse`/`opengraph-image.tsx` codegen.
- The UI keeps the **Gloria Hallelujah** handwriting font (`handFont` in `src/styles/tokens.stylex.ts`, `@font-face` in `globals.css`); a rounded sans was considered and rejected. Text-mask fonts stay untouched. `public/fonts/ATTRIBUTION.md` is the license record for the bundled mask fonts.
- Geometry keeps the Wired-Elements sketch language: multi-corner `sketch*` radii, decorative tilts, wavy underlines, dashed outlines, and hard offset shadows. `#ff321e` is for borders, focus rings, and large text only; body-size text uses the AA-safe `#c22312`. Canvas valid/danger signals stay distinct from the brand accent.
- The engine does not rebrand: `DEFAULT_PALETTE` stays `#000000/#000000/#ffffff` and every golden output is byte-identical. The Tiger preset (`src/core/palette.ts`) is a one-tap suggestion the user opts into.

## Commands

- Run `pnpm test`, `pnpm typecheck`, and `pnpm build` only when the user explicitly asks for verification; the maintainer runs these checks manually between prompts.
- `pnpm dev` runs the editor locally; `pnpm start` serves the production build; `pnpm test:e2e` runs the Playwright browser journeys against it.
- Don't run `pnpm test:e2e` on every change. The maintainer exercises UI work manually in the browser, then asks for `e2e/editor.spec.ts` to be updated — update the journeys on request and only run that suite when asked.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules).

## Invariants

- Inputs are PNG only (10 MiB, 4 megapixels, one frame; guards run client-side in `src/lib/editor/png-guard.ts`). Masks must match the poster dimensions; white selects the region.
- Pixels outside the selected region, pixels in modules the region covers only in part, and pixels inside the placed QR stay bit-exact. Mandatory verification failures reject export.
- The painted region is auto-detected from the dense central black shape; an uploaded mask overrides detection.
- Tests never make paid calls: mock API responses, use local fixtures.
- No request invokes a CLI or writes temporary files. `output/` and `dist/` are gitignored run products; schema-8 assembly reports are preserved.
- The pipeline runs entirely client-side: `src/lib/editor/engine/` owns the renderer logic and runs in a session-owned Web Worker (`src/lib/editor/worker/`, Comlink) with a sha256 source cache and revision-based stale dropping; `src/core/` holds the shared rendering algorithms behind the imaging seam (`src/core/imaging/`: sharp = Node test backend, jSquash/resvg = browser); image artifacts cross the worker/UI boundary as Blobs with object-URL lifecycle managed in `useBlobUrls`. `src/lib/editor/store.ts` owns the per-editor Zustand session state and keeps the pure reducer transitions in `state.ts`; selectors derive readiness, while `src/components/editor/` owns browser interaction and runtime refs. The only server surface is the `GET /api/icons` proxy. There is no render API and no base64 image transport.
- Component styles are StyleX: tokens and shared recipes in `src/styles/`, layout styles beside their component. Readable UI font sizes use `rem` so browser default font preferences scale them; coupled CSS and `matchMedia` layout breakpoints stay synchronized in `em`. Keep pixels for visual strokes and for canvas, poster, and QR raster geometry. `src/app/globals.css` holds only `@font-face`, the `@layer reset` block, and the `@stylex` slot that `babel.config.json` + `postcss.config.mjs` compile into.

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Pattern colors are settings (`colors: { pixel, marker, background }`, 6-digit hex): pixel inks the texture cells, data modules, rim, and refill bits; marker inks the finder/alignment markers; background fills the light modules (quiet zone, marker rings, plate band, region margin). The palette lives in `src/core/palette.ts` (pure sRGB↔OKLCH, OKLCH suggestions from the pixel color, contrast guard), the schema defaults `#000000/#000000/#ffffff` keep existing outputs byte-identical, the palette joins the engine's `qrCacheKey`, and the guard rejects unscannable palettes with `COLOR_INVALID` → field `colors` before generation. The pattern-settings UI (`usePickr` + a hex input, suggested chips, pending-vs-commit local state) is the only surface for editing colors.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges toward dark edge neighbours, with inner-corner fills on light modules.
- The texture pitch always equals the placed QR pitch, the crop is phase-locked to its lattice, and the editor's stable seed makes the texture reproducible.
- A module is safe only when its whole `pitch x pitch` block is on the canvas and every pixel of it is inside the region; a partially covered module keeps the original artwork. Add Margin paints the outer safe-module ring of the selected region with the normalized QR's marker background pixels; when Rim is also on, its dark rings start immediately inside the light margin. Without Add Margin, the outer 0–5 rings of drawn modules are forced dark cells as before. A rounded rim is antialiased. The plate remains the code grid plus finder-only light bands of one module.
- The poster is deliberately not decode-verified: `poster`/`posterHalfScale`/`posterJpeg80` are skipped checks, `phoneScan` stays `untested`, and the UI warns that artistic margins can affect scanning.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Editor behavior and ownership

- The editor is a single reactive workspace. Typing changes only the draft and validation state; **Generate** commits a valid value and is not an export or completion step. Draft edits must not start preparation, change the mask, or invalidate the current result.
- Automatic mask selection follows committed content until the user chooses mask text, a font, blank, or an icon; that choice then stays fixed across content changes. The derived mask uses the Fathead font and the first ASCII letter or digit for plain text.
- `PreviewPanel` owns the editing canvas, marker interactions, and the shared Fill/Rim toolbar. Fill is an explicit source-mask operation available in both region-only and QR views; it must not use the rendered overlay or the placed QR as its source. The assembled-result view hides editing controls, and Escape exits fill mode.
- Marker settings are transient local UI state. Use the existing canvas hit targets and one reusable native `<dialog>` for finder/alignment settings; do not add marker-dialog state to the editor store or introduce a general modal framework.
- Desktop keeps mask selection, preview, and pattern settings visible together. Mobile reuses those same panel instances in native modal drawers with focus return, Escape/backdrop dismissal, and reduced-motion-safe presentation.
- Keep the latest canonical placement through every preview preparation and assembly. If a placement is invalid, report it and leave it editable; never silently move it. When a QR change alters the module count, resize around the previous center before revalidating.
- Rotation is a transform of the complete upright QR plate, not of QR modules or texture independently. Use the shared rotated working-frame geometry and coverage guard in both preparation and assembly; a frame-coverage failure must reject export instead of silently clipping the plate.
- Editor feedback uses the viewport-level toast surface without changing canvas layout. Dismissing a toast must not clear authoritative validation or engine state, and routine progress/errors must not be announced by duplicate alert surfaces.

## State and lifecycle rules

- Each mounted editor owns one scoped Zustand store and one lazily created, disposable worker session. Keep timers, operation tokens, worker handles, DOM/canvas refs, hover/dialog state, and object URLs outside the store; in-memory `File`/`Blob` references are not persisted or serialized.
- Preserve the pure reducer as the revision and stale-completion boundary. Use both document revision and operation/lifecycle guards so obsolete worker, mask, search, file, and `toBlob` completions cannot overwrite current state or clear a newer operation.
- Use stable/narrow selectors rather than a root store subscription. Draft, UI-only, search, panel, and completion-status changes do not create document revisions or trigger preparation. Readiness must reject stale prepared data and every busy/error state before assembly.
- Create object URLs only at the UI boundary, revoke them on replacement/unmount, and use the exact assembled Blob for both preview and download. Do not add persistence, URL synchronization, undo/redo controls, or another async-state/RPC layer.
- Zundo is only a bounded, read-only trace of recent state snapshots (up to 50 previous snapshots plus the current one); omit source Files, rendered Blobs, and icon payloads, and never expose persistence or undo/redo controls.

## Skills

- Use the `modern-web-guidance` skill (via the skill tool) before any HTML/CSS or client-side JS work — including UI/layout, motion, performance (CWV), and Web API tasks — to check for modern best practices that may differ from training data.

## Docs

- `README.md` and `doc/plan/web-qr-poster.md` are the canonical product docs. Behavior changes update both. `doc/plan/artistic-qr-poster.md` is historical design context.
- `doc/plan/` is for active proposals and historical design records, not completed implementation checklists. When a plan ships, promote its durable constraints here, update the canonical docs, and remove the completed plan. Keep unimplemented plans until their work is actually finished.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
