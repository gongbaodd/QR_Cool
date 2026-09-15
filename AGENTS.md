# AGENTS.md

Local TypeScript CLI (`qr-poster`) for artistic QR posters. Six modes: `--dry-run` prepares the layout, `--generate` fills the painted region with Qwen, `--generated-image` recomposes saved artwork, `--pattern-preview` renders an offline marker-free QR texture, `--pattern-cut` cuts that texture to a mask as a filleted SVG path plus a transparent PNG, and `--assemble` samples that texture on the QR module lattice, draws only the modules the painted region covers in full, composites them onto the poster, and overlays the QR code grid with a one-module light band beside each finder marker and no Qwen call.

## Commands

- `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass before handing off.
- `pnpm qr-poster -- <mode> --input <poster.png> --qr <qr.png> --out-dir <dir>`; exactly one mode flag per run. `--pattern-cut` takes `--cut-mask <mask.png>` and needs no `--qr`.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules). `source/qr.png` is 753x748: the same code grid with an uneven 8/5/5/3px margin, accepted by rebuilding its two-module quiet zone.

## Invariants

- Inputs are PNG only. The QR input should match the qrcode.antfu.me profile: square, 2 quiet-zone modules, integer module scaling. A tight code-grid crop is also accepted when its modules are an integer number of pixels: the grid is located, copied 1:1, and re-padded with a fresh two-module margin. Crops that do not sit on that grid are rejected.
- Pixels outside the painted region, pixels in modules the region covers only in part, and pixels inside the placed QR stay bit-exact. Verification failures exit 4, API/image errors 3, invalid arguments 2.
- The painted region is auto-detected from the dense central black shape; `--mask` overrides detection and `--qr-box` pins the protected box.
- Tests never make paid calls: mock API responses, use local fixtures.
- Qwen calls are paid, single-shot, five-minute timeout, no automatic retries, and need approval before spending one. `.env` loads only for `--generate`; credentials never appear in reports.
- `output/` and `dist/` are gitignored run products; reports keep their schema versions (1 dry-run, 2 generation, 3 pattern preview, 4 pattern cut, 8 assembly).

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges (corner triangle clipped by an arc of radius `pitch / 2 + 2`) toward dark edge neighbours, with inner-corner fills on light modules. Arc sweeps are `tl=1, tr=0, bl=0, br=1`, validated against `test/fixtures/qr.png` (0.008% deep pixel mismatch; residuals are antialiasing).
- Pitch defaults to the pitch the placement pipeline uses. The version is the smallest whose modules plus margin cover the canvas, the code is center-cropped at whole-module offsets, and cells are never scaled. At a 5px pitch that is version 30 (705px code, crop 10/70, 1370-character random line); at 20px it is version 4 (62 characters).
- The random text is seeded lowercase-plus-digits sized to the version's byte capacity so no repeating pad codewords appear; the same seed reproduces identical bytes.
- `--pattern-preview` writes only `pattern.png` and a schema-3 `report.json`, composites nothing onto the poster, and is deliberately undecodable; the scannable QR always comes from the placement pipeline.
- `--pattern-cut` treats a mask pixel as selected when it is transparent or dark, traces the outline into a vector path with `--cut-radius` fillets and `--cut-smooth` smoothing, retains a complete 20px black band inside the letter outline, and writes only `pattern-cut.svg`, `pattern-cut.png`, and a schema-4 `report.json`. Pattern pixels beyond the border stay bit-exact; the SVG embeds the pattern as a data URI.

## Assembly

- `--assemble` is the offline end-to-end mode and follows one workflow: QR generator -> module matrix -> region ("B") mask -> safe-area calculation -> draw full modules. It resolves the layout exactly like `--dry-run`, builds the marker-free module matrix, samples the mask on the placed QR's lattice, keeps only the modules the mask covers in full, draws those whole modules over the original pixels, cuts the QR plate out as a module hole, draws the normalized QR inside it, verifies, and writes `poster.png`, `pattern-cut.png`, `pattern-cut.svg`, `region-mask.png`, `qr.png`, and a schema-8 `report.json`.
- A module is safe only when its whole `pitch x pitch` block is on the canvas and every pixel of it is inside the detected or supplied region; a partially covered module is dropped and keeps the original artwork, so no drawn edge ever crosses a module. The four outer rings of drawn modules (Chebyshev distance <= 4 from the nearest unsafe module, the plate never seeding the rim) are forced dark cells, which is the module-level replacement for the old 20px border. `--cut-smooth` is rejected here with exit 2 because there is no traced outline left to simplify; `--pattern-cut` keeps the traced, filleted path.
- `--assemble` phase-locks the texture crop to the placement lattice (`offset + phase` a whole number of modules; the generator asks `selectPatternVersion` for one module of headroom so a tight canvas can still lock) and fails with exit 3 if the crop cannot land on it. The placed QR pitch is the only pitch, so `--module-pixels` stays exclusive to `--pattern-preview`.
- `--assemble` composites the normalized QR at a light band of `--qr-margin` modules beside each of the three finder markers, one by default: the plate is the 37-module code grid (222px at 230,193) plus the two 7-cell arms that run along each marker's outer edges, its cells are the cut's hole (1,411 after the three diagonal corner blocks are handed back to the texture, 108 pixels, or 1,414 with `--cut-radius 0`), no dark band follows it, and every drawn cell survives into the poster untouched. The quiet-zone cells along the rest of the code edge stay out of the plate, so they are drawn as texture and the margin there is zero. The band is a row of whole cells, so `--qr-margin` takes whole modules only: 1 or 2 (the profile's quiet zone), and `0`, a fraction, or more are rejected with exit 2. The band is half of the profile's two-module quiet zone and only the markers keep it, so the poster is deliberately not decode-verified: `sourceQr`, `normalizedQr`, `outsideRegionPixels`, `qrPixels`, `qrPlateCorners`, `moduleCut`, and `alphaPreserved` run, `poster`/`posterHalfScale`/`posterJpeg80` are listed in `verification.skippedChecks`, `phoneScan` stays `untested`, and warnings record the trade. Measured on the bundled poster: the default, `--cut-radius 0`, and `--qr-margin 2` all decode at full size, 50%, and JPEG-80.
- The written cut layer is the union of whole drawn modules and the composite touches nothing else, so the outside-region guarantee holds literally and the output never becomes transparent. The QR box is exactly the normalized QR, as in generation. A layout that leaves no texture module after the rim and the plate is rejected with `QR_LAYOUT_INVALID` (exit 2) instead of drawing a black slab.
- `--seed` (shared with `--pattern-preview`) makes the texture reproducible; the same seed reproduces identical bytes. `--qr-margin` (1 module by default) moves only the depth of the light band beside the markers, and every plate cell stays a whole module.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Docs

- Behavior changes update `README.md` and `doc/plan/artistic-qr-poster.md`.
