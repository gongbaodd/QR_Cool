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
