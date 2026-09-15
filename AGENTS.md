# AGENTS.md

Local TypeScript CLI (`qr-poster`) for artistic QR posters. Six modes: `--dry-run` prepares the layout, `--generate` fills the painted region with Qwen, `--generated-image` recomposes saved artwork, `--pattern-preview` renders an offline marker-free QR texture, `--pattern-cut` cuts that texture to a mask as a filleted SVG path plus a transparent PNG, and `--assemble` renders the texture on the QR lattice, rounds and borders the painted region, composites it onto the poster, and overlays the QR code grid with a one-module margin and no Qwen call.

## Commands

- `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass before handing off.
- `pnpm qr-poster -- <mode> --input <poster.png> --qr <qr.png> --out-dir <dir>`; exactly one mode flag per run. `--pattern-cut` takes `--cut-mask <mask.png>` and needs no `--qr`.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules). `source/qr.png` is 753x748: the same code grid with an uneven 8/5/5/3px margin, accepted by rebuilding its two-module quiet zone.

## Invariants

- Inputs are PNG only. The QR input should match the qrcode.antfu.me profile: square, 2 quiet-zone modules, integer module scaling. A tight code-grid crop is also accepted when its modules are an integer number of pixels: the grid is located, copied 1:1, and re-padded with a fresh two-module margin. Crops that do not sit on that grid are rejected.
- Pixels outside the painted region and pixels inside the placed QR stay bit-exact. Verification failures exit 4, API/image errors 3, invalid arguments 2.
- The painted region is auto-detected from the dense central black shape; `--mask` overrides detection and `--qr-box` pins the protected box.
- Tests never make paid calls: mock API responses, use local fixtures.
- Qwen calls are paid, single-shot, five-minute timeout, no automatic retries, and need approval before spending one. `.env` loads only for `--generate`; credentials never appear in reports.
- `output/` and `dist/` are gitignored run products; reports keep their schema versions (1 dry-run, 2 generation, 3 pattern preview, 4 pattern cut, 5 assembly).

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges (corner triangle clipped by an arc of radius `pitch / 2 + 2`) toward dark edge neighbours, with inner-corner fills on light modules. Arc sweeps are `tl=1, tr=0, bl=0, br=1`, validated against `test/fixtures/qr.png` (0.008% deep pixel mismatch; residuals are antialiasing).
- Pitch defaults to the pitch the placement pipeline uses. The version is the smallest whose modules plus margin cover the canvas, the code is center-cropped at whole-module offsets, and cells are never scaled. At a 5px pitch that is version 30 (705px code, crop 10/70, 1370-character random line); at 20px it is version 4 (62 characters).
- The random text is seeded lowercase-plus-digits sized to the version's byte capacity so no repeating pad codewords appear; the same seed reproduces identical bytes.
- `--pattern-preview` writes only `pattern.png` and a schema-3 `report.json`, composites nothing onto the poster, and is deliberately undecodable; the scannable QR always comes from the placement pipeline.
- `--pattern-cut` treats a mask pixel as selected when it is transparent or dark, traces the outline into a vector path with `--cut-radius` fillets and `--cut-smooth` smoothing, and writes only `pattern-cut.svg`, `pattern-cut.png`, and a schema-4 `report.json`. Pixels inside the cut stay bit-exact; the SVG embeds the pattern as a data URI.

## Assembly

- `--assemble` is the offline end-to-end mode: it resolves the layout exactly like `--dry-run`, renders the marker-free texture at the placed pitch, cuts it to the detected or supplied region with filleted corners minus the rounded QR plate, composites it over the original pixels, fills the plate white, draws the normalized QR inside it, verifies, and writes `poster.png`, `pattern-cut.png`, `pattern-cut.svg`, `region-mask.png`, `qr.png`, and a schema-6 `report.json`.
- `--assemble` cleans the region mask (disc closing then opening at one module), fillets with module-scaled defaults (`--cut-radius` two modules, `--cut-smooth` one module; `--pattern-cut` keeps 5/3), paints a four-module black border inside the cut edge, and phase-locks the texture crop to the placement so both share one module lattice. The composite stays clipped to the region mask, so the outside-region guarantee holds literally.
- `--assemble` composites the normalized QR with **one** quiet-zone module kept: the 39-module plate (37-module code grid plus a 5px margin) sits at the placed box, its corners are rounded by the same `--cut-radius` (two modules by default), and the dropped quiet-zone ring shows texture. The plate is an analytic rounded-rect subpath appended to the traced region path, so the even-odd fill makes it the one hole in the written cut and the corner arcs hand texture back to the pattern (56 window pixels at the default radius; `--cut-radius 0` writes the square window back); the QR is copied only where the plate is fully opaque, and no black band follows the plate. That is half the profile margin, so the poster is deliberately not decode-verified: `sourceQr`, `normalizedQr`, `outsideRegionPixels`, `qrPixels`, `qrPlateCorners`, and `alphaPreserved` run, `poster`/`posterHalfScale`/`posterJpeg80` are listed in `verification.skippedChecks`, `phoneScan` stays `untested`, and a warning records the trade. Measured on the bundled poster, a one-module margin still decodes at full size, 50% and JPEG-80 with the rounded plate, while the earlier zero-margin overlay decoded at no scale.
- The written cut layer is clipped to the painted region, and the antialiased cut edge is blended into the original pixels, so nothing outside the region changes and the output never becomes transparent. The QR box is exactly the normalized QR, as in generation.
- `--seed` (shared with `--pattern-preview`) makes the texture reproducible; `--cut-radius` and `--cut-smooth` (shared with `--pattern-cut`) shape the cut edge. The texture pitch is always the placed QR pitch, so `--module-pixels` stays exclusive to `--pattern-preview`.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Docs

- Behavior changes update `README.md` and `doc/plan/artistic-qr-poster.md`.
