# Uninterrupted placement editing with an SVG preview

Status: proposed, not implemented. Written 2026-09-23.

## Goal

Let users drag, resize, and rotate the QR continuously without mask scans, worker preparation, placement-size rasterization, or validation notifications interrupting editing. **Assemble poster** becomes the explicit boundary for exact placement validation, full-resolution rendering, and mandatory pixel verification.

Use an SVG editing scene with Moveable controls. Keep the existing browser worker and rendering algorithms authoritative for export. An SVG editing surface can contain cached PNG images; this proposal does not require rewriting QR generation or converting uploaded posters into vectors.

## What happens today

- `src/components/editor/PreviewPanel.tsx` uses a Konva group and transformer. Each drag/transform event canonicalizes a candidate and calls `fitsMask`, which scans mask pixels on the main thread. The resulting green/red outline is only a containment hint, not the complete assembly validation.
- Gesture end calls `onChange`; `store.ts` canonicalizes placement and the pure reducer increments the document revision. Nudges also follow this path.
- `use-engine-request.ts` watches that revision and schedules `prepare` after 450 ms. The worker does **not** rasterize on every pointer event, but completed gestures and nudges trigger preparation.
- `EditorEngine.resolveLayout` calls `applyPlacement` and `validatePlacement`. These check containment, the rotated working frame, lattice, safe modules, region bands, and remaining texture. Valid placements then call `normalizeQr` at the placement size. `toPreparedPayload` encodes mask/overlay PNGs and creates a transparent QR preview again.
- `Prepared` includes placement and validation, and `selectCanAssemble` requires its revision to equal the document revision with no error. Merely suppressing the preparation effect would leave Assemble disabled after a move.
- Assembly already calls the shared placement validation and mandatory verification gates. The expensive checks need to leave the editing path; they must remain in the export path.

The performance improvement comes primarily from separating placement from preparation. Replacing Konva alone would retain the same interruption cycle.

## Library choice

| Option                                               | Fit for this editor                                                                                                           | Tradeoff                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React SVG + `react-moveable`                         | Recommended: React owns a small SVG scene; Moveable supplies drag, uniform resize/scale, and rotation handles for one target. | Needs an explicit adapter between screen coordinates, SVG coordinates, and canonical placement. Verify behavior with the project's React version and responsive layout. |
| `@svgdotjs/svg.js` + select/resize/draggable plugins | Viable SVG-specific alternative with selection, resizing/rotation, and drag events.                                           | Requires an imperative SVG subtree with clear ownership outside React reconciliation, plugin setup/cleanup, and styling integration.                                    |
| Existing Konva with preparation decoupled            | Useful first migration step and a fallback if SVG integration fails its checks.                                               | Removes the expensive pipeline work but retains a canvas scene and its hit-target/accessibility plumbing.                                                               |

Moveable documents SVG targets and provides a React package. Enable dragging, rotation, and **one** size operation with a fixed square aspect ratio; do not enable both resizable and scalable. Use uniform scaling of the upright group, then convert the final scale into `placement.size`. Disable flips, skew, warp, group selection, origin dragging, and unrelated tools. This recommendation is an integration judgment, not a claim of measured speed or bundle-size superiority. See the [React Moveable documentation](https://github.com/daybrush/moveable/tree/master/packages/react-moveable) and [Moveable API](https://daybrush.com/moveable/release/latest/doc/Moveable.html).

SVG.js resize supports aspect-ratio preservation, center resizing, and angular steps; draggable exposes gesture events. Its documented Firefox restriction on transformed root SVGs reinforces using `viewBox` for viewport fitting. If needed, use this alternative behind the same placement adapter, without installing both interaction stacks. See [SVG.js](https://svgjs.dev/docs/3.2/), [select](https://github.com/svgdotjs/svg.select.js), [resize](https://github.com/svgdotjs/svg.resize.js), and [draggable](https://github.com/svgdotjs/svg.draggable.js).

Before selecting package versions, check their current peer dependencies and run a small integration spike against the installed React/Next.js versions. No packages are added by this plan.

## Interaction contract

1. The source poster, selected-region highlight, QR image, marker targets, and selection controls remain visible while editing. Placement changes do not replace the scene with a loading state or regenerate its image URLs.
2. During a gesture, update only a transient transform held in component refs. Coalesce visual writes with `requestAnimationFrame`; avoid store updates, pixel reads, image encoding, and worker calls in move handlers.
3. On successful gesture end, commit one canonical placement. A commit invalidates any assembled result but leaves reusable preview assets intact. Arrow keys and touch nudge buttons use the same commit path without preparing images.
4. Keep inexpensive structural constraints: finite values, square aspect ratio, minimum four-pixel module pitch, integer output pitch, and normalized free rotation. Do not scan masks or run full placement validation, including after pointer release or an idle debounce.
5. Permit placements outside the selected region to remain visible and editable. Show a neutral editing outline and a stable caption such as “Assemble to check placement and render the final poster.” Do not imply that an unchecked placement is valid by showing the current green fit indicator.
6. On assembly failure, retain the exact placement, stay in the editor, and report the authoritative error through the existing toast surface. Dismissing the toast does not change error state. Editing the relevant input clears the obsolete error and allows another attempt.
7. On success, show the exact verified assembled Blob in the result view and use that same Blob for download. Returning to editing restores the same position, size, and rotation.

Preview rendering remains an approximation: browser image scaling/antialiasing is not export sampling, and the editing scene still does not show the generated decorative texture. Rim/margin/plate settings affect assembly; their controls stay available. No raster export is produced by serializing or screenshotting the SVG scene.

## Split preview assets from document placement

Replace the placement-dependent prepared payload with reusable editing assets. Keep all work inside the existing session-owned Comlink worker.

| Change                                                        | Work allowed before assembly                                                                            | Work deferred to Assemble                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Poster or selected mask                                       | PNG guards, decode, source cache, region detection or manual mask, region bounds, mask/highlight assets | Placement containment and safe-module/frame checks                     |
| Committed content, ECC, pixel style, marker settings, palette | Generate/cache upright QR and metadata; content/capacity/palette guards and generated-QR decode checks  | Normalization to placed size and placement-dependent rendering         |
| Position, size, rotation                                      | Local transform and one canonical placement commit                                                      | All mask/working-frame/lattice/texture validation and output rendering |
| Seed, Rim, Margin, plate-corner settings                      | Commit settings and invalidate result; update any cheap vector decoration if present                    | Texture generation, region-band calculations, and pixel verification   |
| Fill region                                                   | Existing source-mask operation, then refresh mask/highlight assets                                      | Validation of the QR against the changed mask                          |
| Draft text, hover, dialogs, panel state                       | Existing local/store UI behavior                                                                        | No new engine work                                                     |

The QR source is currently generated at a fixed pitch in `src/core/qr.ts`. Reuse a transparent preview Blob made once per QR cache key; carry its intrinsic dimensions independently of the placed size. Keep the opaque source for assembly. Source generation can still use the existing raster backend on content/style changes. “Rasterize at assembly” here means **placement-dependent normalization and final poster rendering** move there; decoding PNG uploads and generating reusable previews are still necessary.

Separate source/mask assets from QR assets so a marker-color change does not re-encode the full-poster highlight. Cache these using the existing SHA-256 source identity and QR cache settings. Return Blobs, not data URLs. Do not create an SVG node per poster pixel or a second implementation of rounded modules/finder geometry.

Initial placement must no longer require a successful exact fit. When there is no placement, suggest an upright square centered on the region bounds, using a bounded heuristic pitch of at least four pixels. If the region is too small or irregular, still display the QR for editing and let Assemble explain the failure. Never run the current exhaustive valid-fit search just to make the editor usable. For an existing placement, source/mask refreshes do not reposition it.

When QR module count changes, preserve the latest placement center and integer module pitch, resize the square once, and keep its rotation. Perform this reconciliation against the **current** placement when new metadata is accepted, not the placement captured when asset generation started. Document pixel rounding explicitly. Do not clamp the recentered box to the canvas to make it fit.

## Placement geometry and SVG scene

- Use `viewBox="0 0 W H"` in poster pixel units. Render the poster and region highlight as `<image>` layers. Fit the viewport without CSS-transforming the root SVG.
- Put the upright QR image, its crop/plate presentation, marker targets, and selection reference box in one local group. Rotate the complete group about its center. Preserve the existing two-module source-margin coordinate system and current preview transparency/crop semantics; derive crops from asset dimensions, not the latest placement dimensions.
- Store only `{ x, y, size, rotation }` as canonical placement. The interaction library's transform strings/matrices are temporary, never a second document model. `x/y` describe the unrotated square's origin, not the rotated axis-aligned bounding box.
- Map screen input into poster space using the inverse SVG screen transform; map marker and Fill hits through existing `posterToPlatePoint`/`plateToPosterPoint` geometry where appropriate. Refresh measured viewport transforms after resize or scroll; avoid alternating layout reads and writes on every event.
- On commit, compute `pitch = max(4, round(size / totalModules))` and the resulting square size. Preserve the gesture's resulting center when applying pitch quantization, round the origin once, and canonicalize the angle. Show this snapped placement immediately; Assemble must consume it without further silent adjustment.
- Allow signed integer origins in the editing placement model so off-canvas and recentered placements remain representable. Keep export bounds strict: translate an invalid origin/footprint into a placement error at Assemble. Separate editable placement parsing from export eligibility rather than letting a generic schema rejection strand the editor. Do not use today's `canonicalPlacement` clamp to move an invalid box back into bounds.
- Keep sufficient surrounding workspace and reachable controls for partially off-canvas placements. Include a deliberate “Center QR” recovery action if needed for a wholly off-canvas target; it changes placement only on user request and does not promise a valid fit.
- Escape cancels an active transform back to its start placement; otherwise it retains the existing Fill-mode exit behavior. Pointer cancellation and lost interaction ownership must leave the visible transform and stored placement consistent.

Retain the sketch styling, semantic colors, StyleX ownership, and rem/em rules. Style the interaction controls through supported component/configuration hooks; do not add global stylesheet overrides to `globals.css`. If package styling cannot satisfy these constraints, resolve it during the spike before migration.

## State, readiness, and asynchronous work

Keep the pure reducer as the state-transition boundary. Extend its identities rather than adding a second store or async framework:

- **Document revision:** changes on every committed source/content/settings/placement edit; owns result validity and assembly outcomes.
- **Preview asset identity/revision:** changes only when source/mask or QR appearance dependencies change. Placement-only commits do not obsolete matching assets or cancel their in-flight generation.
- **Operation/lifecycle tokens:** remain outside the store, scoped to asset preparation and assembly independently. An older completion cannot clear a newer operation or error.

An asset response is accepted only for its current dependency identity and live session. It must not replace placement except for the explicit initial-placement/module-count reconciliation above. A matching asset response may legitimately arrive after a placement revision; do not discard it solely because the document revision advanced. Likewise, it cannot clear an assembly error for that document. Update worker stale-settlement logic consistently: the current single `latestRevision` comparison cannot conflate asset work with document assembly revisions.

`selectCanAssemble` should mean that committed content and required inputs are structurally ready, preview metadata matches current asset dependencies, a canonical placement exists, and no required asset/mask/search/assembly work or blocking input error is pending. It must **not** require a previous exact placement success or matching `Prepared.revision`. Keep known failure state authoritative until a relevant edit or explicit retry; implement assembly retries without a circular readiness check that blocks the retry itself.

Transient pointer motion is not a document revision. On gesture start, leave any result view and disable assembly through local interaction state. Gesture end commits before assembly can capture a request. An Assemble click must never read an older store placement while an uncommitted transform is visible.

Editing remains possible while an assembly request runs. Starting a gesture obsoletes its UI operation token immediately; subsequent canonical commits also invalidate the document revision. Any late success/error is discarded, including one that arrives before pointer-up. A cancelled gesture can discard that assembly attempt rather than suddenly switching views. Clear only that operation's busy state, so abandoned work cannot leave the editor stuck or clear a newer request.

For source/QR changes during a gesture, cancel the gesture deterministically before switching its coordinate basis, then apply the current canonical placement and new metadata. Keep image URLs stable until their owning asset changes, revoke on replacement/unmount via `useBlobUrls`, and preserve the existing mask/file/toBlob stale guards. Zundo remains a bounded read-only trace with no new Blob or runtime-ref snapshots.

## Assembly remains authoritative

The explicit action snapshots committed content, source/mask, settings, stable seed, and the latest canonical placement at one document revision. In the existing worker:

1. Resolve/cache source and QR data; repeat required input/content/palette guards at the engine boundary.
2. Run the shared exact placement checks: canvas/region containment, integer pitch, rotated working-frame coverage, whole safe modules, plate/region bands, supported texture dimensions, and room for decorative texture.
3. Normalize the opaque QR to the placed size, render the texture and complete plate with the existing upright/rotated paths, then composite onto the original poster.
4. Run every existing mandatory pixel check. Reject failures without installing a result or exposing a download.
5. Return schema-8 report/artifact Blobs. Accept only the current operation and document revision.

Preserve byte-identical outputs for the same valid canonical inputs, including the default palette and existing golden fixtures. Preserve source alpha, outside-region pixels, partially covered modules, QR pixels, phase locking, marker-only light bands, and rotated-frame rejection. The poster decode checks remain skipped and `phoneScan` remains untested. This change does not relax export rules or introduce a render API.

## Preserve other preview interactions

- Fill remains a source-mask operation in both region-only and QR views. Its temporary canvas is still appropriate for reading/filling pixels; an SVG editing surface does not eliminate that need. Never fill from the highlight, composited preview, or placed QR. Ignore QR hits and disable transformation controls while Fill is active.
- Marker targets use local SVG geometry and keep one reusable native `MarkerDialog`. Suppress marker click activation after dragging, support touch and keyboard activation, and keep dialogs/hover local to the component. Version-1 QR codes still have no alignment target.
- Keep arrow-key/Shift-key nudges and touch buttons. Provide keyboard-accessible size and angle controls so moving to SVG does not make these operations pointer-only. Announce completed edits sparingly, not every frame.
- Apply gesture-specific touch behavior to the target and handles; scrolling the surrounding preview and mobile page must remain available. Check cancellation when a native drawer opens, viewport size changes, or focus leaves the interaction.
- Keep the assembled-result view free of editing controls, and preserve shared desktop/mobile panel instances and focus return.

## Implementation sequence

1. **Separate engine assets from placement.** Refactor `engine/types.ts`, `engine/engine.ts`, and `engine/pipeline.ts` to return source/mask assets and a reusable upright QR preview without calling placement validation or normalization. Keep exact checks in assembly. Add the unchecked initial-placement suggestion and explicit module-count reconciliation.
2. **Change reducer and readiness together.** Update `state.ts`, `store.ts`, `selectors.ts`, `use-engine-request.ts`, worker settlement, and `Editor.tsx` for separate asset/document identities. Keep the existing Konva surface temporarily, remove its per-event mask scans, and prove that placement commits no longer trigger preparation. This isolates the main responsiveness improvement from the library migration.
3. **Spike the SVG/Moveable adapter.** Exercise one group with the real QR image, responsive viewBox, nested scroll, free rotation, uniform scale, module snapping, and marker hits. Check current React compatibility, Strict Mode cleanup, library styling, touch, Firefox/Safari/Chromium behavior, and actual bundle impact. Switch to SVG.js only if the same bounded spike demonstrates a blocker; retain the same state contract.
4. **Replace the placement surface.** Extract a focused SVG scene/interaction component from `PreviewPanel.tsx`, with component-owned refs and the shared geometry adapter. Preserve region-only, Fill, marker dialogs, toolbar, keyboard/touch controls, and result transitions. Lazy-load browser-dependent controls from a Client Component using the installed Next.js guidance.
5. **Remove the old surface and document the behavior.** Remove Konva dependencies only after checking all imports and completing migration. Update `README.md` and `doc/plan/web-qr-poster.md` when the behavior ships. Update `AGENTS.md` rules that currently require placement validation during preparation, current prepared-document revision equality, and canvas-specific hit targets. Promote the durable replacement rules and remove this plan when complete.

Do not change draft/content commit behavior as part of this work. Existing documentation and AGENTS wording differ on that trigger; preserve the implemented flow and scope documentation changes to preview/assembly behavior.

## Verification checkpoints

These are checks for implementation, not commands to run for this proposal. Follow repository policy: run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e` only when explicitly requested. Update browser journeys only when requested.

| Area              | Required evidence                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gesture work      | Continuous drag/resize/rotation, gesture end, and repeated nudges cause zero prepare/assemble RPCs, mask scans, PNG encodes, placement normalization, or preview Blob replacements.                                                       |
| Responsiveness    | Record a browser trace with a 4-megapixel poster and a dense QR on desktop and mobile. Compare with baseline; target no gesture-handler long tasks over 50 ms and frame work within the device's frame budget. SVG alone is not evidence. |
| Geometry          | Pointer/placement round trips at 0°, 30°, 45°, 90°, and 359°, at multiple viewport scales and scroll positions; center remains stable through quantization and QR module-count changes.                                                   |
| Invalid placement | Outside mask/canvas, negative origin, holey mask, no texture space, and frame-coverage failure remain editable; Assemble rejects with no result/download and no automatic movement. A corrective edit enables a new attempt.              |
| Asset identity    | Placement edits during source/style preparation preserve the latest placement; only matching assets are accepted. Rim/seed/margin changes invalidate results without regenerating QR or mask PNGs.                                        |
| Lifecycle         | Edit during assembly, pointer cancellation, source change during gesture, rapid content/style changes, retries, unmount/remount, and late mask/toBlob completions cannot install stale output or clear newer work.                        |
| Existing controls | Fill before/after QR creation, rotated marker hits, version-1 markers, touch scrolling, keyboard size/rotation/nudges, native drawers, Escape, and result-to-editor return all retain their intended behavior.                            |
| Export parity     | Existing valid upright/rotated inputs and golden fixtures remain byte-identical; mandatory verification rejects failures; preview/download share the exact assembled Blob.                                                                |

Use focused reducer/engine/geometry tests for the new dependency and race boundaries. Do not add tests that merely restate a library's implementation. Keep performance measurements local and avoid a new telemetry subsystem.

## Guidance used

The `modern-web-guidance` skill's performance and individual-transform guides recommend separating immediate UI updates from heavy work, coalescing frequent handlers, and avoiding layout thrashing. Apply those principles to the interaction adapter; use one explicit SVG transform convention instead of mixing library transform strings, CSS individual transforms, and SVG attributes with competing ownership.

The installed Next.js guide at `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` requires `ssr: false` to live in a Client Component. Keep browser-only interaction initialization behind that boundary and dispose listeners/observers/animation frames on unmount.

Fully vector QR artwork, live decorative-texture rendering, a general-purpose SVG document editor, SVG export, undo/redo, persistence, URL synchronization, and additional export sizes are outside this proposal.
