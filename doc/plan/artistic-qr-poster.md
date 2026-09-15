# QR pattern fill

## Behavior

- Keep the current QR size, position, and white margin.
- Crop whole cells from the central third of the placed QR. Narrow the crop for small QR versions to exclude corner markers and their separators.
- Save the crop as `pattern-reference.png`.
- Place the crop once at the top-left of a plain white reference canvas at its original pixel size. Save that canvas as `reference-canvas.png` and send Qwen the selection mask, reference canvas, and prepared poster, in that order.
- Ask for a new, non-repeating arrangement of rounded black cells on white, with even density and the same cell size. Do not copy, enlarge, stretch, or tile the sample. No markers, text, or scenery.
- Use generated pixels only inside the fill region. Keep original pixels outside it and overlay the exact QR.
- No external reference image is needed or accepted.

## Run

```bash
pnpm qr-poster -- --generate --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/qwen-fresh
```

The CLI generates its QR from the required single-line `--content` value. It uses `uqr` at ECC M with automatic mask selection, renders the existing rounded style at 20px/module with a two-module margin, and verifies that generated source before placement. `--dry-run` prepares the layout without a network call. `--generated-image <path>` reuses a saved result offline. API setup and other options are in README.md.

## Checks

- Test that the crop contains the supplied QR pixels and excludes corner markers.
- Test that the reference contains exactly one unscaled crop: the only non-white block in `reference-canvas.png` is the crop at the origin, with no tiles or enlargement.
- Check API image order and the complete prompt.
- Check exact QR pixels and original pixels outside the fill region.
- Decode the final PNG, half-size version, and JPEG quality 80.
- Inspect the sample for even density, matching cell size, no repeated tiles or enlarged fragments, and no extra markers, text, or scenery. Record this separately from scan results.
- Phone scanning remains untested until checked manually.

## Marker protection

The first center-crop trial still produced extra circles because Qwen could see the complete QR in the poster input. The API input now covers the protected QR square with white. The center crop is the only QR pattern visible to Qwen. Local compositing restores the exact QR afterward; `before-ai.png` still shows the actual layout.

The current `source/qr.png` is 753×748 and failed the square-input check at the time; it was left untouched then and is accepted later through the code-grid fallback. Tests and these Qwen-era samples use the original 820×820 QR, saved as `test/fixtures/qr.png`.

Previous trials enlarged the crop or repeated it as tiles. The reference now contains one unscaled crop on a plain white canvas. The prompt asks for new cells based only on the sample’s shape and size. No external image is used.

## Fresh-fill trial (2026-09-15)

Historical run used the then-supported QR fixture input. The equivalent current command is `pnpm qr-poster -- --generate --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/qwen-fresh`. One paid generation was made (request `0e18aab6-11b8-9208-b428-ff7ac6cd49da`). No retry was attempted and the mandated prompt sentence was not reworded.

Reference, checked: `reference-canvas.png` is 688×576 with exactly one unscaled 65×65 crop at the origin and pure white elsewhere, and `pattern-reference.png` is that same crop pixel for pixel. There are no tiles and no enlargement.

Scan result: `report.json` reports `status: generated`, `qualified: true`, all ten checks passing (source, normalized, before-AI, half-scale, JPEG-80, poster, poster half-scale, poster JPEG-80, protected pixels, QR pixels). Phone scanning is untested.

Visual result: failed, and this verdict is separate from the passing scan. The fill region came back as a solid black blob — 94.8% black and 2.9% white pixels inside the region, against 41–50% black and 20–48% white in the earlier cell-like trials. No rounded cells and no even density were generated; the model echoed the input poster instead of repainting the selection. Repeated tiles, enlarged fragments, and extra markers cannot be judged because no cells were produced. A retry needs approval.

## Change of plan: offline pattern preview (2026-09-15)

The Qwen fill is set aside. Instead of asking the model for cells, the pattern is generated locally from a random text line with the encoder behind qrcode.antfu.me, then examined on its own before anything is composited onto the poster.

What the toolkit actually does, checked against `antfu/qrcode-toolkit` v1.4.4:

- `logic/generate.ts` calls `uqr`'s `encode(text, { minVersion, maxVersion, ecc, maskPattern, boostEcc, border: 0 })` and draws the margin itself.
- Defaults are `ecc: 'M'`, `margin: 2`, `scale: 20`, `pixelStyle: 'rounded'`, `markerStyle: 'auto'`, `markerShape: 'square'`, `maskPattern: -1`, `renderPointsType: 'all'`.
- Finder modules are typed `QrCodeDataType.Position` (a 9×9 chebyshev area including the separator), alignment modules `Alignment` (5×5), plus `Timing` and `Function` cells. Dropping `Position` and `Alignment` is therefore exactly "remove the marker".
- A dark module is drawn as an inscribed circle plus corner wedges toward dark edge neighbours; a light module adds a dark wedge only when both edge neighbours and the diagonal are dark. Wedge geometry is the corner triangle clipped by an arc of radius `cell / 2 + 2` bulging toward the corner.

What was implemented (`src/pattern.ts`, `--pattern-preview`):

- Pitch defaults to the module size the pipeline places on the poster, so the texture matches the real QR; `--module-pixels` overrides it.
- The smallest version whose modules plus the 2-module margin cover the canvas is selected, rendered at that pitch, then center-cropped to the poster canvas at whole-module offsets. With 688×566 and a 5px pitch that is version 30: 137 modules, 141 with the margin, a 705px code and a 10px/70px crop. `--module-pixels 20` gives version 4 instead.
- The text is a seeded random string of lowercase letters and digits sized to the version's byte capacity, so the data field has no repeating pad codewords (1370 characters at version 30, 62 at version 4).
- The dropped marker cells are refilled with seeded random bits drawn from their own stream (`seed ^ 0x9e3779b9`), so a seed still reproduces the whole texture. Forcing them light punched 9×9 finder and 5×5 alignment white holes into the field; the refill keeps the density even (1017 cells at version 30).
- Geometry was validated against the reference: rendering the fixture's own module grid reproduces `test/fixtures/qr.png` with 0.008% deep pixel mismatches once the marker and alignment cells are excluded; the rest are antialiased edge pixels. Corner arc sweep flags are `tl=1, tr=0, bl=0, br=1`.
- Output is a single `pattern.png` at the poster size (688×566) plus `report.json` (schema version 3). Nothing is composited onto the poster and no API call is made; the image is deliberately undecodable, and the scannable QR still comes from the existing placement pipeline.

Run:

```bash
pnpm qr-poster -- --pattern-preview --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/pattern-preview --seed 1
pnpm qr-poster -- --pattern-preview --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/pattern-preview-chunky --module-pixels 20
```

Checks in `test/pattern-preview.test.ts`: version/pitch selection including the unreachable-pitch error, pixel fidelity against the reference QR, isolated-versus-connected cell shapes, seeded marker refill with timing cells retained and no white holes in the marker areas, seeded text reproducibility, a decode round trip with markers kept, and a poster-sized deterministic preview that refuses to overwrite without `--force`.

## Pattern cut (2026-09-15)

The preview texture is deliberately undecodable and poster-sized, so it needs a shape before it can be used. `--pattern-cut` cuts it with a mask and does the cutting in SVG, which is what lets the cut edge be round instead of a pixel staircase.

Inputs are two same-size PNGs: the pattern to cut and a mask. The mask follows the edit-mask convention — a pixel is inside the cut shape when it is transparent or dark — so `output/qwen-fresh/edit-mask.png` (opaque white outside the editable area, transparent inside) and `region-mask.png` (white on black) both work unchanged. `--content` is not accepted in this mode; the existing `--mask` flag keeps its white-is-region meaning and is untouched.

Pipeline (`src/pattern-cut.ts`, `--pattern-cut`):

- The selection's boundary is traced as directed half-edges along pixel borders, keeping the selected pixels on the right, so outer boundaries come out with negative shoelace area and holes positive. At a diagonal pinch the walk prefers the sharpest turn, which keeps two diagonally touching regions as separate rings instead of merging them into a figure eight.
- Straight runs collapse to corners, then each closed ring is simplified with Douglas-Peucker. Closed rings are split at the vertex farthest from the first point before simplifying, because an open-run simplifier collapses a ring whose start and end coincide.
- Every corner is filleted: the tangent distance is capped at half of each neighbouring edge and the arc radius is recomputed from the capped tangent, so arcs on narrow features cannot overlap. Sweep direction comes from the cross product, which rounds concave corners — such as the inside of the QR-box hole — the same way as convex ones. Near-straight corners pass through unrounded.
- Rings smaller than the fillet area (radius², at least 4px²) are dropped as specks and counted in the report.
- `pattern-cut.svg` is self-contained: the pattern is embedded as a base64 data URI inside `<image>` under a `clipPath` holding just the traced path, so the file opens anywhere and the cut edge stays vector.
- `pattern-cut.png` rasterizes only the path and applies it as the alpha channel of the untouched pattern pixels, so no source pixel is resampled.

Measured on the real pair (`output/pattern-preview-1/pattern.png` cut with `output/qwen-fresh/edit-mask.png`, seed 1, 5px pitch):

- 23 rings traced, 3,870 vertices, 196 vertices after simplification, 2 rings kept, 1 hole, and 21 pixel-jagged specks dropped; the kept rings are the blob (125,556px²) and its 205×205 QR hole (42,025px²), area 83,531px² inside bounds 169,104 379×420.
- The fillet clamps on features narrower than twice the radius, which the real outlined blob does, so the report warns instead of failing.
- The PNG is 304,907 fully transparent pixels, 82,527 fully opaque, and 1,974 antialiased edge pixels, with zero mismatches against the source pattern among fully opaque pixels. Rendering the SVG file itself reproduces the same picture at 688×566.
- Smoothing erases features narrower than about twice its tolerance (a 3px bar cannot survive the default 3px tolerance), which is why the error message points at `--cut-smooth` and `--cut-radius`.

Run:

```bash
pnpm qr-poster -- --pattern-cut --input output/pattern-preview/pattern.png --cut-mask output/qwen-fresh/edit-mask.png --out-dir output/pattern-cut
```

Checks in `test/pattern-cut.test.ts`: a rectangle becoming one ring of four arcs, a hole staying a second even-odd subpath, both mask conventions selecting the same pixels, speck dropping, clamped fillets on narrow bars, both mask errors, deterministic SVG and PNG hashes, artifact protection, and a fixture-driven run asserting the loop counts above plus bit-exact interior pixels. `test/cli.test.ts` covers the mode flags through the documented `-- <mode>` path and skips itself where the environment refuses to spawn child processes.

## Assembly (2026-09-15)

With the texture and the cut both working offline, the poster itself can be finished without Qwen. `--assemble` is one run from the poster plus one line of content to a verified `poster.png`.

Order of work (`src/assemble.ts`, `--assemble`):

1. `resolveLayout()` (shared with `--dry-run` and `--pattern-preview`) loads the poster, generates and decodes the QR content, builds the region mask, inspects the QR profile, places it, and normalizes it. Sharing this keeps assembly from writing dry-run artifacts first and keeps the modes from drifting apart. Legacy library calls may still provide `qrPath` with optional `expectedText`, but the CLI exposes only `--content`.
2. `buildPosterPattern()` returns the marker-free matrix and the crop window at the placed pitch; the mode deliberately has no `--module-pixels`, because the texture pitch must equal the QR pitch or the seam between them shows. The crop is phase-locked to the placement (`offset + phase` a whole number of modules) so the matrix cells and the QR share one lattice. The fillet then drawn over a pixel-traced outline, the 20px border, and the rounded plate are all superseded by the module-level cut — see "Module-level cut for assembly" below.
3. The painted region is sampled on that lattice: a module is safe when its whole pixel block is on the canvas and every pixel of it is inside the mask. The drawn set is the safe modules minus the plate hole, the outer four rings of it are forced dark as the rim, and the composite writes whole modules only, so partly covered modules keep the original artwork.
4. The normalized QR keeps **one** quiet-zone module: the 39-module plate (185px code grid plus a 5px margin) is copied verbatim from the normalized image's 5,5 corner to 254,206, its four corner modules excepted. `--qr-margin` can make that band a fraction of a module instead, which is painted at pixel precision — see "A fractional QR margin" below. The poster is then verified with geometry only — `sourceQr`, `normalizedQr`, `outsideRegionPixels`, `qrPixels`, `qrPlateCorners`, `moduleCut`, `alphaPreserved` — while `poster`, `posterHalfScale`, and `posterJpeg80` are recorded in `verification.skippedChecks`.

Run:

```bash
pnpm qr-poster -- --assemble --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/assemble --seed 1 --force
```

Measured: region 125,497px (auto), QR version 5 at 5px/module in box 249,201,205 drawn on the 195×195 plate at 254,206 (1 quiet-zone module kept, crop 5/5/195), pattern version 30 at seed 1 cropped at 11/69 with a residual alignment phase of 0/0, a 137×113 lattice with 4,778 safe modules, 451 dropped partial modules (6,047 region pixels) and 3,261 drawn modules of which 1,316 are rim and 1,945 texture, all seven checks passing. Artifacts are `poster.png`, `pattern-cut.png`, `pattern-cut.svg`, `region-mask.png`, `qr.png`, and a schema-7 `report.json`. Pixel counts: zero transparent pixels (the earlier three-command route left 552 fully transparent and 1,006 partial-alpha pixels), zero alpha differences against the source poster, zero changed pixels outside the region or outside drawn modules, zero trimmed drawn cells at the default margin, and zero plate-window mismatches.

### Why the margin was one module, and what it costs

The tight QR is the point of this iteration: the white square around the code made it read as a pasted block instead of part of the artwork. The first cut took the whole quiet zone, which made the poster unscannable at every scale. Keeping one module (5px, exactly one texture cell) kept the code separated from the texture without the wide white square, so the assembly measures each margin by rebuilding the poster and decoding it. That one-module rule is history now — a fractional margin is available and is the default — but the measurement method it introduced is what sets the current margin:

| Light margin | Full size | 50% | JPEG-80 |
| --- | --- | --- | --- |
| 2 modules (source profile) | decodes | decodes | decodes |
| 1 module, square window | decodes | decodes | decodes |
| 1 module, module plate with its corner modules handed back (current default) | decodes | decodes | decodes |
| 0.4 module = 2px (`--qr-margin 0.4`, pixel-tight) | decodes | decodes | decodes |
| 0.2 module = 1px (`--qr-margin 0.2`, pixel-tight) | decodes | fails | decodes |
| 0 modules, whole-module hole at the code grid | fails | fails | fails |

One module — half of what the profile specifies — is the default, so the poster still is not decode-verified: the local `ZXing`/`jsQR` pass only shows what this clean 688×566 render survives, not what a phone camera will, which is why `phoneScan` stays `untested` and the decode checks stay in `verification.skippedChecks`. The fractional rows above are the pixel-tight opt-in described next; 0.4 (2px) is the tightest of those that still passes all three scales, and the run warns whenever the effective margin is under 2px.

### A fractional QR margin (2026-09-15)

One module of white around a 5px code reads as a wide, pasted border, so `--qr-margin` accepts a fraction; the plate then has to be painted at pixel precision, and that is a deliberate trade rather than a free win:

- The light band around the code is a row of whole modules, so it is quantized by the pitch: one module is the tightest margin that is also module-level, and zero (a module-aligned hole at the code grid) removes the quiet zone and fails to decode at every scale, which is why `--qr-margin 0` is rejected rather than rounded away. That is why the default stays at one module: at a whole-module margin the plate window is lattice-aligned, the hole is whole modules, and every drawn cell survives into the poster untouched (measured: 3,261 of 3,261).
- A fractional margin, e.g. `--qr-margin 0.2` (1px at this pitch), sets `marginPixels = max(1, round(margin × pitch))` and paints the plate window at pixel precision. The window is the placement box inset by `QUIET_ZONE_MODULES × pitch − marginPixels` — 187×187 at 258,210, a 9/9 crop of the normalized QR — and `computePlateModules()` drops the modules it covers in full (1,369) while the modules it partly covers stay drawn and are painted over by the plate. That trims the plate's margin off the neighbouring cells (73 cells lose their inner pixel at 1px, and 2px at `--qr-margin 0.4`), which the report warns about by name.
- Both paths share one implementation: the plate is painted where the window is and not where a handed-back corner module is, so a lattice-aligned window is exactly the hole and a fractional window reaches into the neighbouring cells. `qrPlate.path` records which happened (`module-window` or `pixel-window`), `qrPlate.marginPixels` records the effective band, `moduleCut` allows a changed pixel in the plate window as well as in a drawn module, and `qrPlateCorners` still asserts the handed-back corner pixels are bit-exact texture.
- Report: `qrPlate` gains `marginPixels`, `marginModules` is the requested value, `qr.overlay.quietZoneModules` reports the same, and the run warns when `marginPixels < 2` (full size and JPEG-80 decode, half scale does not) and whenever the margin is fractional (cells along the plate edge are trimmed).

Measured on the bundled fixtures at the default: 195px window, 1,517-module hole, 100 corner texture pixels, 3,261 drawn modules (1,945 texture + 1,316 rim), no trimmed cell, and local decoding at all three scales. `--qr-margin 0.2` gives 187px, a 1,369-module hole, 4 corner pixels, 3,409 drawn modules of which 73 are trimmed, and decoding at full size and JPEG-80 only; `--qr-margin 0.4` (2px) trims 2px per cell but keeps all three scales. `test/assemble.test.ts` asserts the default, the whole-cell guarantee and the 0.2 case, and `test/module-cut.test.ts` covers the off-lattice window.

### Legacy library QR inputs that are tight crops

`source/qr.png` is the same code as `test/fixtures/qr.png` cropped to the code grid — 740px at 20px/module with an uneven 8/5/5/3px margin — so it never matched the square, two-module quiet-zone profile. Instead of rejecting it, the profile check now falls back to recovering the code grid (`src/qr.ts`, `resolveQrSource`):

- The ink bounding box is measured, then an integer pitch is fitted per version (`N · pitch` within two pixels of the box, window containing every ink pixel).
- The origin is refined over ±2px by minimizing the mean per-module luma variance through integral images. The decoded version wins when a grid of that size fits, because the version comes from the decoded content.
- The grid is copied 1:1 onto a fresh two-module white margin at its native scale, and `quietZoneSource: "added"` with the trimmed margins is recorded in the report. The rebuilt 820×820 image equals `test/fixtures/qr.png` pixel for pixel, and both inputs produce byte-identical posters.

This path remains available to programmatic callers through `qrPath`; the CLI now requires `--content`. The strict profile still comes first, so conforming library inputs behave exactly as before and their reports gain no fields. A crop that cannot be fitted to any grid (for example 745×741 taken at a non-grid offset) is rejected with `QR_INVALID`, and a wrong grid is caught downstream by the decode checks.

### Checks added

`test/qr-source.test.ts` covers generated ASCII, URL, and Unicode content, invalid and ambiguous sources, the untouched conforming legacy input, the trimmed `source/qr.png` rebuild, and the rejected non-grid crop. `test/module-cut.test.ts` covers the lattice phase and module geometry. `test/assemble.test.ts` asserts the schema-7 report, whole-cell guarantees, plate behavior, decoding evidence, seed reproducibility, and legacy source equivalence. `test/cli.test.ts` covers required content, removed flags, generated dry-run/preview/assembly paths, and mode-specific option rejection.

## Rounded QR plate (2026-09-15) — assembly superseded by the module-level cut

Kept for the record and still current for `--pattern-cut`, which traces and fillets a mask on its own. The assembly path no longer rounds a traced outline: see "Module-level cut for assembly (2026-09-15)".

The first assembly cut the texture only to the painted region and then stamped the QR over it as a hard square, so four straight edges sliced the texture mid-cell — visible on the bundled poster as a pasted white block with square corners sitting in a field of rounded cells. The plate fixes that: the QR window is the cut's one hole, so the pattern and the written cut layer end on a rounded edge and the texture wraps the corners.

- Geometry (`src/assemble.ts`): the plate is the same window as before — the placement box inset by one module per side, 195×195 at 254,206 on the bundled poster, one quiet-zone module around the 185px code grid — and its corners are rounded by the effective `--cut-radius`, so one knob gives the region silhouette and the plate the same weight. `buildQrPlatePath()` writes an analytic rounded rectangle (four lines and four arcs, clamped to half the window); at a radius below 0.01 it emits the plain rectangle, which is how `--cut-radius 0` writes the old square window back. The placement box is validated to sit inside the mask, so the plate never reaches the silhouette or its border band.
- Cut path: the plate subpath is appended to the traced region path and the existing `fill-rule="evenodd"` turns it into a hole, so `renderCutCoverage`, the written `pattern-cut.png` alpha, and the `pattern-cut.svg` clip all carry the same rounded hole without new tracing code. The mask is cleaned, traced, simplified, and filleted exactly as before; `borderCoverage` and the SVG border stroke still render from the region-only path, so no black band follows the plate.
- Composite: the texture and the white plate are mixed by their coverages before being blended over the original pixels, because blending two complementary layers one after the other leaks the artwork underneath along the shared seam (up to 25% of a pixel at half coverage). The QR is copied only where the plate is fully opaque, so the window's corner cells keep the texture the cut wrote; the antialiased arc pixels stay a partial blend and are neither. The outside-region and alpha guarantees are untouched.
- Report (schema 6): a `qrPlate` block records the margin modules, radius, `rounded-rect` path, box, and `cornerTexturePixels`; `shape.holes` counts the plate (1 here) and `shape.area` becomes the net path area, the traced region minus the plate. The new `qrPlateCorners` check asserts the corner pixels are bit-exact texture rather than merely present, so the rounding cannot silently stop happening.
- Measured on the bundled fixtures: plate 195×195 with 10px corners at 254,206, 56 corner pixels handed back to the texture, cut area 89,443px² (127,383px² traced minus the 37,939px² plate), 1 loop, 1 hole, and all six geometry checks passing. `cornerTexturePixels` tracks the radius: 0 at `--cut-radius 0`, 4 at 4, 12 at 5, 56 at the 10px default (two modules).

The rounding eats into the quiet zone diagonally: along the arc the light margin next to the code's corner module narrows from 5px to about 2px, which is where the flag below was the real risk. Measured by rebuilding the poster at radius 0, 5, and 10 and decoding each at full size, 50%, and JPEG-80 (`ZXing`, falling back to `jsQR`): all three radii decode at all three scales, and the default radius adds no failure. The margin is still one module rather than the profile's two, and the corners now cut further into it, so the poster stays deliberately unverified — `phoneScan` remains `untested` and the three decode checks stay in `verification.skippedChecks`; the decode test in `test/assemble.test.ts` is local-decoder evidence of the three scales, not a qualification.

## Module-level cut for assembly (2026-09-15)

The filleted assembly cut was pixel geometry over a module field: it cleaned and traced the mask at pixel resolution, so the rim and the texture edge crossed cells mid-module, and the drawn area was a smooth outline rather than something the QR lattice could explain. The workflow is now the one the field implies — QR generator, module matrix, painted-region mask, safe-area calculation, draw full modules — and every drawn edge in the assembled poster, the written `pattern-cut.png`, and the `pattern-cut.svg` clip lands on a module boundary.

Order of work (`src/module-cut.ts`, `src/assemble.ts`):

1. `buildPosterPattern()` returns the marker-free matrix, the version, and the crop window; `renderRoundedPattern()` gained an `include` predicate that emits only the accepted modules, each with its own white cell (no full-canvas background rect) and with rejected modules counted as light when wedge neighbours resolve, so the drawn area is a union of whole modules whose edge closes on the silhouette. Without `include` the renderer is byte-identical to `--pattern-preview`.
2. `buildModuleLattice()` reduces the placement origin to a phase inside one module; cell (column, row) covers one pitch-sized block. `computeSafeArea()` marks a module safe only when its whole block is on the canvas and every pixel of it is inside the mask; a partly covered module is dropped and counted with the region pixels it keeps.
3. `computePlateModules()` marks the placement box inset by one module as whole cells and hands its four corner modules back to the texture (`--cut-radius 0` keeps them, 1,521 hole modules instead of 1,517). `computeRimModules()` takes the Chebyshev distance to the nearest unsafe module — the plate never seeds — and marks the outer four rings; those cells are forced dark in a copy of the matrix, which is the module-level replacement for the 20px stroke and the reason no black band follows the plate.
4. `buildModulePath()` writes the union of the drawn cells as `M x y h p v p h -p Z` rectangles and `renderModuleCoverage()` rasterizes it. Because every edge is an integer pixel, the coverage is strictly binary (0 or 255, asserted) and the composite needs no antialiased blending: drawn modules take the texture's pixels, everything else keeps the original poster byte for byte.
5. Verification adds `moduleCut` next to the existing checks: a pixel may differ from the original only inside a drawn module or the plate hole, and `qrPlateCorners` now asserts the four corner modules are bit-exact texture. `--cut-smooth` is rejected with exit 2 because there is no traced outline left to simplify, and a layout with no texture module left after the rim and plate is rejected with `QR_LAYOUT_INVALID` (exit 2).

The phase lock had to be corrected for this to mean anything. A module boundary sits at `k · pitch − offset`, so the window is locked when `offset + phase` is a whole number of modules; the earlier code asked for `offset ≡ phase`, which on the bundled poster produced crop 9/71 — two pixels off the QR lattice, i.e. every drawn cell sliced. The window is now crop 11/69 with a residual phase of 0/0. `centeredCrop()` also falls back more carefully (it searches every integer offset that keeps the phase, since only the phase, not the crop, must be a multiple of the pitch) and `selectPatternVersion()` takes a headroom parameter so an aligned render asks for one module of freedom: a canvas the tightest version would fill exactly can still phase-lock instead of failing or silently dropping to a non-aligned offset. `--pattern-preview` passes no `alignTo`, so its version, crop, and bytes are unchanged.

Measured on the bundled fixtures (`--seed 1`): region 125,497px, QR version 5 at 5px/module, a 137×113 lattice from (249,201) at phase 4/1, 4,778 safe modules, 451 dropped partial modules (6,047 region pixels kept as artwork), 1,517 plate hole modules, 3,261 drawn modules (1,316 rim + 1,945 texture, 81,525px), 100 corner texture pixels, and all seven checks passing. The mask's own edge is now visible as artwork, so the drawn area is about 4.8% smaller than the region: that is the price of never slicing a cell, and it is what makes the field read as QR cells rather than a cut image.

Decode evidence, measured by rebuilding the poster and decoding at three scales (`ZXing`, falling back to `jsQR`): the module plate with its corner modules handed back decodes at full size, 50% and JPEG-80, exactly like the rounded plate it replaced. The margin is still half the profile's two modules, so the poster stays deliberately unverified — `phoneScan` remains `untested` and the three decode checks stay in `verification.skippedChecks`.
