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
