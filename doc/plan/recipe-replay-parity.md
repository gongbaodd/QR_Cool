# Plan: Match recipe replay to the browser result

Status: planned. Date: 2026-09-27.

## Verified facts and open question

The reported mismatch concerns `apps/web/public/mahu-qr.recipe (1).json`. This file embeds a 1000×1000 fully transparent source poster, a 1000×1000 opaque black/white region mask, `transparentBlank: true`, the content `https://qr.growgen.xyz`, and placement `{ x: 299, y: 467, size: 232, rotation: 90.40393119750146 }`. The mask selects 256,981 pixels and has a white-pixel bounding box of `(133, 133)` to `(867, 867)` in poster coordinates.

The QR encoder produces version 2 for this content and ECC M: 25 code modules plus the local two-module margin on each side, or 29 total modules. The saved size is valid: `232 / 29 = 8` pixels per module. The fractional rotation is also valid. **Do not treat this recipe as a noncanonical placement or plan to reject it on that basis.**

The API defaults to `poster.png`. Its optional `?artifact=qr.png` returns the standalone transparent QR, which has no poster region or poster-space placement. The recipe exporter takes the accepted assembly input and its emitted `region-mask.png`; the replay path passes that mask to the shared `assemblePayload` and validates the requested placement. These paths do not show an obvious recentering or redetection of this recipe's region.

The unresolved question is which two images were compared: the browser's editing preview, its assembled original `poster.png`, a smaller raster variant, or the standalone `qr.png` response. The recipe has no embedded browser result, and the current evidence does not identify a rendering fault. Establish the comparison before changing geometry or the recipe schema.

## Required outcome

For the same valid recipe, Worker `poster.png` must match the browser's **accepted original-resolution assembled `poster.png`** in region coverage, QR center/size/rotation, and rendered pixels. The standalone `qr.png` retains its current documented purpose. If the user needs a different artifact, define its intended output separately after comparing the actual images.

## Investigation and fix sequence

1. **Capture the comparison artifacts.** Save the browser's accepted original `poster.png`, the browser's `region-mask.png`, and the Worker response body for `POST /v1/render` with no artifact query. Record the response status, `Content-Disposition`, dimensions, alpha, and whether the call actually requested `?artifact=qr.png`. If the user was comparing against the editing preview or a resized variant, capture that separately and describe its expected difference from original assembly.
2. **Compare geometry before pixels.** Decode the embedded poster and mask from this recipe and verify their SHA-256 digests, dimensions, and mask selection against the browser exports. Compare the browser report's placement, total module count, content, settings, and mask bounds with the recipe. For the QR, compare center `(415, 583)`, size `232`, and rotation `90.40393119750146°` in poster coordinates. Inspect the Worker PNG's alpha and changed-pixel bounds; the source poster is transparent, so an image viewer's background color can change its appearance without changing pixels.
3. **Run a local replay parity probe.** Replay the exact JSON through the renderer's browser imaging backend and the local workerd API, then compare both full PNGs against the browser's accepted original. Report both byte equality and decoded RGBA equality, since PNG encoders can produce different bytes for identical pixels. Use local files and the existing Worker harness; do not call production. This diagnostic comparison is specifically needed to isolate an editor export, shared renderer, or Worker runtime difference.
4. **Fix the first confirmed divergence.** If the recipe mask differs from the accepted browser mask, trace mask selection, assembly artifact emission, and `createRecipeBlob` snapshot timing. If placement/settings differ, trace `movePlacement` and the `useEngineRequest` assembly snapshot into recipe serialization. If local browser replay matches but workerd differs, inspect the Cloudflare imaging initialization and rotated working-frame sampling. If all original poster pixels match, correct the artifact request or the expectation shown in documentation/UI; do not alter placement or mask rendering.
5. **Preserve current rendering constraints.** Keep opaque-white mask selection, original poster coordinates, whole-safe-module coverage, mandatory verification, and exact accepted placement. A blank transparent poster should remain transparent outside rendered modules. Do not expand the region or move the QR merely to imitate an editing overlay.
6. **Add focused regression coverage for the confirmed cause.** Keep this recipe as a local fixture only if its embedded content is appropriate for the test suite; otherwise make a small equivalent fixture. Assert decoded region and placement parity for browser assembly and Worker replay at the original size, including fractional rotation and transparent source alpha. Add an artifact-selection assertion only if that caused the report. Avoid a test that merely repeats the implementation's calculations.
7. **Update the canonical docs for any behavior change.** Update `README.md` and `doc/plan/web-qr-poster.md` if the fix changes user-visible export or replay behavior. Record the `poster.png` versus `qr.png` distinction where the API example is documented. Remove this plan after the change ships, following the repository plan lifecycle.

## Acceptance criteria

- The exact provided recipe is accepted and the Worker's original `poster.png` has the same decoded pixels as the browser's accepted original `poster.png`, or a documented codec-only byte difference with decoded pixel equality.
- The replayed selected region matches the embedded final mask, and the QR keeps center `(415, 583)`, size `232`, rotation `90.40393119750146°`, and 8px module pitch.
- Any difference between `qr.png`, the editor preview, a smaller variant, and the original poster is identified at the correct output boundary, with no speculative geometry change.
- Regression coverage demonstrates the confirmed fault is fixed using local inputs and no paid API calls.
