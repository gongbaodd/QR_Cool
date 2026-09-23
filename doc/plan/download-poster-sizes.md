# Download the assembled poster at different sizes

## Goal

After a successful full-resolution assembly, show the smallest _eligible pixel dimensions_ for that exact QR content, error-correction level, placement, and selected region. Let the user download the original PNG, the smallest verified PNG, and useful intermediate PNG sizes. Keep the poster's aspect ratio and the QR's integer module grid. All work stays in the existing browser worker.

“Smallest” means the smallest output dimensions the renderer can produce under its 4-pixel minimum module pitch and mandatory placement/assembly checks. It does **not** mean the fewest PNG bytes or a guaranteed phone-scannable size. PNG byte count is known only after encoding, and the current artistic poster is deliberately not scan-certified.

## Current contract

- `uqr` chooses the QR version for the committed content and ECC setting. If the code grid has `n = 21 + 4 × (version − 1)` modules, its normalized square has `m = n + 4` modules because the source adds two margin modules on each side.
- The final placement has integer module pitch `p = placement.size / m`; `src/core/placement.ts` requires `p >= 4`. For the placed QR alone, the theoretical minimum square is `4m` pixels. This is **not** the minimum whole-poster size.
- The assembled poster currently has the uploaded/blank canvas dimensions. `ResultPanel` previews and downloads the same verified `poster.png` Blob. `useBlobUrls` owns its URL. The schema-8 report and other artifacts belong to that original export.
- A scale change can make a region, rotated plate, rim, or texture invalid. Shrinking the already assembled bitmap with a generic image scaler can blur or unevenly sample QR modules. A smaller export must therefore be rendered and checked at its own resolution.

## Size model

1. Use the **actual prepared QR metadata and canonical placement**, not an estimate from character count. Let the original poster be `W × H` and its placed module pitch be `p`.
2. Consider integer target pitches `q` from `4` through `p`. For each, set the target QR square to `m × q`; derive target poster dimensions from the uniform ratio `q / p`, rounding each dimension once to integer pixels. Use the same ratio to map the original placement origin, with a documented deterministic rounding rule; preserve its rotation and center as closely as the pixel grid permits. Never change the editor's canonical placement.
3. Reject a candidate if rounding makes the QR square or rotated footprint leave the target canvas/region, if the target pixel count is invalid, or if shared placement, texture, rim, crop, or frame-coverage validation fails. Never silently shift a candidate to make it fit.
4. Reassemble eligible candidates at the target resolution and require every existing mandatory verification check to pass. The smallest **verified** candidate is the first passing pitch in ascending order. If no smaller candidate passes, show “Original is the smallest available size.”
5. Compute preset intermediate choices (for example, near 50% and 75%) by choosing the nearest distinct _verified or validation-eligible integer pitches_. Show their exact dimensions and target module pitch; omit duplicate or impossible choices. Keep the original option regardless of the candidate search outcome.
6. Report the encoded PNG byte size only after a size has been rendered. Do not rank sizes by guessed compression ratio: smaller dimensions can sometimes produce a larger PNG.

For example, version 5 has `41` code modules and `45` modules including the source margin. Its minimum QR square at `q = 4` is `180 × 180` pixels. The minimum **poster** dimensions also depend on the original poster dimensions, current QR pitch and position, rotation, mask, and successful assembly at the smaller resolution.

## Worker and rendering design

- Extend the existing engine/Comlink session with a size-export operation for the current document revision. Reuse the cached decoded source, chosen region mask, QR bundle, settings, and seed. Do not add a server route, a new RPC layer, or a main-thread full-resolution canvas.
- Downsample the source poster in the worker with area-weighted, premultiplied-alpha sampling so transparent edges do not gain color halos. Resample the _already selected_ region mask conservatively, so a target pixel is selected only when its covered source footprint belongs to the region; recompute the target mask's bounds, area, and centroid. Do not re-detect the black region or use the rendered overlay as the mask. Keep target poster and mask dimensions identical.
- Build a target `ResolvedLayout` using the same QR data at pitch `q`, the mapped placement, and the resized source/mask. Normalize the QR at `m × q`, then use shared validation and `assembleResolved` so rotated working-frame checks, safe-cell rules, compositing, and mandatory pixel verification run at target resolution. Keep the content, ECC, marker style, seed, rim, margin, and corner settings fixed.
- Preserve schema-8 reports. Each generated variant gets its own report with its own dimensions and placement; the original report and artifact bytes remain unchanged. Return a variant PNG Blob and its report through the current worker boundary. Name downloads by dimensions, such as `poster-344x283.png`, while preserving `poster.png` for the original.
- Generate the minimum candidate after the original result becomes available, without delaying display of the original. Generate other sizes on demand and keep at most the active variant plus the original Blob in UI memory. An assembly/encoding failure removes that candidate and continues the minimum search, or shows a size-specific error for an on-demand choice. Never offer a failed variant as a download.

## Result UI and lifecycle

- Add a labeled size selector in `ResultPanel`: **Original**, **Smallest**, and available intermediate dimensions. Show each choice's `W × H` pixels and its QR module pitch; show actual file bytes once encoded. Display a calculating state while the smallest verified size is being found.
- Keep the preview and download link tied to the exact same Blob for the _active_ size. Default to Original. On selection, keep the current preview and its download link visible until the new variant is ready, then switch both together. Keep the existing phone-scan warning beside the download.
- Use the current editor revision and an operation token/lifecycle guard so an edit, new assembly, size change, or unmount cannot install an obsolete variant or clear a newer operation. Size selection is UI state: it must not create a document revision, invalidate the original result, or trigger preview preparation. Create and revoke variant object URLs at the UI boundary with `useBlobUrls`.
- Preserve keyboard access with a native select or radio group and a regular download link. Keep size controls usable on narrow screens without duplicating panel instances. Announce completion or failure once through the existing feedback surface.

## Build sequence and verification checkpoints

1. **Pure size calculation.** Add a helper for version/module-count math, candidate dimensions, rounding, and preset selection. Check version 1, version 5, long content, `p = 4`, odd poster dimensions, and placements near the edge. Confirm the helper never suggests a target QR pitch below 4 or calls a theoretical bound “verified.”
2. **Target-resolution assembly.** Add worker-side source/mask resizing and variant assembly through the existing renderer. Check transparent blank posters, uploaded alpha, irregular/holey masks, Add Rim/Add Margin, rotations, and a case where `q = 4` fails but a larger pitch passes. Validate every variant's own mandatory checks and schema-8 report; prove the original `poster.png` bytes remain unchanged.
3. **Result controls.** Add lazy generation, paired preview/download Blob handling, size-specific errors, and stale-completion cleanup. Check that rapid size changes and returning to editing cannot download an old revision.
4. **Manual browser review.** Inspect several content lengths, ECC settings, portrait/landscape posters, and phone scans of the smallest output. Compare the downloaded PNG dimensions and bytes with the selected preview. Follow the repository rule: run `pnpm test`, `pnpm typecheck`, `pnpm build`, or `pnpm test:e2e` only when explicitly requested; update the browser journeys when the maintainer asks.
5. **Ship docs.** When implemented, update `README.md` and `doc/plan/web-qr-poster.md` with the size choices and limits, promote the durable rules to `AGENTS.md`, and remove this completed plan from `doc/plan/`.
