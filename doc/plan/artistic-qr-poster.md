# QR pattern fill

Next product direction: [Web QR poster editor](web-qr-poster.md). That plan reuses the offline assembly engine and replaces the CLI after the web workflow passes its acceptance gates. The notes below describe the existing implementation and its history.

## Web wizard (2026-09-18)

The browser editor runs in four steps: 1 blank size (custom white canvas dimensions or poster upload), 2 mask or poster (detection plus optional mask/text mask), 3 adjust QR with the mask (content, placement, pattern settings, canvas), 4 generate (assemble, verify, download). No engine or report change.

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

The Qwen fill is set aside. Instead of asking the model for cells, the pattern is generated locally from a random text line with `uqr`, then examined on its own before anything is composited onto the poster.

The encoder and rendering behavior used for the pattern:

- `logic/generate.ts` calls `uqr`'s `encode(text, { minVersion, maxVersion, ecc, maskPattern, boostEcc, border: 0 })` and draws the margin itself.
- Defaults are `ecc: 'M'`, `margin: 2`, `scale: 20`, `pixelStyle: 'rounded'`, `markerStyle: 'auto'`, `markerShape: 'square'`, `maskPattern: -1`, `renderPointsType: 'all'`.
- Finder modules are typed `QrCodeDataType.Position` (a 9×9 chebyshev area including the separator), alignment modules `Alignment` (5×5), plus `Timing` and `Function` cells. Dropping `Position` and `Alignment` is therefore exactly "remove the marker".
- A dark module is drawn as an inscribed circle plus corner wedges toward dark edge neighbours; a light module adds a dark wedge only when both edge neighbours and the diagonal are dark. Wedge geometry is the corner triangle clipped by an arc of radius `cell / 2 + 2` bulging toward the corner.

What was implemented (`src/pattern.ts`, `--pattern-preview`):

- Pitch defaults to the module size the pipeline places on the poster, so the texture matches the real QR; `--module-pixels` overrides it.
- The smallest version whose modules plus the 2-module margin cover the canvas is selected, rendered at that pitch, then center-cropped to the poster canvas at whole-module offsets. With 688×566 and the bundled placement's 6px pitch that is version 24: 113 modules, 117 with the margin, a 702px code and a 6px/66px crop. `--module-pixels 20` gives version 4 instead.
- The text is a seeded random string of lowercase letters and digits sized to the version's byte capacity, so the data field has no repeating pad codewords (911 characters at version 24, 62 at version 4).
- The dropped marker cells are refilled with seeded random bits drawn from their own stream (`seed ^ 0x9e3779b9`), so a seed still reproduces the whole texture. Forcing them light punched 9×9 finder and 5×5 alignment white holes into the field; the refill keeps the density even (742 cells at version 24).
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
- `pattern-cut.svg` is self-contained: the pattern is embedded as a base64 data URI inside `<image>` under a `clipPath` holding the traced path, and a clipped 40px centered stroke retains a complete 20px black band inside the letter edge.
- `pattern-cut.png` rasterizes the same cut and inner border coverage. Pixels beyond the 20px border retain the source pattern exactly, while the border is composited black without resampling the source.

Measured by preparing and cutting the bundled poster and version-5 QR at seed 1 and the automatic 6px pitch:

- 22 rings traced, 4,030 vertices, 197 vertices after simplification, 1 ring kept, no enclosed hole, and 21 pixel-jagged specks dropped. The maximum 246×246 QR box reaches the region's right-hand notch, leaving a 64,975px² cut inside bounds 169,104 379×420.
- The fillet clamps on features narrower than twice the radius, which the real outlined blob does, so the report warns instead of failing.
- The PNG is 323,473 fully transparent pixels, 63,871 fully opaque, and 2,064 antialiased edge pixels, with zero mismatches against the source pattern among fully opaque pixels. Rendering the SVG file itself reproduces the same picture at 688×566.
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
   Automatic placement uses the largest integer module pitch whose complete QR square fits inside the mask, with no extra decorative-module reserve, and chooses the fitting square nearest the region centroid. A manual `--qr-box` remains available for a smaller composition.
2. `buildPosterPattern()` returns the marker-free matrix and the crop window at the placed pitch; the mode deliberately has no `--module-pixels`, because the texture pitch must equal the QR pitch or the seam between them shows. The crop is phase-locked to the placement (`offset + phase` a whole number of modules) so the matrix cells and the QR share one lattice. The fillet then drawn over a pixel-traced outline, the 20px border, and the rounded plate are all superseded by the module-level cut — see "Module-level cut for assembly" below.
3. The painted region is sampled on that lattice: a module is safe when its whole pixel block is on the canvas and every pixel of it is inside the mask. The drawn set is the safe modules minus the plate hole, the outer four rings of it are forced dark as the rim, and the composite writes whole modules only, so partly covered modules keep the original artwork.
4. The plate copies the normalized QR verbatim at its placement position: the 222px code grid at 230,193 plus a one-module light band beside each of the three finder markers, with the diagonal corner block beside each marker handed back to the texture. The quiet-zone cells along the rest of the code edge stay out of the plate, so they are drawn as texture and the margin there is zero — see "Why the light band is marker-only" below. The poster is then verified with geometry only — `sourceQr`, `normalizedQr`, `outsideRegionPixels`, `qrPixels`, `qrPlateCorners`, `moduleCut`, `alphaPreserved` — while `poster`, `posterHalfScale`, and `posterJpeg80` are recorded in `verification.skippedChecks`.

Run:

```bash
pnpm qr-poster -- --assemble --input source/poster.png --content 'https://www.instagram.com/grandpasbeehaven/' --out-dir output/assemble --seed 1 --force
```

Measured: region 125,497px (auto), QR version 5 at 6px/module in the maximum box 218,181,246 drawn on the 222px code grid at 230,193 (crop 12/12/222) with a 42-cell band beside the markers, pattern version 24 at seed 1 cropped at 4/65 with a residual alignment phase of 0/0, a 115×95 lattice with 3,284 safe modules, 367 dropped partial modules (7,273 region pixels) and 1,873 drawn modules of which 1,029 are rim and 844 texture, all seven checks passing. Artifacts are `poster.png`, `pattern-cut.png`, `pattern-cut.svg`, `region-mask.png`, `qr.png`, and a schema-8 `report.json`. Pixel counts remain zero for transparency, alpha differences against the source poster, changes outside the region or outside drawn modules or plate cells, trimmed drawn cells at the default band, and plate mismatches.

### Why the light band is marker-only (2026-09-15)

The tight QR is the point of this iteration: the white square around the code made it read as a pasted block instead of part of the artwork. Shrinking the quiet zone to one module around the whole code helped, and the fractional opt-in (`--qr-margin 0.4`, `0.2`) showed the code blending further, but the measurements said what the band really is: a row of whole cells. A fraction can only be painted at pixel precision, which trims the pixels off the neighbouring texture cells and costs the half-scale read (0.2 module = 1px decoded at full size and JPEG-80, not at 50%), while a module-aligned hole at the code grid failed at every scale.

The band is only needed where a decoder looks. Quiet zones exist for the finder patterns, and those sit at three of the code's corners, so the band is kept there and nowhere else:

- `computePlateModules()` now takes a list of plate rectangles plus a list of hand-back rectangles instead of one window, and returns the plate's cell bounds. Assembly builds the code-grid rectangle plus, per finder marker, the two 7-cell arms along its outer edges — the finder footprint; the separator inside the grid already carries its own light row and column — and the diagonal corner block that joins them.
- The code-grid rectangle is copied verbatim from the normalized QR at its placement position and the arms carry the QR's own quiet zone, so the plate is still a pure copy: no resampling anywhere, and every plate cell is a whole module on the lattice. The quiet-zone cells along the rest of the code edge stay out of the plate, so they are drawn as the texture and the margin there is zero.
- The corner block beside each marker is the part of the band a decoder does not need, so `--cut-radius` decides it: a positive radius (the default, two module pitches) hands the three blocks back to the texture, which keeps the plate's corners texture exactly the way the earlier rounded plate did; `--cut-radius 0` keeps them light, which makes the band a full L.
- `--qr-margin` is now the depth of that band in whole modules — 1 by default, capped at 2, the profile's quiet zone and the extent of the placement box. Zero, a fraction, and more than 2 are rejected with exit 2, because the band is a row of whole cells; the fractional pixel-window path (`qrPlate.path`, `marginPixels < 2` warnings) went with it.
- Report (schema 8): `qrPlate` records `band: "markers"`, the depth in modules and pixels, the 7-module finder footprint, the light cell count, the code-grid box, the hole modules, the hand-back modules, and `cornerTexturePixels`; `qr.overlay` records the code-grid crop and position plus the band depth; `cut.plateCornerModules` counts the hand-back modules (3 at the default).

Measured on the bundled poster (`--seed 1`, version 5 at 6px/module): the default band is 42 light cells in a 1,411-module hole with 3 corner blocks handed back (108px), and 1,873 drawn modules (1,029 rim + 844 texture). Decode evidence, measured by rebuilding the poster at each setting and decoding at three scales (`ZXing`, falling back to `jsQR`):

| Band                                                  | Hole              | Full size   | 50%         | JPEG-80     |
| ----------------------------------------------------- | ----------------- | ----------- | ----------- | ----------- |
| **1 module beside the markers (default)**             | **1,411**         | **decodes** | **decodes** | **decodes** |
| 1 module, corner blocks kept light (`--cut-radius 0`) | 1,414             | decodes     | decodes     | decodes     |
| 2 modules beside the markers (`--qr-margin 2`)        | 1,453             | decodes     | decodes     | decodes     |
| 0 modules, a fraction, or more than 2                 | rejected (exit 2) | —           | —           | —           |

Giving up the quiet zone along the rest of the code edge costs nothing the local decoder notices: the finder patterns are what it locks onto, and they keep their band at every setting. That is a local-decoder result on one clean 688×566 render, not a qualification, so `phoneScan` stays `untested`, the three decode checks stay in `verification.skippedChecks`, and the run warns about the trade instead. `test/assemble.test.ts` asserts the 42-cell band, the hand-back blocks, the texture flush against the rest of the code edge, the two-module band, the rejected values, and the decode evidence; `test/module-cut.test.ts` covers the rectangle union, the hand-back blocks, and rectangles that share edges or reach past the canvas.

### Legacy library QR inputs that are tight crops

`source/qr.png` is the same code as `test/fixtures/qr.png` cropped to the code grid — 740px at 20px/module with an uneven 8/5/5/3px margin — so it never matched the square, two-module quiet-zone profile. Instead of rejecting it, the profile check now falls back to recovering the code grid (`src/qr.ts`, `resolveQrSource`):

- The ink bounding box is measured, then an integer pitch is fitted per version (`N · pitch` within two pixels of the box, window containing every ink pixel).
- The origin is refined over ±2px by minimizing the mean per-module luma variance through integral images. The decoded version wins when a grid of that size fits, because the version comes from the decoded content.
- The grid is copied 1:1 onto a fresh two-module white margin at its native scale, and `quietZoneSource: "added"` with the trimmed margins is recorded in the report. The rebuilt 820×820 image equals `test/fixtures/qr.png` pixel for pixel, and both inputs produce byte-identical posters.

This path remains available to programmatic callers through `qrPath`; the CLI now requires `--content`. The strict profile still comes first, so conforming library inputs behave exactly as before and their reports gain no fields. A crop that cannot be fitted to any grid (for example 745×741 taken at a non-grid offset) is rejected with `QR_INVALID`, and a wrong grid is caught downstream by the decode checks.

### Checks added

`test/qr-source.test.ts` covers generated ASCII, URL, and Unicode content, invalid and ambiguous sources, the untouched conforming legacy input, the trimmed `source/qr.png` rebuild, and the rejected non-grid crop. `test/module-cut.test.ts` covers the lattice phase and module geometry. `test/assemble.test.ts` asserts the schema-8 report, whole-cell guarantees, plate behavior, decoding evidence, seed reproducibility, and legacy source equivalence. `test/cli.test.ts` covers required content, removed flags, generated dry-run/preview/assembly paths, and mode-specific option rejection.

## Rounded QR plate (2026-09-15) — assembly superseded by the module-level cut

Kept for the record and still current for `--pattern-cut`, which traces and fillets a mask on its own. The assembly path no longer rounds a traced outline: see "Module-level cut for assembly (2026-09-15)".

The first assembly cut the texture only to the painted region and then stamped the QR over it as a hard square, so four straight edges sliced the texture mid-cell — visible on the bundled poster as a pasted white block with square corners sitting in a field of rounded cells. The plate fixes that: the QR window is the cut's one hole, so the pattern and the written cut layer end on a rounded edge and the texture wraps the corners.

- Historical geometry at the then-current 5px placement: the plate was 195×195 at 254,206 with one quiet-zone module around the 185px code grid. `buildQrPlatePath()` wrote an analytic rounded rectangle; the module-level assembly described below has superseded this path.
- Cut path: the plate subpath is appended to the traced region path and the existing `fill-rule="evenodd"` turns it into a hole, so `renderCutCoverage`, the written `pattern-cut.png` alpha, and the `pattern-cut.svg` clip all carry the same rounded hole without new tracing code. The mask is cleaned, traced, simplified, and filleted exactly as before; `borderCoverage` and the SVG border stroke still render from the region-only path, so no black band follows the plate.
- Composite: the texture and the white plate are mixed by their coverages before being blended over the original pixels, because blending two complementary layers one after the other leaks the artwork underneath along the shared seam (up to 25% of a pixel at half coverage). The QR is copied only where the plate is fully opaque, so the window's corner cells keep the texture the cut wrote; the antialiased arc pixels stay a partial blend and are neither. The outside-region and alpha guarantees are untouched.
- Report (schema 6): a `qrPlate` block records the margin modules, radius, `rounded-rect` path, box, and `cornerTexturePixels`; `shape.holes` counts the plate (1 here) and `shape.area` becomes the net path area, the traced region minus the plate. The new `qrPlateCorners` check asserts the corner pixels are bit-exact texture rather than merely present, so the rounding cannot silently stop happening.
- Historical measurement at the 5px placement: plate 195×195 with 10px corners at 254,206, 56 corner pixels handed back to the texture, cut area 89,443px², 1 loop, 1 hole, and all six geometry checks passing.

The rounding eats into the quiet zone diagonally: along the arc the light margin next to the code's corner module narrows from 5px to about 2px, which is where the flag below was the real risk. Measured by rebuilding the poster at radius 0, 5, and 10 and decoding each at full size, 50%, and JPEG-80 (`ZXing`, falling back to `jsQR`): all three radii decode at all three scales, and the default radius adds no failure. The margin is still one module rather than the profile's two, and the corners now cut further into it, so the poster stays deliberately unverified — `phoneScan` remains `untested` and the three decode checks stay in `verification.skippedChecks`; the decode test in `test/assemble.test.ts` is local-decoder evidence of the three scales, not a qualification.

## Module-level cut for assembly (2026-09-15)

The filleted assembly cut was pixel geometry over a module field: it cleaned and traced the mask at pixel resolution, so the rim and the texture edge crossed cells mid-module, and the drawn area was a smooth outline rather than something the QR lattice could explain. The workflow is now the one the field implies — QR generator, module matrix, painted-region mask, safe-area calculation, draw full modules — and every drawn edge in the assembled poster, the written `pattern-cut.png`, and the `pattern-cut.svg` clip lands on a module boundary.

Order of work (`src/module-cut.ts`, `src/assemble.ts`):

1. `buildPosterPattern()` returns the marker-free matrix, the version, and the crop window; `renderRoundedPattern()` gained an `include` predicate that emits only the accepted modules, each with its own white cell (no full-canvas background rect) and with rejected modules counted as light when wedge neighbours resolve, so the drawn area is a union of whole modules whose edge closes on the silhouette. Without `include` the renderer is byte-identical to `--pattern-preview`.
2. `buildModuleLattice()` reduces the placement origin to a phase inside one module; cell (column, row) covers one pitch-sized block. `computeSafeArea()` marks a module safe only when its whole block is on the canvas and every pixel of it is inside the mask; a partly covered module is dropped and counted with the region pixels it keeps.
3. `computePlateModules()` marks the modules a plate rectangle covers in full as whole cells and hands its hand-back rectangles to the texture. At this iteration those were the placement box inset by one module and its four corner cells (`--cut-radius 0` kept them, 1,521 hole modules instead of 1,517); the geometry has since become the code grid plus the marker band described in "Why the light band is marker-only" below, on the same rectangle-list API. `computeRimModules()` takes the Chebyshev distance to the nearest unsafe module — the plate never seeds — and marks the outer four rings; those cells are forced dark in a copy of the matrix, which is the module-level replacement for the 20px stroke and the reason no black band follows the plate.
4. `buildModulePath()` writes the union of the drawn cells as `M x y h p v p h -p Z` rectangles and `renderModuleCoverage()` rasterizes it. Because every edge is an integer pixel, the coverage is strictly binary (0 or 255, asserted) and the composite needs no antialiased blending: drawn modules take the texture's pixels, everything else keeps the original poster byte for byte.
5. Verification adds `moduleCut` next to the existing checks: a pixel may differ from the original only inside a drawn module or a plate cell, and `qrPlateCorners` asserts the hand-back cells are bit-exact texture (four corner cells at that iteration, the three diagonal corner blocks now). `--cut-smooth` is rejected with exit 2 because there is no traced outline left to simplify, and a layout with no texture module left after the rim and plate is rejected with `QR_LAYOUT_INVALID` (exit 2).

The phase lock had to be corrected for this to mean anything. A module boundary sits at `k · pitch − offset`, so the window is locked when `offset + phase` is a whole number of modules. On the current bundled placement the aligned window is crop 4/65 with a residual phase of 0/0. `centeredCrop()` searches every integer offset that keeps the phase, since only the phase, not the crop, must be a multiple of the pitch, and `selectPatternVersion()` takes a headroom parameter so a canvas the tightest version would fill exactly can still phase-lock instead of failing or silently dropping to a non-aligned offset. `--pattern-preview` passes no `alignTo`, so its centered crop is 6/66.

Measured on the bundled fixtures at that iteration (`--seed 1`): region 125,497px, QR version 5 at 6px/module in box 218,181,246, a 115×95 lattice at phase 2/1, 3,284 safe modules, 367 dropped partial modules (7,273 region pixels kept as artwork), 1,517 plate hole modules, 1,767 drawn modules (1,008 rim + 759 texture, 63,612px), 144 corner texture pixels, and all seven checks passing. The marker-only band below leaves 1,411 hole modules and 1,873 drawn modules (1,029 rim + 844 texture); the unfilled mask edge is the price of never slicing a cell, while the maximum QR fills most of the central region.

Decode evidence, measured by rebuilding the poster and decoding at three scales (`ZXing`, falling back to `jsQR`): the module plate with its corner cells handed back decoded at full size, 50% and JPEG-80, exactly like the rounded plate it replaced, and the marker-only band that followed still decodes at all three (see the table above). The band is still half the profile's two modules, so the poster stays deliberately unverified — `phoneScan` remains `untested` and the three decode checks stay in `verification.skippedChecks`.
