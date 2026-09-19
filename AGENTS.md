# AGENTS.md

Web editor (Next.js) for artistic QR posters. Upload a PNG with a solid black region, enter one line of text or a URL, position the QR, and assemble a full-resolution poster: a seeded marker-free rounded-cell texture drawn only on whole modules fully inside the selected region, plus the exact QR on a module plate with a one-module light band beside each finder marker.

## Commands

- `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass before handing off.
- `pnpm dev` runs the editor locally; `pnpm start` serves the production build; `pnpm test:e2e` runs the Playwright browser journeys against it.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules).

## Invariants

- Inputs are PNG only (10 MiB, 4 megapixels, one frame). Masks must match the poster dimensions; white selects the region.
- Pixels outside the selected region, pixels in modules the region covers only in part, and pixels inside the placed QR stay bit-exact. Mandatory verification failures reject export.
- The painted region is auto-detected from the dense central black shape; an uploaded mask overrides detection.
- Tests never make paid calls: mock API responses, use local fixtures.
- No request invokes a CLI or writes temporary files. `output/` and `dist/` are gitignored run products; schema-8 assembly reports are preserved, with web revision and response metadata in a separate version-1 API envelope.
- The renderer lives in the `src/core/` engine modules; `src/server/` owns the stateless buffer services and HTTP adapters, `src/lib/editor/` holds schemas and reducer state, and `src/components/editor/` owns browser interaction.
- Component styles are StyleX: tokens and shared recipes in `src/styles/`, layout styles beside their component. `src/app/globals.css` holds only `@font-face`, the `@layer reset` block, and the `@stylex` slot that `babel.config.json` + `postcss.config.mjs` compile into.

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges toward dark edge neighbours, with inner-corner fills on light modules.
- The texture pitch always equals the placed QR pitch, the crop is phase-locked to its lattice, and the editor's stable seed makes the texture reproducible.
- A module is safe only when its whole `pitch x pitch` block is on the canvas and every pixel of it is inside the region; a partially covered module keeps the original artwork. The outer 0–5 rings of drawn modules are forced dark cells; a rounded rim is antialiased. The plate is the code grid plus finder-only light bands of one module.
- The poster is deliberately not decode-verified: `poster`/`posterHalfScale`/`posterJpeg80` are skipped checks, `phoneScan` stays `untested`, and the UI warns that artistic margins can affect scanning.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Docs

- Behavior changes update `README.md` and `doc/plan/web-qr-poster.md`. `doc/plan/artistic-qr-poster.md` is historical design context.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
