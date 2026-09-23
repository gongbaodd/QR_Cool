# Plan: Transparent background for the generated poster

Status: implemented; automated checks were added but not run under the repository's verification instructions.

## Scope and current behavior

The target is the poster made from the editor's **Blank canvas** starter. Its exported `poster.png` should have transparent pixels outside the drawn modules and QR plate. Inside each mask-selected texture module, keep the white background used by the markers' light areas. Uploaded posters retain their source artwork and alpha. The QR plate keeps its light modules opaque so its contrast and the existing QR pixel check remain valid.

The white background is introduced before `src/core`: `src/lib/editor/blank.ts` fills the starter poster RGBA buffer with 255, and `Editor.tsx` encodes it as a PNG. In `src/core/pattern.ts`, `renderPattern` then paints every included module white before painting dark cells. The upright and rotated branches of `src/core/assemble.ts` copy texture RGB into the output but preserve the source alpha, as required by the current `alphaPreserved` check. Changing only the PNG encoder or only the SVG background would therefore leave a white poster or invisible ink.

The standalone `qr.png` already converts light pixels to transparency in `transparentQrBackground`; do not change that path. `pattern-cut.png` already has transparent pixels outside its selected cut but currently contains opaque white light modules inside it. Treat the transparent blank export and its cut artifact consistently.

## Result contract

- Blank canvas remains 1000 × 1000 with a full-white selection mask. Its source PNG has alpha 0 at every pixel. The editing canvas already has a checkerboard; add one behind the result image so transparency is visible in both places.
- In a blank-canvas export, the full module backgrounds of mask-selected texture cells are opaque white, matching marker light areas. Pixels outside those cells and the QR plate remain transparent. Rounded and rotated module boundaries may have intermediate alpha. The QR plate remains opaque, including its light modules.
- In uploaded-poster exports, preserve today's pixels and alpha, including untouched pixels outside the selected region and modules covered only in part. Keep the current white/light decorative cells on those posters.
- Maintain the exact normalized QR pixels on the plate, whole-module placement rules, stable seed, schema-8 report, and rejection on mandatory verification failure.

## Implementation steps

1. **Carry source intent explicitly.** Change `buildBlankPosterRgba` in `src/lib/editor/blank.ts` to produce transparent RGBA, leaving `buildBlankMaskRgba` white. Mark this starter source as `transparentBlank` in editor state and pass the mode through `use-engine-request`, `src/lib/editor/engine/types.ts`, and the engine pipeline to `assembleResolved`. Do not infer the mode from a filename or from a few alpha samples; uploaded transparent PNGs must not accidentally switch rendering contracts. Keep the mode tied to the active source when a user uploads or replaces a poster.
2. **Render texture modules with marker-matched white.** Keep `renderPattern`'s white module background for blank-canvas assembly as well as generated QR input and uploaded-poster assembly. Only included safe modules get that background; canvas pixels outside them remain transparent. The standalone SVG raster path already preserves alpha, so do not flatten the assembled module window over a full white canvas.
3. **Composite RGBA in both assembly branches.** For drawn modules, combine texture alpha with module/rim coverage, then use source-over compositing on the output RGBA. Retain the plate's current exact four-channel copy from the opaque normalized QR. Build `pattern-cut.png` from the same module backgrounds, ink, and coverage so it matches the assembled layer; keep `pattern-cut.svg` aligned with that PNG. Use a shared pixel helper so upright and rotated paths agree on partial-alpha edges.
4. **Update verification.** Keep `outsideRegionPixels`, `moduleCut`, `qrPixels`, and plate-corner checks mandatory. For uploaded posters, retain the current full-canvas `alphaPreserved` rule. For the blank starter, verify that untouched pixels remain alpha 0, included texture modules have the expected coverage alpha (including their white backgrounds), and plate pixels equal the normalized QR. Give this mode-specific alpha check an honest name in `VerificationCheck` while preserving report schema 8 and existing check names for uploaded-poster reports.
5. **Show and document the result.** Add a checkerboard background behind the exported poster preview in `ResultPanel.tsx`; keep the image Blob shared with the download. Describe blank canvas transparency and the opaque QR plate in `README.md` and `doc/plan/web-qr-poster.md` when the behavior is implemented. Do not revise the historical `artistic-qr-poster.md`.

## Verification checkpoints

- Extend `test/blank.test.ts` to assert the starter PNG is transparent, its mask still selects the full canvas, and an assembled blank export has transparent outside pixels, opaque white texture module backgrounds, opaque QR light and dark plate pixels, and visible dark decorative ink. Inspect representative partially antialiased pixels for valid intermediate alpha.
- Cover square, dot, and rounded texture styles, both upright and rotated placements, in core/engine tests. Assert opaque white inside included modules, transparency outside them, `pattern-cut.png` matches the assembled texture geometry, and all mandatory checks qualify.
- Keep the uploaded `source/poster.png` fixture as a regression: decoded output pixels and alpha outside allowed writes remain exact, and Node/browser imaging parity stays within the existing antialiasing tolerance. Test an uploaded transparent PNG as an upload, not as the blank starter.
- Manually inspect preview and downloaded `poster.png` on a checkerboard and a dark background; scan the exported QR on a light background. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` only if explicitly requested, per `AGENTS.md`. Run `pnpm test:e2e` only on request.

## Risk to handle during implementation

The current blend updates RGB while leaving alpha untouched. Applying that formula to a transparent destination produces incorrect alpha. Source-over must calculate output alpha and unpremultiplied RGB together, especially at rounded rims and after rotation. The white background belongs inside included texture modules; applying it to the full canvas would remove the requested transparency outside the selected geometry. The plate's opaque light cells are intentional: making those transparent too would change scan contrast and the exact QR-pixel invariant.
