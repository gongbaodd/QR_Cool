# AGENTS.md

Local TypeScript CLI (`qr-poster`) for artistic QR posters. Four modes: `--dry-run` prepares the layout, `--generate` fills the painted region with Qwen, `--generated-image` recomposes saved artwork, `--pattern-preview` renders an offline marker-free QR texture.

## Commands

- `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass before handing off.
- `pnpm qr-poster -- <mode> --input <poster.png> --qr <qr.png> --out-dir <dir>`; exactly one mode flag per run.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules). `source/qr.png` is 753x748 and is rejected by the square/profile check.

## Invariants

- Inputs are PNG only. The QR input must be square and match the qrcode.antfu.me profile: 2 quiet-zone modules, integer module scaling.
- Pixels outside the painted region and pixels inside the placed QR stay bit-exact. Verification failures exit 4, API/image errors 3, invalid arguments 2.
- The painted region is auto-detected from the dense central black shape; `--mask` overrides detection and `--qr-box` pins the protected box.
- Tests never make paid calls: mock API responses, use local fixtures.
- Qwen calls are paid, single-shot, five-minute timeout, no automatic retries, and need approval before spending one. `.env` loads only for `--generate`; credentials never appear in reports.
- `output/` and `dist/` are gitignored run products; reports keep their schema versions (1 dry-run, 2 generation, 3 pattern preview).

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges (corner triangle clipped by an arc of radius `pitch / 2 + 2`) toward dark edge neighbours, with inner-corner fills on light modules. Arc sweeps are `tl=1, tr=0, bl=0, br=1`, validated against `test/fixtures/qr.png` (0.008% deep pixel mismatch; residuals are antialiasing).
- Pitch defaults to the pitch the placement pipeline uses. The version is the smallest whose modules plus margin cover the canvas, the code is center-cropped at whole-module offsets, and cells are never scaled. At a 5px pitch that is version 30 (705px code, crop 10/70, 1370-character random line); at 20px it is version 4 (62 characters).
- The random text is seeded lowercase-plus-digits sized to the version's byte capacity so no repeating pad codewords appear; the same seed reproduces identical bytes.
- `--pattern-preview` writes only `pattern.png` and a schema-3 `report.json`, composites nothing onto the poster, and is deliberately undecodable; the scannable QR always comes from the placement pipeline.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Docs

- Behavior changes update `README.md` and `doc/plan/artistic-qr-poster.md`.
