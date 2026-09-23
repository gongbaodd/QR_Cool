# AGENTS.md

Web editor (Next.js) for artistic QR posters. Upload a PNG with a solid black region, enter one line of text or a URL, position the QR, and assemble a full-resolution poster: a seeded marker-free rounded-cell texture drawn only on whole modules fully inside the selected region, plus the exact QR on a module plate with a one-module light band beside each finder marker.

## Commands

- Run `pnpm test`, `pnpm typecheck`, and `pnpm build` only when the user explicitly asks for verification; the maintainer runs these checks manually between prompts.
- `pnpm dev` runs the editor locally; `pnpm start` serves the production build; `pnpm test:e2e` runs the Playwright browser journeys against it.
- Don't run `pnpm test:e2e` on every change. The maintainer exercises UI work manually in the browser, then asks for `e2e/editor.spec.ts` to be updated — update the journeys on request and only run that suite when asked.
- Poster fixture `source/poster.png` (688x566); QR fixture `test/fixtures/qr.png` (820x820, version 5, 41 total modules).

## Invariants

- Inputs are PNG only (10 MiB, 4 megapixels, one frame; guards run client-side in `src/lib/editor/png-guard.ts`). Masks must match the poster dimensions; white selects the region.
- Pixels outside the selected region, pixels in modules the region covers only in part, and pixels inside the placed QR stay bit-exact. Mandatory verification failures reject export.
- The painted region is auto-detected from the dense central black shape; an uploaded mask overrides detection.
- Tests never make paid calls: mock API responses, use local fixtures.
- No request invokes a CLI or writes temporary files. `output/` and `dist/` are gitignored run products; schema-8 assembly reports are preserved.
- The pipeline runs entirely client-side: `src/lib/editor/engine/` owns the renderer logic and runs in a session-owned Web Worker (`src/lib/editor/worker/`, Comlink) with a sha256 source cache and revision-based stale dropping; `src/core/` holds the shared rendering algorithms behind the imaging seam (`src/core/imaging/`: sharp = Node test backend, jSquash/resvg = browser); image artifacts cross the worker/UI boundary as Blobs with object-URL lifecycle managed in `useBlobUrls`. `src/lib/editor/store.ts` owns the per-editor Zustand session state and keeps the pure reducer transitions in `state.ts`; selectors derive readiness, while `src/components/editor/` owns browser interaction and runtime refs. The only server surface is the `GET /api/icons` proxy. There is no render API and no base64 image transport.
- Component styles are StyleX: tokens and shared recipes in `src/styles/`, layout styles beside their component. `src/app/globals.css` holds only `@font-face`, the `@layer reset` block, and the `@stylex` slot that `babel.config.json` + `postcss.config.mjs` compile into.

## QR pattern generation

- Encode with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults only: `ecc: 'M'`, `maskPattern: -1`, `border: 0`, and a locally drawn 2-module margin.
- "Remove the marker" means dropping `QrCodeDataType.Position` (finder patterns and their separators) and `Alignment`; keep `Timing` and `Function` cells. Dropped cells are refilled with seeded random modules, never left light.
- Rounded pixel style: one inscribed circle per dark module plus corner wedges toward dark edge neighbours, with inner-corner fills on light modules.
- The texture pitch always equals the placed QR pitch, the crop is phase-locked to its lattice, and the editor's stable seed makes the texture reproducible.
- A module is safe only when its whole `pitch x pitch` block is on the canvas and every pixel of it is inside the region; a partially covered module keeps the original artwork. The outer 0–5 rings of drawn modules are forced dark cells; a rounded rim is antialiased. The plate is the code grid plus finder-only light bands of one module.
- The poster is deliberately not decode-verified: `poster`/`posterHalfScale`/`posterJpeg80` are skipped checks, `phoneScan` stays `untested`, and the UI warns that artistic margins can affect scanning.
- Upstream reference: `antfu/qrcode-toolkit` `logic/generate.ts` and `unjs/uqr` (`encode`, `QrCodeDataType`).

## Skills

- Use the `modern-web-guidance` skill (via the skill tool) before any HTML/CSS or client-side JS work — including UI/layout, motion, performance (CWV), and Web API tasks — to check for modern best practices that may differ from training data.

## Docs

- Behavior changes update `README.md` and `doc/plan/web-qr-poster.md`. `doc/plan/artistic-qr-poster.md` is historical design context.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
