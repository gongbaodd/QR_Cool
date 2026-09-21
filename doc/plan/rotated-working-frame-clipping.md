# Plan: prevent rotated QR and texture clipping

Status: **implemented** — the bounds fix, the shared frame-coverage guard, and the regression tests are landed.

## Finding

The rotated path builds a working canvas from `regionPixelBounds()` and `qrWorkingFrame()` in `src/core/rotate.ts`. Both `validatePlacement()` and `assembleRotated()` use that frame. `regionPixelBounds()` currently assigns `x1 = x + 1` for every selected pixel. Because it scans rows from top to bottom, `x1` ends up as the right edge of the **last selected row**, not the rightmost selected pixel in the mask. A region that narrows toward the bottom can therefore produce a canvas too narrow to hold its inverse-rotated contents. `qrWorkingFrame()` can only transform the bounds it receives; it cannot recover the omitted area.

A 100 × 100 synthetic mask with selected x coordinates 20–79 in rows 20–78 and only x=20 in row 79 should report `{ x0: 20, y0: 20, x1: 80, y1: 80 }`. It currently reports `x1: 21`. At 45°, 2,552 selected poster pixel centres map outside the resulting working frame. The existing rotated tests pass rectangular masks and hand-written bounds, so they miss this shape.

Clipping can remain invisible to the current export checks: `assembleRotated()` checks QR pixels only for plate cells found **inside** the frame. A plate cell lost because the frame is too small is never checked.

## Steps

### 1. Capture the failure with focused tests

- Add a `regionPixelBounds()` regression in `test/rotation.test.ts` for a tapered or irregular mask whose final selected row is narrower than an earlier row. Assert all four half-open bounds, including `x1: 80` in the example above. Include a mirrored taper and a sparse rightmost pixel so scan order cannot determine an edge.
- For several rotations, including 30°, 45°, 90°, and an angle close to 360°, map every selected poster pixel centre into `qrWorkingFrame()` and assert its working index is in bounds. Check that a valid QR plate also fits the frame. Keep this geometry test independent of image decoding and pattern rendering.
- Add an end-to-end rotated assembly fixture with a tapered uploaded mask and a valid QR placement. Compare the poster and cut artifact with the expected selected-region/whole-module geometry, and assert that the full QR plate is represented. A `qualified` report by itself is insufficient evidence of coverage.

**Checkpoint:** the new bounds and frame tests fail on the current code for the expected clipping reason.

### 2. Correct the region bounds in `src/core/rotate.ts`

- Track the maximum selected x independently of row order: update `x1` with `Math.max(x1, x + 1)`. Keep `x0`/`y0` as minima and `x1`/`y1` as exclusive maxima. Preserve the empty-mask error.
- Confirm that the computed bounds agree with `regionMask.bounds` from `calculateMaskStats()` for both auto-detected and uploaded masks. Keep one exact bounds convention through `validatePlacement()` and `assembleRotated()`.
- Retain the region-bounded working canvas. Do not enlarge it to the entire poster or add an arbitrary margin; that would raise memory use without addressing wrong bounds.

**Checkpoint:** the pure bounds and frame tests pass, and the working frame contains all inverse-mapped selected pixel centres.

### 3. Guard against silent frame truncation

- In the shared rotated-frame setup, verify that every poster pixel centre that belongs to the valid placed QR maps to a working pixel inside the frame. Reject assembly if this invariant fails; do not let a missing plate cell count as a passing `qrPixels` check.
- Check the same invariant in preparation so the editor flags a bad placement before export. Use the same nearest-neighbour pixel-centre convention as the rotate-back loop.
- If the corrected bounds still fail only at a floating-point boundary, make the frame rounding conservative by the smallest measured amount and cover that case with an exact regression. Keep validation and assembly on the same geometry helper.

**Checkpoint:** a deliberately undersized frame cannot produce a qualified export, and normal rotated fixtures still qualify.

### 4. Verify product behavior and document the fix

- Exercise an uploaded tapered mask and the auto-detected poster region in the browser: place the QR near a wide upper part of the region, rotate through several angles, assemble, and inspect the poster and pattern cut at full resolution. Confirm that selected whole modules and the QR stay complete, while pixels outside the mask and partially covered modules remain unchanged.
- Preserve the 0° golden output, the stable seed, plate geometry, report schema 8, and existing `outsideRegionPixels`, `moduleCut`, `qrPixels`, and alpha checks. Update `README.md` and `doc/plan/web-qr-poster.md` if the documented behavior changes.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Leave `pnpm test:e2e` for a specific maintainer request, as directed by `AGENTS.md`.

**Checkpoint:** all required commands pass and the browser export has no clipped QR or texture in the reproduced mask.
