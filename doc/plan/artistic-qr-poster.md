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
pnpm qr-poster -- --generate --input source/poster.png --qr test/fixtures/qr.png --out-dir output/qwen-fresh
```

The QR input must be square and pass the existing module and decoding checks. The repository’s `source/qr.png` is 753×748 and is rejected by that check, so the samples use the square 820×820 `test/fixtures/qr.png`. `--dry-run` prepares the layout without a network call. `--generated-image <path>` reuses a saved result offline. API setup and other options are in README.md.

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

The current `source/qr.png` is 753×748 and fails the square-input check. It was left untouched. Tests and these samples use the original 820×820 QR, saved as `test/fixtures/qr.png`.

Previous trials enlarged the crop or repeated it as tiles. The reference now contains one unscaled crop on a plain white canvas. The prompt asks for new cells based only on the sample’s shape and size. No external image is used.

## Fresh-fill trial (2026-09-15)

Run: `pnpm qr-poster -- --generate --input source/poster.png --qr test/fixtures/qr.png --out-dir output/qwen-fresh`. One paid generation was made (request `0e18aab6-11b8-9208-b428-ff7ac6cd49da`). No retry was attempted and the mandated prompt sentence was not reworded.

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
pnpm qr-poster -- --pattern-preview --input source/poster.png --qr test/fixtures/qr.png --out-dir output/pattern-preview --seed 1
pnpm qr-poster -- --pattern-preview --input source/poster.png --qr test/fixtures/qr.png --out-dir output/pattern-preview-chunky --module-pixels 20
```

Checks in `test/pattern-preview.test.ts`: version/pitch selection including the unreachable-pitch error, pixel fidelity against the reference QR, isolated-versus-connected cell shapes, seeded marker refill with timing cells retained and no white holes in the marker areas, seeded text reproducibility, a decode round trip with markers kept, and a poster-sized deterministic preview that refuses to overwrite without `--force`.

## Pattern cut (2026-09-15)

The preview texture is deliberately undecodable and poster-sized, so it needs a shape before it can be used. `--pattern-cut` cuts it with a mask and does the cutting in SVG, which is what lets the cut edge be round instead of a pixel staircase.

Inputs are two same-size PNGs: the pattern to cut and a mask. The mask follows the edit-mask convention — a pixel is inside the cut shape when it is transparent or dark — so `output/qwen-fresh/edit-mask.png` (opaque white outside the editable area, transparent inside) and `region-mask.png` (white on black) both work unchanged. `--qr` is not required in this mode; the existing `--mask` flag keeps its white-is-region meaning and is untouched.

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
