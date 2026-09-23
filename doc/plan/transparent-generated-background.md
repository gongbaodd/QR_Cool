# Plan: Transparent background for the generated poster

Status: planned.

## Scope and current behavior

The target is the poster made from the editor's **Blank canvas** starter. Its exported `poster.png` should have transparent pixels wherever no QR or decorative ink is drawn. Uploaded posters retain their source artwork and alpha. The QR plate keeps its light modules opaque so its contrast and the existing QR pixel check remain valid.

The white background is introduced before `src/core`: `src/lib/editor/blank.ts` fills the starter poster RGBA buffer with 255, and `Editor.tsx` encodes it as a PNG. In `src/core/pattern.ts`, `renderPattern` then paints every included module white before painting dark cells. The upright and rotated branches of `src/core/assemble.ts` copy texture RGB into the output but preserve the source alpha, as required by the current `alphaPreserved` check. Changing only the PNG encoder or only the SVG background would therefore leave a white poster or invisible ink.

The standalone `qr.png` already converts light pixels to transparency in `transparentQrBackground`; do not change that path. `pattern-cut.png` already has transparent pixels outside its selected cut but currently contains opaque white light modules inside it. Treat the transparent blank export and its cut artifact consistently.

## Result contract

- Blank canvas remains 1000 × 1000 with a full-white selection mask. Its source PNG has alpha 0 at every pixel. The editing canvas already has a checkerboard; add one behind the result image so transparency is visible in both places.
- In a blank-canvas export, pixels outside the QR plate and dark decorative geometry have alpha 0. Dark ink and the QR plate have alpha determined by their raster coverage; finder light bands and the QR's own light modules remain opaque white. Rounded and rotated edges may have intermediate alpha.
- In uploaded-poster exports, preserve today's pixels and alpha, including untouched pixels outside the selected region and modules covered only in part. Keep the current white/light decorative cells on those posters unless a separate product decision changes them.
- Maintain the exact normalized QR pixels on the plate, whole-module placement rules, stable seed, schema-8 report, and rejection on mandatory verification failure.

## Implementation steps

1. **Carry source intent explicitly.** Change `buildBlankPosterRgba` in `src/lib/editor/blank.ts` to produce transparent RGBA, leaving `buildBlankMaskRgba` white. Mark this starter source as `transparentBlank` in editor state and pass the mode through `use-engine-request`, `src/lib/editor/engine/types.ts`, and the engine pipeline to `assembleResolved`. Do not infer the mode from a filename or from a few alpha samples; uploaded transparent PNGs must not accidentally switch rendering contracts. Keep the mode tied to the active source when a user uploads or replaces a poster.
2. **Render ink without a white sheet in this mode.** Add an explicit background choice to `renderPattern` in `src/core/pattern.ts`. The existing default stays white for generated QR input and uploaded-poster assembly. For the transparent blank, omit the white SVG background and do not request `flatten` from the imaging backend. Render black modules and their antialiased geometry into transparent RGBA. Keep light modules empty, including the texture's two-module margin. Both Sharp and browser/resvg backends should receive the same semantics.
3. **Composite RGBA in both assembly branches.** Pass the background choice into the upright and rotated texture render. For drawn modules, combine texture alpha with module/rim coverage, then use source-over compositing on the output RGBA. Do not set alpha to 255 merely because a module is included. Retain the plate's current exact four-channel copy from the opaque normalized QR. Build `pattern-cut.png` from the same ink and coverage so its light cells are transparent in this mode; keep `pattern-cut.svg` aligned with that PNG. Use a shared pixel helper if needed so upright and rotated paths agree on partial-alpha edges. Avoid an extra PNG post-processing pass that erases white by color, since legitimate light plate pixels would be lost.
4. **Update verification.** Keep `outsideRegionPixels`, `moduleCut`, `qrPixels`, and plate-corner checks mandatory. For uploaded posters, retain the current full-canvas `alphaPreserved` rule. For the blank starter, verify that untouched pixels remain alpha 0, plate pixels equal the normalized QR, dark texture opacity matches raster coverage, and no white background appears in light texture cells. Give this mode-specific alpha check an honest name in `VerificationCheck` while preserving report schema 8 and existing check names for uploaded-poster reports.
5. **Show and document the result.** Add a checkerboard background behind the exported poster preview in `ResultPanel.tsx`; keep the image Blob shared with the download. Describe blank canvas transparency and the opaque QR plate in `README.md` and `doc/plan/web-qr-poster.md` when the behavior is implemented. Do not revise the historical `artistic-qr-poster.md`.

## Verification checkpoints

- Extend `test/blank.test.ts` to assert the starter PNG is transparent, its mask still selects the full canvas, and an assembled blank export has alpha 0 at a background pixel, opaque QR light and dark plate pixels, and visible dark decorative ink. Inspect representative partially antialiased pixels for valid intermediate alpha.
- Cover square, dot, and rounded texture styles, both upright and rotated placements, in core/engine tests. Assert no opaque white texture cell survives in blank mode, `pattern-cut.png` matches the poster's ink geometry, and all mandatory checks qualify.
- Keep the uploaded `source/poster.png` fixture as a regression: decoded output pixels and alpha outside allowed writes remain exact, and Node/browser imaging parity stays within the existing antialiasing tolerance. Test an uploaded transparent PNG as an upload, not as the blank starter.
- Manually inspect preview and downloaded `poster.png` on a checkerboard and a dark background; scan the exported QR on a light background. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` only if explicitly requested, per `AGENTS.md`. Run `pnpm test:e2e` only on request.

## Risk to handle during implementation

The current blend updates RGB while leaving alpha untouched. Applying that formula to a transparent destination produces invisible or dark-fringed pixels. Source-over must calculate output alpha and unpremultiplied RGB together, especially at rounded rims and after rotation. The plate's opaque light cells are intentional: making those transparent too would change scan contrast and the exact QR-pixel invariant, and needs a separate decision.
