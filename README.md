# mahu-QR

码码虎虎 — a web editor for artistic QR posters. Upload a PNG with a solid black region, choose a QR content type, position the QR, and download a full-resolution assembled poster.

## Run locally

Requires Node.js 22+ and pnpm 10.33.2.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. For a production server:

```sh
pnpm build
pnpm start
```

The same app also builds for Cloudflare Workers with [vinext](https://vinext.dev) (Vite). The Node commands above keep working unchanged:

```sh
pnpm build:vinext     # Vite build for Workers (dist/client + dist/server)
pnpm preview:workers  # local Workers runtime preview on http://localhost:8787
pnpm deploy:workers   # build + deploy to Cloudflare (requires `wrangler login`)
```

No credentials or accounts are needed. QR text is never fetched as a URL. Uploaded files exist only in your browser: the PNG bytes and every render step live in browser memory. QRCode input decodes the uploaded PNG locally in the page; poster and mask decoding, detection, assembly, and verification run inside this page's Web Worker. Nothing render-related is ever uploaded or stored.

## Editing

The error-correction and pixel-style cards preview QR styling encoded from an empty text value, so the options remain visible and comparable before content is entered.

The editor is a single reactive workspace. Choose **URL**, **Text**, **Phone**, **WiFi**, **SMS**, **Email**, or **QRCode** in the header. URL, Text, and Phone use a single input; WiFi, SMS, Email, and QRCode open a native dialog. Valid entries update the preview after a short debounce, and form submission commits immediately. WiFi produces a `WIFI:` payload, SMS a `SMSTO:` payload, Email a `mailto:` URI, and Phone a `tel:` URI. QRCode accepts a PNG, decodes its text locally, and uses that text to generate the styled preview. Assembly remains the export action.

Desktop keeps **Mask selection**, **SVG preview**, and **Pattern settings** visible in three columns, with both side panels' tops aligned to the preview. On mobile only the header and preview remain in normal flow; Mask selection opens from the left and Pattern settings from the right as accessible native modal drawers. The same panel instances and state survive resizing.

Readable UI text scales with the browser's default font setting. The desktop-to-drawer transition uses matching font-relative breakpoints in CSS and JavaScript, while mask, icon, and pattern option grids make fewer columns when their available width shrinks. The search target and color hex field grow with text settings, and the header mascot scales down on narrow viewports. These CSS changes do not affect poster pixels: the SVG preview fits its measured content area, and QR module pitch and export geometry remain raster-pixel based.

The mask starts in automatic mode with a blank full-canvas region while the committed input is empty. After a value is committed, a URL uses its first host letter and plain text uses its first ASCII letter or digit, rendered with the Fathead font. Draft typing never refreshes the mask or preview. Choosing mask text, a font, blank, or an icon switches to a manual mask that remains fixed when content changes. Searching icons opens the gallery immediately with a progress indicator; matching icons appear in that dialog when the search finishes. A persistent toolbar stays attached flush to the top of the preview canvas, with **Fill region**, **Add Rim**, and **Add Margin** available throughout editing, with or without a QR code; the taller preview container handles scrolling and keeps the toolbar pinned. The selected region stays highlighted in the preview. Activating **Fill region** shows a persistent toast with instructions until fill mode exits. Filling stays opt-in, only accepts enclosed areas outside the placed QR, and Escape exits fill mode.

After content is committed, the worker prepares reusable poster, mask-highlight, and upright QR preview assets. Dragging, resizing, rotating, and nudging only update the SVG scene and commit placement; they do not prepare assets, scan the mask, or validate the placement. Dragging follows poster coordinates at every preview fit. The resize handle tracks continuously along the QR's local diagonal and holds its opposite local corner; hold **Alt** to resize from the center. On release, size settles briefly to the nearest valid whole-module pitch and commits once. **Escape**, pointer cancellation, or losing the browser window cancels the active gesture without committing it. The QR remains visible and editable outside the selected region and canvas. **Assemble** performs exact placement checks and full-resolution rendering; failures keep the current placement editable and report through the toast surface. QR module-count changes recenter the current box around its previous center without clamping. The preview caption reminds users: “Assemble to check placement and render the final poster.” With empty committed content, selecting a mask highlights its region without preparing a QR. The persistent, flush-top toolbar keeps **Fill region**, **Add Rim**, and **Add Margin** available in both editing views; fill accepts enclosed source-mask areas and the QR canvas ignores fill clicks on the placed QR. Activating **Fill region** shows a persistent toast with instructions until fill mode exits. **Add Rim** toggles the one-module dark rim around the selected region. **Add Margin** toggles a one-module light band along the inside edge of the selected region, using the same background pixels as the finder markers; when both are on, the dark rim follows just inside the light margin. Escape exits fill mode. Committing any supported QR content adds its preview; assembly remains disabled until the input is valid. The existing full-resolution assembly/download remains an export action, while the editing surface has no Continue/Back step rail.

Each of the three finder markers can be styled independently from its SVG hit target. The marker dialog’s **Apply to all finder markers** button copies the current finder’s full style to the other two; alignment marker styling remains separate.

Editor validation errors, preview and assembly failures, icon-search failures, and region-fill feedback appear in React-Toastify notifications outside the editor layout. They do not add height above the preview canvas; dismissing a notification does not clear validation or enable assembly. Document failures offer a retry for the worker action that failed, and placement remains editable while invalid.

Pattern settings provide pixel style (`square`, `rounded`, `dot`, defaulting to `dot`), and a fixed 1-module finder margin. Pattern colors put a three-color palette behind the poster: the **pixel** ink of every dark module, the **marker** ink of the finder/alignment markers, and the **background** of the light modules (quiet zone, marker rings, plate light band, region margin). The three color swatches sit in one row and each opens a [pickr](https://github.com/simonwep/pickr) popover. Changing the pixel color derives matching OKLCH marker and background colors until those colors are customized. A guard rejects combinations too low-contrast to scan before they can touch the preview, with an inline hint beside the swatch. The pattern seed remains stable internally across edits. Hovering a finder or alignment marker highlights it, and clicking opens its marker dialog. Each finder marker has its own pixel style (`square`, `rounded`), outer shape (`square`, `circle`, `octagon`), and inner shape (`square`, `circle`, `plus`, `diamond`); **Apply to all finder markers** copies its complete configuration to the other two. The bottom-right alignment marker has a separate shape setting (`square`, `circle`), and version-1 codes have no alignment target. The header also offers example QR values to pick from. The corner setting affects the QR plate, not the poster's silhouette.

**Artistic margins can affect scanning. Test the downloaded poster with your phone.** The result is not scan-certified. The report deliberately skips poster/full-size, half-scale, and JPEG decoding checks; `phoneScan` remains `untested`.

## Styling

The visual language pairs the **mahu-QR** head-only tiger mascot (码码虎虎, `public/brand/mahu-tiger.svg`) with the existing Wired-Elements look: its two flat inks — near-black `#101211` and vermilion `#ff321e` — on warm cream, the hand-drawn multi-corner radii, tilts and wavy underlines, hard offset shadows, and the original Gloria Hallelujah handwriting UI. The mask fonts are separate. The controls are app-specific React components styled in [StyleX](https://stylexjs.com). The browser receives compiled atomic styles for the editor; React-Toastify supplies its own notification styles and uses the editor palette.

- `src/styles/tokens.stylex.ts` is the single home for the palette (the mascot's two inks, warm cream, semantic valid/danger), the sketch radius/shadow scale, and the handwriting UI type stack. `src/styles/ui.stylex.ts` holds the recipes shared by more than one surface (buttons, fields, hints, cards), and every component keeps its own layout styles next to its JSX.
- Readable UI type sizes use `rem` so browser default font preferences carry through the editor. Font-relative breakpoints keep the three-column shell, CSS drawer presentation, and the drawer's JavaScript mode check in sync as text size grows. Raster and QR dimensions remain pixel based.
- `babel.config.json` compiles `stylex.create()`/`stylex.props()` calls and `postcss.config.mjs` replaces the `@stylex` directive in `src/app/globals.css` with the collected rules. Next.js 16.0.3 and later run both under Turbopack, so `pnpm dev`, `pnpm build`, and `pnpm start` are unchanged.
- `src/app/globals.css` keeps only what StyleX cannot express: the `@font-face` declarations for the bundled UI and mask fonts, an `@layer reset` block (box-sizing and text-size-adjust), and the `@stylex` slot. Generated rules land in StyleX's own `priority…` layers, which are declared after `reset`.
- Editor controls and preview surfaces keep their styles beside their components; the global stylesheet contains only the font faces, reset layer, and compiled StyleX slot.
- Brand assets are static files, not generated routes: `public/brand/mahu-tiger.svg` (the head-only mascot, also the header lockup and empty state), `src/app/icon.svg` (favicon), `src/app/apple-icon.png`, and `src/app/opengraph-image.png` with `opengraph-image.alt.txt`. Rasters are regenerated from the mascot SVG. `public/fonts/ATTRIBUTION.md` records the bundled mask-font licenses.

## Renderer contract

- `uqr`, M error correction, automatic mask selection, two locally drawn source margin modules, selectable pixel geometry (`square`, `rounded` with blended wedges, `dot` as isolated circles; `dot` is the default), and a pattern palette (pixel ink / marker ink / background; defaults `#000000` / `#000000` / `#ffffff`, which render byte-identically to the unmixed version). The engine guards the palette before generation (background Rec.601 luma ≥ 205, every ink ≤ 120, OKLCH lightness separation ≥ 0.3 -> `COLOR_INVALID` on the `colors` field) and the marker-free texture shares the pixel/background colors; the plate never recolors the artwork.
- Seeded marker-free decorative matrix, phase-locked to the placed QR's lattice. Finder/separator and alignment cells are randomly refilled; timing and function cells remain.
- Only whole modules fully covered by the selected region are drawn. An optional one-module light margin follows the region edge; the 0–5 dark rim rings start inside it when enabled, or at the region edge when it is off (antialiased when rounded). The plate does not seed either ring.
- The actual plate is the code grid plus finder-only light bands of one module (whole cells). Its footprint is smaller than the full QR square used for placement constraints.
- The live QR image and downloadable `qr.png` use transparency for light/background pixels, shown over the preview's checkerboard. Assembly keeps its opaque normalized QR internally for the plate, so the downloaded poster's QR contrast and verified pixel behavior stay unchanged.
- The built-in Blank canvas starts transparent. Mask-selected texture modules have a white background matching the marker's light areas; unpainted canvas remains transparent. The QR plate keeps opaque light pixels for contrast, and the result preview uses a checkerboard to show transparent areas.
- Outside-region pixels, partially covered modules, and QR plate pixels are verified. Uploaded-poster alpha is preserved; transparent blank exports verify the expected alpha for the ink and transparent background. For rotated placements the working frame is additionally proven to cover the whole placed plate before assembly proceeds; any frame-coverage failure rejects export. Any mandatory check failure rejects export.
- Schema-8 reports are preserved. The poster and every artifact cross the worker/UI boundary as `Blob`s — no base64 serialization anywhere.
- The assembled `Blob` is the single source for both the preview and the download; the result is never re-rendered on the main thread.

The CLI, paid image generation, QR-image upload, and standalone pattern modes are retired. The browser editor is the supported product interface.

## Architecture

The render pipeline is entirely client-side:

- The shared pipeline lives in `src/lib/editor/engine/` (source cache, QR bundle cache, placement application, assembly, error-to-field mapping) and runs inside a **Web Worker**, exposed to React through Comlink (`src/lib/editor/worker/`). The engine depends on no platform: Node tests inject the sharp imaging backend, the worker injects the browser backend.
- PNG decode/encode uses `@jsquash/png` (WASM, lazy-loaded inside the worker); SVG rasterization uses `@resvg/resvg-wasm`; compositing, flattening, and nearest-neighbor resize are pure TypeScript shared by both backends (`src/core/imaging/`).
- Source identity is the file SHA-256 (`crypto.subtle`), with a separate asset revision for source and QR appearance inputs. Placement commits update the document revision and SVG scene only; they do not invoke the worker. Preparation and assembly have independent operation guards, and stale source or operation outcomes cannot replace current state.
- The reactive editor keeps the header, preview, mask selection, and pattern settings in one client boundary backed by an editor-scoped Zustand store. Drafts, files, mask/search selection, panels, and renderer state have explicit owners; runtime timers, worker handles, DOM refs, and object URLs stay outside the store. Zundo keeps up to 50 previous dated state snapshots plus the current one in memory for tracing through `getEditorTrace(store)`; the snapshots omit source Files, rendered Blobs, and icon payloads. This is a read-only trace, with no undo/redo controls, persistence, URL synchronization, or external logging. The preview owns the shared region-fill toolbar and an SVG editing scene with frame-coalesced pointer gestures; a complete gesture commits one canonical placement. Marker, result, and icon gallery panels remain lazy where useful. The preview stays above the fold and the mobile side panels use native dialogs rather than duplicated settings DOM.
- Upload guards (PNG signature, IHDR, APNG `acTL` scan, 10 MiB / 4-megapixel limits) run client-side in `src/lib/editor/png-guard.ts` with the same error codes.
- Outside-region pixels, partially covered modules, and QR plate pixels stay bit-exact. Uploaded-poster alpha stays bit-exact; the generated blank canvas keeps its transparent background. Mandatory verification failures reject export.
- The only HTTP endpoint is the thin icon-search proxy `GET /api/icons` (free upstream, mocked in tests); it plays no part in rendering.

## Limits and hosting

- **10 MiB per PNG, 4 megapixels, one frame**, checked client-side before anything decodes (same messages as before; the `acTL` chunk scan replaces the old frame-count check). Masks must match the poster dimensions.
- One engine session per editor page, single-flight in the worker with settle-time stale dropping — additional edits supersede instead of queueing.
- This is a static-ish Next.js app: any Node host that can run the build can serve it; the render work is on the visitor's browser. Browsers need Web Worker, `OffscreenCanvas`-free WASM loading, and `crypto.subtle` (all evergreen).
- `Dockerfile` supplies a Node 24 production build/run configuration. No deployment is performed by the project. Verify the image and resource settings on your deployment host.

### Cloudflare Workers

The app deploys to a single Cloudflare Worker via vinext: the Worker serves the page, static assets, and the `GET /api/icons` proxy; no KV/R2/D1/Images bindings are used. The render pipeline stays in the visitor's Web Worker — nothing render-related reaches the server.

- `vite.config.ts` holds the vinext build. It re-applies the StyleX Babel transform (`babel.config.json` options) to app source — Vite never reads that file, so `stylex.create`/`defineVars` would otherwise run at runtime — and rewrites the codec `.wasm` imports to asset URLs (`{ default: url }`), the same contract as the Turbopack `asset` rule in `next.config.ts`, so the codecs' own inits supply their wasm-bindgen imports. The worker uses ES-module output (top-level-await WASM inits).
- `src/lib/editor/worker/window-shim.ts` aliases `window` to the worker global before the engine loads: ZXing's PDF417 tables touch `window.BigInt` at module scope, which Turbopack shims but Vite does not.
- `src/core/pattern-cut.ts` encodes the cut-SVG data URI with `btoa` instead of Node's `Buffer`, which does not exist in the Workers runtime.
- `wrangler.jsonc` pins the Worker name (`mahu-qr`), `compatibility_date`, `nodejs_compat`, and the `dist/client` assets binding. `dist/` and `.dev.vars` are gitignored; never commit API tokens.
- The two toolchains both regenerate `next-env.d.ts` and `.next/types/routes.d.ts` when they run; `pnpm typecheck` stays green either way (the Next-only `validator.ts` is excluded from the standalone program — `next build` validates routes with its own generated checks).

Deploy checks: `pnpm test`, `pnpm typecheck`, `pnpm build` (Node path still green), then `pnpm build:vinext` and `pnpm preview:workers` — walk upload/mask → place → assemble → download at http://localhost:8787 and confirm zero console errors, `application/wasm` responses for both codec binaries, and `Cache-Control: no-store` on `/api/icons`. The assembled bytes must stay identical to the Node build for the same seed (verified with a fixed `crypto.getRandomValues` seed). Deploy with `pnpm deploy:workers` to the `*.workers.dev` URL, attach the custom domain afterwards, and keep the last known-good deployment for rollback from the Cloudflare dashboard (Workers → Deployments → Roll back). Production URL and owner: to be recorded here once the account is connected.

### Measurements

Local Node 24.15.0, Linux x86_64. `npx tsx scripts/benchmark.ts` creates a noisy 2000×2000 PNG with a black region and drives the engine through the sharp backend: a measured run took **1.9 s preparation, 3.5 s assembly, 402 MiB peak RSS**. In the browser the same work is spread over the session — the first prepare decodes and detects (wasm init included), later edits around cached sources typically re-run only geometry, and assemble reuses the cached poster/QR bytes. Results vary by machine, browser, QR version, and image entropy; these are local benchmarks, not guarantees.

The proposed 16-megapixel limit used about **1.2 GiB RSS** even on a simple image, so the shipped limit is 4 megapixels. Benchmark on the target host before raising limits or concurrency.

## Verification

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm build:vinext
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:bdd
pnpm benchmark
```

`pnpm lint` runs oxlint (`.oxlintrc.json`) over the TypeScript, TSX, and config files, and `pnpm lint:fix` applies its safe fixes. `pnpm format` rewrites files with oxfmt, and `pnpm format:check` reports differences without writing; `.oxfmtrc.json` sets the project style (single quotes, no semicolons, two spaces, 120 columns) and skips generated directories. Husky runs `lint-staged` and then `pnpm typecheck` from `.husky/pre-commit`. `lint-staged` fixes only staged source and document files, adds those fixes to the same commit, and preserves unstaged edits in partially staged files. These tools are dev-only and play no part in the request path.

Vitest covers engine geometry, the engine artifacts (with captured artifact hashes and export pixel invariants), the browser/sharp parity harness, decoder fixtures, pixel invariants, the client upload guards, blank-poster preparation, mask geometry, and the reducer's stale-response guards. Playwright runs production-server journeys in Chromium (`playwright.config.ts`, so `pnpm exec playwright install chromium` is the only browser install needed): the blank-canvas flow, the derived mask letter and example buttons, mask search with a mocked icon API, the icon gallery and its dismissal paths, marker dialogs opened from hovered canvas markers plus pattern settings (error correction, pixel styles, and rim), SVG placement nudging and dragging, worker-driven assembly, preview/download sharing one Blob URL, download-byte checks, no-render-API-call assertions, and result invalidation.

The same journeys also exist as plain-language Gherkin scenarios in `e2e/features/*.feature` with shared step definitions in `e2e/cucumber/`; `pnpm test:bdd` runs them with `@cucumber/cucumber` over the same Playwright Chromium (`cucumber.mjs` is the config). `@icons`-tagged scenarios use the mocked `/api/icons` proxy, the server lifecycle mirrors the Playwright config (starts `pnpm start`, reuses one already listening, kills the whole process group afterwards), and scenario screenshots attach to the HTML report in `reports/` on failure.

The pipeline lives in `src/lib/editor/engine/` and runs in a Web Worker (`src/lib/editor/worker/`); `src/core/` holds the shared rendering algorithms behind the imaging seam, `src/lib/editor/store.ts` owns the mounted editor session while `state.ts` retains pure reducer transitions, and `src/components/editor/` owns browser interaction. The only server surface left is the `/api/icons` proxy. No request invokes a CLI or writes temporary files.

See [web implementation plan](doc/plan/web-qr-poster.md). The [previous artistic QR plan](doc/plan/artistic-qr-poster.md) is historical design context.
