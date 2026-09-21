# QR / COOL

A web editor for artistic QR posters. Upload a PNG with a solid black region, enter text or a URL, position the QR, and download a full-resolution assembled poster.

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

No credentials or accounts are needed. QR text is never fetched as a URL. Uploaded files exist only in your browser: the PNG bytes and every render step live in browser memory, and all decoding, detection, assembly, and verification run inside this page's Web Worker. Nothing render-related is ever uploaded or stored.

## Editing

1. **Step 1 — Input text.** Enter one nonblank line of text or a URL. Surrounding spaces are preserved exactly. A website-like value suggests a mask letter for step 2 (first host letter without scheme/`www.`: `http://ABCD.com` → `A`, `www.XYZ.com` → `X`); plain text starts from a blank region.
2. **Step 2 — Mask Search.** Search icons or use a letter: the input holds up to 10 characters and its first character drives the letter tiles (including **blank** for full canvas, see `public/fonts/ATTRIBUTION.md`). The fixed 3×4 grid stays the twelve bundled fonts and keeps the first-letter rule; icons come from the single search control below it. That control is always visible and its label follows the input — `search <query>` before a term is looked up, `more — N icons` afterwards, `⋯ searching…` while a request is in flight, and a plain `search icons` hint when the field is empty. One click searches `https://icons.grida.co/api/search?q=` (proxied through `/api/icons`, one character or more) and opens a modal dialog listing the icons as soon as they come back, leaving the mask preview behind it; Escape, **Close**, and a backdrop click all dismiss that dialog without losing the term. Gallery tiles reuse the sidebar letter-tile size (`ui.fontCard`/`ui.fontGlyph` in a 3-column grid) with the icon art drawn directly on the card — no black chip — and the name initial appears only when an icon has no thumbnail or fails to load. An empty result keeps the mask preview and says no icons were found. Only the latest term is cached, so editing the input or re-entering step 2 re-derives the label and closes the dialog. Selecting any tile draws its white-on-black mask on a fixed 1000×1000 canvas, with icons scaled to fill 80% of the preview and mask while preserving aspect. No size or upload is needed. The preview also offers a **Fill** tool (bucket cursor) that fills an enclosed black pocket white; open shapes that connect to the canvas edge refuse to fill instead of flooding the canvas. A fill is scaled up to the poster mask and re-prepared like any other mask change. **Continue** runs the minimum-fit check on click against the prepared preview: the fit failure stays hidden until **Continue** is clicked, then the exact engine message appears on step 2 and the editor blocks entry to step 3 until a larger region or QR position is supplied. No client-side fit pre-test runs after the preview.
3. **Step 3 — Adjust QR.** Drag the QR, resize a corner, or rotate it with the free rotation handle (no snap; default angle 0). Size snaps to whole QR modules, at least four pixels per module, and the placement includes the normalized QR's two-module source margin. QR generation stays upright — rotation rotates the complete finished plate during placement/compositing, and validation tests the rotated footprint against the selected region. Dragging, resizing, and recentring preserve the angle. Arrow keys move one pixel and Shift+arrow moves ten; on touch screens use the direction buttons or drag. Pattern settings sit beside the canvas, and the step rail (**Step 1 Input text**) takes you back to step 1.
4. **Step 4 — Generate.** **Assemble poster** draws and verifies the full-resolution result. Download **poster.png**, or expand **Artifacts & verification** for the QR PNG, transparent cut PNG, cut SVG, region mask, and schema-8 report. The preview `<img>` and the download link share the exact same assembled `Blob` — the poster is never redrawn to a canvas or re-encoded.

Every input edit invalidates the previous output. An invalid placement is flagged next to the step, never silently moved, and never thrown away: the editor keeps the box so it can be sent back for validation. Dragging and the direction buttons clamp to the poster origin, and longer content or a higher error correction level re-centres the previous box on the new module count and keeps the resized box on the canvas, so a QR that grows at an edge still revalidates instead of stranding the editor.

Pattern settings provide a stable seed, **New pattern**, pixel style (`square`, `rounded`, `dot` matching [qrcode.antfu.me](https://qrcode.antfu.me)), a fixed 1-module finder margin, a rim thickness of 0–5 modules, and a rounded rim with antialiasing. Marker styling lives beside the canvas: hovering a finder or alignment marker highlights it, and clicking it opens a small marker dialog with marker pixel style (`square`, `round`), marker shape (`square`, `round`, `octagon`), marker inner (`square`, `round`, `plus`, `diamond`), or sub marker (`square`, `round`) — the bottom-right alignment marker opens the sub marker dialog, and version-1 codes have no alignment target. Step 1 also offers example QR codes to pick from. The corner setting affects the QR plate, not the poster's silhouette.

**Artistic margins can affect scanning. Test the downloaded poster with your phone.** The result is not scan-certified. The report deliberately skips poster/full-size, half-scale, and JPEG decoding checks; `phoneScan` remains `untested`.

## Styling

Component styles are authored in [StyleX](https://stylexjs.com). The browser receives one compiled atomic stylesheet; no CSS-in-JS runtime ships.

- `src/styles/tokens.stylex.ts` is the single home for the palette, the hand-drawn border-radius/shadow set, and the type stack. `src/styles/ui.stylex.ts` holds the recipes shared by more than one surface (buttons, fields, hints, cards), and every component keeps its own layout styles next to its JSX.
- `babel.config.json` compiles `stylex.create()`/`stylex.props()` calls and `postcss.config.mjs` replaces the `@stylex` directive in `src/app/globals.css` with the collected rules. Next.js 16.0.3 and later run both under Turbopack, so `pnpm dev`, `pnpm build`, and `pnpm start` are unchanged.
- `src/app/globals.css` keeps only what StyleX cannot express: the `@font-face` declarations for the bundled mask fonts, an `@layer reset` block (box-sizing and text-size-adjust), and the `@stylex` slot. Generated rules land in StyleX's own `priority…` layers, which are declared after `reset`.
- Styles that used to be inherited from global element or descendant selectors (`section h2 span`, the even-child tilted buttons, `.font-card .font-glyph`, `.konvajs-content`, the step-2 preview panel) are now explicit props on the elements they belong to.

## Renderer contract

- `uqr`, M error correction, automatic mask selection, two locally drawn source margin modules, selectable pixel geometry (`square`, `rounded` with blended wedges, `dot` as isolated circles) matching `qrcode.antfu.me`.
- Seeded marker-free decorative matrix, phase-locked to the placed QR's lattice. Finder/separator and alignment cells are randomly refilled; timing and function cells remain.
- Only whole modules fully covered by the selected region are drawn. The outer 0–5 safe-module rings are dark (antialiased when rounded). The plate does not seed that rim.
- The actual plate is the code grid plus finder-only light bands of one module (whole cells). Its footprint is smaller than the full QR square used for placement constraints.
- Outside-region pixels, partially covered modules, QR plate pixels, and original alpha are verified. Any mandatory check failure rejects export.
- Schema-8 reports are preserved. The poster and every artifact cross the worker/UI boundary as `Blob`s — no base64 serialization anywhere.
- The assembled `Blob` is the single source for both the preview and the download; the result is never re-rendered on the main thread.

The CLI, paid image generation, QR-image upload, and standalone pattern modes are retired. The browser editor is the supported product interface.

## Architecture

The render pipeline is entirely client-side:

- The shared pipeline lives in `src/lib/editor/engine/` (source cache, QR bundle cache, placement application, assembly, error-to-field mapping) and runs inside a **Web Worker**, exposed to React through Comlink (`src/lib/editor/worker/`). The engine depends on no platform: Node tests inject the sharp imaging backend, the worker injects the browser backend.
- PNG decode/encode uses `@jsquash/png` (WASM, lazy-loaded inside the worker); SVG rasterization uses `@resvg/resvg-wasm`; compositing, flattening, and nearest-neighbor resize are pure TypeScript shared by both backends (`src/core/imaging/`).
- Source identity is the file SHA-256 (`crypto.subtle`): an edit that only moves/resizes/reseeds re-runs geometry; a content/ecc/style edit only regenerates the QR; a new file re-decodes. A revision guard drops superseded outcomes at settle time — no `503 BUSY`, no aborts.
- The step-2/3/4 preview panels (`MaskPreviewCanvas`, `PatternSettings`, `MarkerDialog`, `ResultPanel`) and the icon gallery load on demand through `next/dynamic`, with a stable-size placeholder for the step-2 mask preview; each step warms the next step's chunks once it is open, so transitions stay instant. Step 1 never downloads them (initial JS ≈ 860 KB vs 1,050 KB eagerly loaded).
- Upload guards (PNG signature, IHDR, APNG `acTL` scan, 10 MiB / 4-megapixel limits) run client-side in `src/lib/editor/png-guard.ts` with the same error codes.
- Immutability rules unchanged: outside-region pixels, partially covered modules, QR plate pixels, and original alpha stay bit-exact, and mandatory verification failures reject export.
- The only HTTP endpoint is the thin icon-search proxy `GET /api/icons` (free upstream, mocked in tests); it plays no part in rendering.

See [client render migration plan](doc/plan/client-render-migration.md) for the engine contracts and the parity evidence between the wasm and sharp backends.

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
- `wrangler.jsonc` pins the Worker name (`qr-cool`), `compatibility_date`, `nodejs_compat`, and the `dist/client` assets binding. `dist/` and `.dev.vars` are gitignored; never commit API tokens.
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

`pnpm lint` runs oxlint (`.oxlintrc.json`) over the TypeScript, TSX, and config files, and `pnpm lint:fix` applies its safe fixes. `pnpm format` rewrites files with oxfmt, and `pnpm format:check` reports differences without writing; `.oxfmtrc.json` sets the project style (single quotes, no semicolons, two spaces, 120 columns) and skips generated directories. Both tools are dev-only and play no part in the request path.

Vitest covers engine geometry, the engine artifacts (with captured hash parity against the pre-refactor server output), the browser/sharp parity harness, decoder fixtures, pixel invariants, the client upload guards, blank-poster preparation, mask geometry, and the reducer's stale-response guards. Playwright runs production-server journeys in Chromium (`playwright.config.ts`, so `pnpm exec playwright install chromium` is the only browser install needed): the blank-canvas flow, the derived mask letter and example buttons, mask search with a mocked icon API, the icon gallery and its dismissal paths, the fill tool, marker dialogs opened from hovered canvas markers plus pattern settings (error correction, pixel styles, seed and rim), canvas nudging and dragging, worker-driven assembly, preview/download sharing one Blob URL, download-byte checks, no-render-API-call assertions, and result invalidation.

The same journeys also exist as plain-language Gherkin scenarios in `e2e/features/*.feature` with shared step definitions in `e2e/cucumber/`; `pnpm test:bdd` runs them with `@cucumber/cucumber` over the same Playwright Chromium (`cucumber.mjs` is the config). `@icons`-tagged scenarios use the mocked `/api/icons` proxy, the server lifecycle mirrors the Playwright config (starts `pnpm start`, reuses one already listening, kills the whole process group afterwards), and scenario screenshots attach to the HTML report in `reports/` on failure.

The pipeline lives in `src/lib/editor/engine/` and runs in a Web Worker (`src/lib/editor/worker/`); `src/core/` holds the shared rendering algorithms behind the imaging seam, `src/lib/editor/` holds schemas and reducer state, and `src/components/editor/` owns browser interaction. The only server surface left is the `/api/icons` proxy. No request invokes a CLI or writes temporary files.

See [web implementation plan](doc/plan/web-qr-poster.md). The [previous artistic QR plan](doc/plan/artistic-qr-poster.md) is historical design context.
