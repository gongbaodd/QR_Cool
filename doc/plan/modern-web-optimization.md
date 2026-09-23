# Modern web optimization plan

Status: in progress, 2026-09-21. The P0 verification baseline is restored and plan step 2.1 (deferred step-panel chunks) is shipped; the browser-profiling items of step 1 remain for the maintainer.

## Goal and constraints

Make the editor quicker to open and more responsive through mask editing, QR placement, and export. Make the same journey usable with keyboard, touch, zoom, and assistive technology. Preserve the current client-side architecture and the rendering contract in `AGENTS.md`: PNG-only input guards, exact QR generation, bit-exact protected pixels, mandatory schema-8 verification, and a single assembled Blob for preview and download.

Use the [Modern Web Guidance](https://www.npmjs.com/package/modern-web-guidance) guides `performance`, `accessibility`, `efficient-background-processing`, and `optimize-image-priority` (queried with skill version `2026_09_04-7de96777`). Follow the installed Next.js 16.3.5 documentation under `node_modules/next/dist/docs/01-app/` for implementation details. The recommendations below are tied to current code; suspected bottlenecks still require a production-browser baseline.

## Current state and opportunities

| Area                      | Current evidence                                                                                                                                                                                                 | Opportunity to measure                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial JavaScript        | `src/app/page.tsx` renders the client `Editor`; `Editor.tsx` imports all step components and `PreviewPanel.tsx` imports mask preview, result, and settings eagerly. Only the Konva `Canvas` is a dynamic import. | **Shipped 2.1 (2026-09-21):** `MaskPreviewCanvas`, `PatternSettings`, `MarkerDialog`, `ResultPanel`, and `IconGallery` are `next/dynamic` chunks with a stable-size step-2 placeholder and next-step warmers. Production-build measurement: step-1 initial JS ~1,050 KB → ~860 KB raw (~295 KB → ~230 KB gzipped). LCP/INP traces still pending. |
| Fonts                     | `Editor.tsx` calls `document.fonts.load()` for every mask font on step 2. `globals.css` declares the bundled faces with `font-display: swap`.                                                                    | Record step-2 font requests, load time, and whether mass loading delays the mask grid or other work. The visible grid needs its distinct faces, so preserve its appearance.                                                                                                                                                                      |
| Placement feedback        | `Canvas.tsx` reads the full region PNG into a `Uint8Array` on the main thread; every drag/transform event calls `fitsMask()`, which scans the placed square (and rotated footprint) pixel by pixel.              | Profile long tasks and dropped frames for the largest allowed poster, especially a large rotated QR.                                                                                                                                                                                                                                             |
| Mask fill                 | `MaskPreviewCanvas.tsx` runs `getImageData`, flood fill, dilation, and a full pixel composite synchronously on click, then scales and encodes the mask.                                                          | Measure click-to-feedback and main-thread blocking on the 600×600 preview and 4 MP output.                                                                                                                                                                                                                                                       |
| Worker traffic and memory | `use-engine-request.ts` reads and transfers both Files on each prepare/assemble. The worker caches decoded sources, but `engine.ts` allows region variants and QR bundles to grow during a long session.         | Measure transfer cost and retained memory after repeated text, mask, and poster changes before changing the cache design.                                                                                                                                                                                                                        |
| Accessibility             | Native `<dialog>` is already used for icon and marker dialogs. The canvas marker hit targets are pointer-only; mask choices use button-based ARIA radios; step changes do not explicitly move focus.             | Audit keyboard paths, radio behavior, announcements, focus, contrast, and 200% zoom.                                                                                                                                                                                                                                                             |
| Images                    | Gallery thumbnails already have dimensions and `loading="lazy"`; the poster preview comes from a user-provided Blob URL.                                                                                         | Identify the actual LCP element before applying image priority. Keep the exported PNG bytes untouched.                                                                                                                                                                                                                                           |

## Sequence and verification gates

### 1. Establish a reproducible baseline (P0)

Before changing renderer behavior, restore the existing verification baseline. On 2026-09-21, `pnpm test` passed 81/84 tests; `test/rotation.test.ts` has two failing frame/phase assertions and `test/engine.test.ts` has one failing poster hash assertion. Investigate the renderer/fixture history before changing expected hashes or geometry. `pnpm typecheck` and the production `pnpm build` pass.

**Investigated and restored (2026-09-21).** History check across `4c07b3b` (pre-rotation baseline), `efcbd95` (`wip:` tree), `80cbf8d` (`fix:rotate pixels`), and `36fe3cf`:

- `test/rotation.test.ts` was committed red in `80cbf8d` — its `upright` expectation (`left: 0, qr: {x: 0, y: 0}`) contradicts the passing `shifted` case in the same test (`left: 8, qr: {x: -8}`); no single frame convention satisfies both. The implemented plate-local convention is self-consistent with the rotate-back loop (`local.x - frame.left`) and the sampling pass, so the stale expectation was corrected to `left: -12, top: -7, qr: {x: 12, y: 7}` — the frame still covers exactly the poster's pixel extent.
- The engine parity pin was set to `310916c8…` in `80cbf8d`, but both the pre-rotation baseline tree and every tree since produce `5a76e560…` — the rotated-fill rewrite **preserved the 0° assembly byte-for-byte**, which is exactly what the parity test protects. The pin was restored to the pre-refactor baseline (poster `5a76e560…`, QR `69c7ea63…`), no hash was weakened.
- `result.report.pattern.alignment.phase` could report `-0` on rotated placements (negative residual). `assemble.ts` now normalizes the residual to a non-negative remainder; rendering math and artifact bytes are unchanged.
- Baseline after the fix: `pnpm test` 84/84, `pnpm typecheck` and `pnpm build` clean.

1. Run `pnpm build` and `pnpm start`; profile the production build, not `pnpm dev`. Capture desktop and mid-range mobile emulation at 320 px and 1280 px, cold and warm load, using `source/poster.png` and a valid noisy PNG near the 4 MP limit. Use local fixtures and mock icon responses; no paid calls or user content in telemetry.
2. Record LCP, INP, CLS, initial JS transferred and executed, font requests, worker startup, long tasks, and peak/retained memory. Mark step transitions, first prepare, repeated prepare, drag/rotate, fill, and assemble with `performance.mark`/`measure` in a removable local harness. Keep timings for five runs with the same hardware and browser; report median and slowest run.
3. Inspect the production client chunks and a Performance trace to identify whether the suspected costs above are material. Record the baseline in this document or a linked report before selecting implementation work.

**Gate:** a reviewer can reproduce the measurements and point to a trace for each selected optimization. Use the Core Web Vitals good thresholds as goals at the 75th percentile where field data exists: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Local lab runs are comparison data, not field-percentile claims.

### 2. Reduce work before each step is needed (P1)

1. If the bundle trace confirms excess initial JS, split step-2 mask preview and icon gallery, step-3 settings/dialogs, and step-4 result UI at the existing client boundary. Keep step 1 server-prerendered through Next's current client-component behavior. Retain a stable-size loading placeholder for any delayed panel, and confirm the split does not add a visible pause after **Continue**. Do not move `ssr: false` into a Server Component.
2. Profile the hand-letter font separately from the mask fonts. Preload only a measured critical face if the first-view LCP is text and the preload improves it. For the twelve mask tiles, test loading when step 2 opens and preserving exact glyphs; consider licensed WOFF2 conversion or subsetting only if the font waterfall is material and every supported mask character remains available.
3. Keep the current lazy gallery thumbnails and their explicit 34×34 dimensions. Apply `fetchPriority="high"` only if a network image is proven to be the first-view LCP; the user-supplied poster Blob is created later and does not justify an initial image preload. Do not route the exact export Blob through an image optimizer.

**Gate:** compare initial JS, parse/execute time, LCP, CLS, and step-2 ready time with baseline. The mask tile grid, chosen mask pixels, and first step stay visually and functionally equivalent.

### 3. Keep editing interactions responsive (P1)

1. Profile the `Canvas.tsx` mask extraction and `fitsMask()` path. For unrotated placement, evaluate an exact precomputed occupancy query; for rotated placement, reduce duplicate work and limit transient border checks to one per animation frame or a worker-backed query. Keep a clear pending/invalid visual state rather than showing unverified green. On drag/transform end, use the existing exact placement validation; never weaken the assembly check.
2. Profile `MaskPreviewCanvas.tsx` fill. If its synchronous loops create long tasks, move the pure pixel calculation to a worker or split it into measured chunks, leaving immediate button/cursor feedback on the main thread. Feature-detect `scheduler.yield()` if task slicing is used and provide a fallback; this API is not Baseline everywhere.
3. Avoid repeated full-resolution canvas work when a selection, preview, or Blob identity has not changed. Keep object URL creation/revocation centralized in `useBlobUrls` and preserve the original assembled Blob for download.

**Gate:** no >50 ms main-thread task attributable to drag/rotate or fill on the test device if feasible; observed INP stays within the 200 ms good threshold. Repeat placement, rotated-mask, fill, and pixel-invariant tests, and compare exported bytes/report checks with baseline fixtures.

### 4. Bound worker and source lifetime (P2)

1. From the trace, decide whether repeated `File.arrayBuffer()` and transfer dominate warm prepare. If so, reuse immutable source bytes or a worker-held source identity for unchanged Files without sending the same large input every time. Preserve SHA-256 identity and revision-based stale dropping. Keep the worker API small; avoid a second transport or base64 path.
2. If memory grows across edits, cap per-poster region variants and QR bundles (or evict on revision/source change) in `engine.ts`. Keep the currently useful decoded poster cache. Release obsolete previews and decoded UI images when a step or source changes.
3. Run a repeat-edit soak: change content, masks, placement, and posters through at least 20 revisions, then return to a single source and record retained memory, preparation time, and stale-result behavior.

**Gate:** warm edits are faster or equal to baseline with no growth trend in retained memory after obsolete work is released. Stale replies never replace newer state; all export invariants and Blob URL cleanup still hold.

### 5. Complete the accessible editing journey (P1)

1. Give finder and alignment-marker settings a visible keyboard-operable trigger near the canvas, or equivalent native controls. Preserve pointer hit targets. Review the button-based mask radiogroup against expected arrow-key behavior; prefer native radios where they fit the design. Remove redundant `aria-selected` on labels around native radio inputs.
2. On step transitions, move focus to the new step heading or first relevant control and provide a concise polite status for meaningful prepare/assemble completion. Associate field errors with inputs. Avoid multiple simultaneous `role="alert"` announcements for routine progress. Keep native dialogs and verify Escape, close, backdrop, and focus return.
3. Test at 320 px width and 200% zoom with keyboard-only navigation, touch controls, and a screen reader. Check visible focus, text/control contrast, canvas instructions, and that zoom does not hide export actions or trap focus. Add reduced-motion behavior only if an actual animation needs it.

**Gate:** a user can enter text, select a mask, set marker style, position the QR, assemble, inspect, and download without a pointer. Run an accessibility-tree/axe audit plus manual keyboard and screen-reader checks; automated scores alone are insufficient.

### 6. Regression and handoff (P0 for every implementation phase)

- After each behavior change, update `README.md` and `doc/plan/web-qr-poster.md` with the shipped behavior. Keep this document's status and measurement table current.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before handoff. Preserve tests for exact protected pixels, whole-module drawing, QR plate, PNG limits, stale revisions, and schema-8 report checks.
- Follow the maintainer's browser workflow: exercise UI changes manually first. Update `e2e/editor.spec.ts` and run `pnpm test:e2e` only when requested.

## Deliberate limits

- Do not add a service worker, manual critical-CSS injection, blanket `content-visibility`, or a generic caching layer without a trace showing a relevant bottleneck. This editor has one short active step at a time and no continuous offscreen animation loop. `contentvisibilityautostatechange` is useful only if future screens run expensive work while offscreen.
- Image format conversion is appropriate for optional gallery/network previews only if needed. Poster and mask inputs remain PNG, and the export stays the exact verified PNG Blob.
- Any visual-only placement approximation must defer to exact worker validation before assembly. Changes to the rendering algorithm require pixel parity evidence, not only a faster trace.

## References

- [web.dev: Core Web Vitals thresholds](https://web.dev/articles/vitals) and [optimizing INP](https://web.dev/articles/optimize-inp)
- [Next.js: lazy loading Client Components](https://nextjs.org/docs/app/guides/lazy-loading), [font optimization](https://nextjs.org/docs/app/getting-started/fonts), and [analytics/Web Vitals](https://nextjs.org/docs/app/guides/analytics)
- [MDN: `scheduler.yield()` support and feature detection](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
- [Existing client rendering migration](client-render-migration.md) and [web implementation plan](web-qr-poster.md)
