**\# Plan: Rotate the region fill with the QR**

Status: **\*\*planned\*\*** --- follow-up to
\[qr-rotation.md\](qr-rotation.md). That change rotates only the
finished QR plate. The decorative modules that fill the painted region
in \`src/core/assemble.ts\` still sit on the poster's axis-aligned
lattice, so a rotated QR no longer shares a grid with its texture.

The fill must rotate with the QR. Do that without making QR generation,
marker bands, rim, or pattern rendering rotation-aware.

The core design is:

\> Do not rotate the QR. Inverse-rotate the region mask into the QR's
upright frame, generate the fill (and the upright plate) with the
existing whole-module pipeline, then rotate that overlay back onto the
poster.

\`\`\`mermaid

flowchart LR

Mask\[Poster region mask\] --\> Inverse\[Inverse-rotate mask into QR
frame\]

QR\[Upright QR plate\] --\> Generate

Inverse --\> Generate\[Upright assemble: lattice, safe modules, rim,
texture, plate hole\]

Generate --\> Overlay\[Working-space overlay\]

Overlay --\> Forward\[Rotate overlay back\]

Poster\[Original poster\] --\> Composite

Forward --\> Composite\[Composite onto poster\]

\`\`\`

**\## 1. Decision: rotate the mask, not the QR internals**

\[qr-rotation.md\](qr-rotation.md) adopted "generate one upright plate,
then rotate/composite it once." That is still correct for the **\*\*QR
pixels\*\***. It is not enough for the **\*\*fill\*\***:
\`assembleResolved\` builds \`buildModuleLattice(width, height, pitch,
placement)\` in poster space, computes \`computeSafeArea\` against the
unrotated mask, and paints texture on that axis-aligned grid. Only the
plate sample uses \`posterToPlatePoint\`. The result is an upright field
of cells with a tilted QR punched through it.

\| Option \| Verdict \| Why \|

\| --- \| --- \| --- \|

\| Rotate QR modules / finder geometry / texture lattice in poster space
\| **\*\*Reject\*\*** \| Makes every stage rotation-aware (marker bands,
rim rings, phase lock, rounded cells). \|

\| Keep poster-aligned fill and only rotate the QR plate \|
**\*\*Reject\*\*** \| Current behaviour. Fill pitch is no longer the
placed QR's lattice. \|

\| Inverse-rotate the mask, generate upright, rotate the overlay back \|
**\*\*Adopt\*\*** \| Existing assemble stays the 0° pipeline. QR
generation stays upright. Fill modules, rim, and plate hole are computed
on one axis-aligned lattice in the QR frame, then ride the same
placement transform the preview already uses. \|

Rotation remains a property of **\*\*placement\*\***. The generator
still answers "what does the upright plate and texture look like?"
Placement answers "at what angle does that overlay sit on the poster?"

**\## 2. Current behaviour**

In \`assembleResolved\` (\`src/core/assemble.ts\`) and
\`validatePlacement\` (\`src/lib/editor/engine/pipeline.ts\`):

\- The module lattice origin is \`placement.x/y\` on the
**\*\*poster\*\***.

\- Safe modules are whole \`pitch × pitch\` blocks of the
**\*\*unrotated\*\*** region mask.

\- Drawn modules = safe minus the plate hole minus (for counting) the
rim.

\- \`buildPosterPattern\` phase-locks to \`alignTo: { x: placement.x, y:
placement.y }\` on the poster canvas.

\- \`rotation === 0\`: plate hole is the code grid plus finder arms,
with optional corner hand-back (\`computePlateModules\`).

\- \`rotation !== 0\`: plate hole is every poster-lattice module the
rotated **\*\*square\*\*** covers in full
(\`computeRotatedPlateModules\` on \`{0,0,size,size}\`). Corner
hand-backs are skipped. QR pixels are nearest-neighbour inverse-mapped
from the upright normalized QR. Texture is still poster-aligned.

So today a non-zero angle changes only how the QR is stamped. The fill
does not rotate.

\`src/core/rotate.ts\` already has the shared maps this plan reuses:
\`plateToPosterPoint\`, \`posterToPlatePoint\`, \`placementCenter\`,
\`canonicalizeRotation\`.

**\## 3. Target behaviour**

**\### 3.1 Product**

On step 3 the user still rotates the QR freely. After assembly:

\- Decorative cells, rim, and plate hole are the existing upright
geometry, **\*\*rotated with the QR\*\***.

\- Texture pitch equals the placed QR pitch and stays phase-locked to
**\*\*that\*\*** lattice, including at non-zero angles.

\- Original poster pixels stay bit-exact outside the selected region, in
modules the (working-space) region covers only in part, and the alpha
channel is untouched.

\- \`rotation = 0\` remains the current golden path, bit-identical.

\- QR generation, marker-band rectangles, rim rings, and rounded-cell
rendering stay rotation-unaware.

\- The Canvas preview can keep rotating only the QR group; live fill
preview is out of scope.

**\### 3.2 Algorithm**

Work in the QR's unrotated square frame (plate-local coordinates), not
in poster space.

1\. **\*\*Do not rotate the QR.\*\*** Build the normalized QR and
\`markerBandRects\` exactly as the 0° path does.

2\. **\*\*Rotate the mask.\*\*** Build a working canvas that covers the
inverse-rotated poster. Sample the original region mask into that canvas
with the same inverse transform assembly already uses for plate pixels
(\`plateToPosterPoint\` from working pixel centres). Do not rotate the
poster artwork.

3\. **\*\*Generate upright.\*\*** On the working canvas, with \`rotation
= 0\` and the QR box at the plate origin: lattice, \`computeSafeArea\`,
rim, \`computePlateModules\` (code grid + arms + optional corners ---
**\*\*not\*\*** \`computeRotatedPlateModules\`), pattern crop, texture,
coverage, cut layer, upright QR stamp. Base pixels in working space are
empty; only the overlay is produced.

4\. **\*\*Rotate back.\*\*** Inverse-map each poster pixel into working
space (\`posterToPlatePoint\`), nearest-neighbour sample the overlay,
and composite onto a copy of the original poster.

\`\`\`text

region mask --inverse NN--\> working mask

                                  ↓

                    upright lattice / safe / rim / plate

                                  ↓

                    texture + upright QR overlay

                                  ↓

original poster ←--forward NN-- overlay

\`\`\`

Avoid encode/decode PNG round trips for either resample. Operate on
in-memory RGBA / mask buffers.

**\### 3.3 Working canvas**

Do **not** size the working canvas from the whole poster unless the
selected region itself spans the whole poster. Assembly can only write
inside the original region mask, so the useful domain is the selected
region's bounds.

1.  Compute the tight integer AABB of set pixels in the original region
    mask:

```ts
regionBounds = { x0, y0, x1, y1 } // x1/y1 exclusive
```

2.  Map the four corners of that AABB through `posterToPlatePoint` and
    take their integer AABB in plate-local coordinates:

```ts
left = Math.floor(minPlateX)
top = Math.floor(minPlateY)
right = Math.ceil(maxPlateX)
bottom = Math.ceil(maxPlateY)
```

3.  Expand only when required by an existing whole-module/rim operation,
    then clamp/snap according to that operation's current rules. Do not
    add arbitrary visual padding. The frame must cover every
    inverse-mapped region sample that can qualify for fill.

```ts
width = right - left
height = bottom - top
```

Working pixel `(wx, wy)` is plate-local `(wx + left, wy + top)`. The
upright QR box in working space is:

```ts
{ x: -left, y: -top, size: placement.size }
```

Keep the coordinate spaces explicit:

```text
QR-local square
      ↓
working-frame coordinates
      ↓
poster coordinates
```

The working frame is **not** synonymous with the QR-local square; it is
an AABB, expressed in plate-local coordinates, that contains the
inverse-rotated selected region.

At `rotation = 0`, the region-bounded working frame does not necessarily
equal the poster. Keep the existing explicit 0° fast path and never
allocate the extra working buffers there so the current golden fixture
remains bit-identical.

Using region bounds rather than poster bounds is important for browser
cost. A small painted region on a large poster should produce a small
working mask/overlay even at 45°. If the region covers the whole poster,
the frame naturally grows to the inverse-rotated poster AABB and still
preserves all corners.

**\### 3.4 Mask sampling**

Destination-driven, nearest neighbour, same convention as plate sampling
(pixel centre):

\`\`\`ts

workingMask\[wx, wy\] =

original mask at floor(plateToPosterPoint(wx + left + 0.5, wy + top +
0.5))

else 0 if the poster sample is off-canvas

\`\`\`

A working module is safe only when its whole \`pitch × pitch\` block
lies on the working canvas **\*\*and\*\*** every pixel of that block is
set in \`workingMask\`. That is \`computeSafeArea\` unchanged.

**\### 3.5 Overlay sampling back**

Destination-driven, nearest neighbour:

\`\`\`ts

local = posterToPlatePoint(column + 0.5, row + 0.5, placement)

wx = floor(local.x - left)

wy = floor(local.y - top)

\`\`\`

Write the overlay pixel only when all of these hold:

\- the poster pixel is inside the **\*\*original\*\*** region mask (NN
bleed must not paint outside);

\- \`(wx, wy)\` is inside the working overlay;

\- the overlay has coverage (drawn module or plate).

Otherwise leave the original poster pixel, including alpha.

**\### 3.6 Plate hole and corners**

Because generation is upright, restore 0° plate semantics at every
angle:

\- Hole = code grid + finder arms, on the working lattice.

\- \`plateCornersCut\` / corner hand-back works again (today it is
skipped for rotated placements).

\- Delete the assemble/validate use of \`computeRotatedPlateModules\`.
Remove the helper once nothing else calls it.

The rotated QR the user sees is the upright plate after step 4, not a
poster-lattice approximation of the rotated square.

**\## 4. Shared geometry**

Add a small pure helper next to \`src/core/rotate.ts\` (name as fits the
module) so validation, assembly, and tests cannot drift:

\`\`\`ts

export **interface** QrFrame {

left: number

top: number

width: number

height: number

qr: { x: number; y: number; size: number }

}

export **function** qrWorkingFrame(

placement: RotatableBox,

regionBounds: PixelBounds,

): QrFrame

export **function** sampleMaskIntoQrFrame(

mask: Uint8Array,

posterWidth: number,

posterHeight: number,

frame: QrFrame,

placement: RotatableBox,

): Uint8Array

\`\`\`

Reuse \`plateToPosterPoint\` / \`posterToPlatePoint\`. Do not add a
second rotation implementation or an image-processing dependency.

\`validatePlacement\` must use this frame: lattice, safe area, rim,
upright plate, and \`selectPatternVersion\` all see the
**\*\*working\*\*** size, not the poster size. \`fitsMask\` stays on the
original mask (rotated QR footprint vs painted region); that check is
already correct.

**\## 5. Pattern crop**

`buildPosterPattern` / `selectPatternVersion` take the working canvas
size and `alignTo: workingQr`. Phase lock is still "crop residual vs
pitch is 0," now in the QR frame.

Because the working frame is derived from the selected region rather
than the whole poster, it is usually smaller than the poster and avoids
paying for unrelated pixels. A large/full-canvas region can still expand
under rotation (for example near 45°), so the existing
`QR_LAYOUT_INVALID` pitch-too-small error still applies if the required
working crop exceeds the supported pattern version. Surface it from
validation the same way as today; do not silently shrink the texture.

**\## 6. Artifacts**

\| Artifact \| After this change \|

\| --- \| --- \|

\| \`poster.png\` \| Original poster + rotate-back overlay. \|

\| \`qr.png\` \| Unchanged upright normalized QR. \|

\| \`region-mask.png\` \| Unchanged original mask. \|

\| \`pattern-cut.png\` \| Working cut (texture, transparent hole)
rotated back to poster size with the same NN map. \|

\| \`pattern-cut.svg\` \| Working-space cut wrapped in the same
centre/angle transform so it matches the PNG. Do not retessellate
rotated quads in a second geometry path. \|

\| \`report.json\` \| Still schema 8 if readers ignore unknown fields.
\`placement.rotation\` already exists. Record working-frame size only if
a consumer needs it; do not bump the schema for cosmetics. \|

**\## 7. Invariants**

**\### Still true**

1\. QR generation is upright and deterministic.

2\. \`rotation = 0\` is bit-identical to the current assembly path.

3\. Auto-place still emits \`rotation: 0\` and searches only upright
boxes.

4\. Rotation is placement state, not pattern settings.

5\. No server render, CLI, temp files, or base64.

6\. Rotation-only edits do not regenerate the source QR.

7\. Pixels outside the original region, and the original alpha channel,
stay bit-exact.

8\. Download comes from this assembly path, not a second post-process
rotate.

**\### Changed**

\- Fill modules are whole blocks in the **\*\*QR frame\*\***, not on the
poster axes. A poster-space pixel may sit on a rotated module edge;
\`moduleCut\` must judge writes via the inverse map (drawn working
module or plate), not \`moduleCellIndex\` on the poster lattice.

\- \`qrPixels\` at 0° stays a 1:1 copy. At non-zero angles it stays
"this poster pixel equals the NN sample of the upright plate," now
sampled from the working overlay's plate rather than a special-case
\`plateSampleOffset\`.

\- Rounded-rim antialiasing is computed in working space and then
NN-resampled. Accept that; do not re-antialias in poster space in this
change.

\- Rotated placements regain marker-corner hand-back.

**\## 8. Tests**

Extend \`test/rotation.test.ts\` (and assemble/module-cut tests as
needed). Do not add Playwright unless asked.

\| Area \| Cases \|

\| --- \| --- \|

\| \`qrWorkingFrame\` \| 0° equals poster-sized frame with QR at
\`placement.x/y\`; 45° AABB covers all inverse-mapped poster corners;
centre is stable. \|

\| Coordinate round-trip \| Pixel centres at 0°, 30°, 45°, 90°, 135°,
-45°, and 359° satisfy `plateToPosterPoint(posterToPlatePoint(p)) ≈ p`;
shared working/poster helpers preserve the same convention. \| \| Mask
sampling \| A poster-space region pixel is set in the working mask at
its inverse map; off-poster samples are 0. \|

\| 0° assemble \| Existing golden fixture remains bit-identical (fast
path). \|

\| Non-zero assemble (30°, 45°, 90°) \| Qualified; outside-region pixels
unchanged; alpha preserved; overlay writes match the documented NN
inverse map. \|

\| Lattice lock \| Drawn fill cells in working space are whole modules
on the QR lattice; after rotate-back, QR and fill share that lattice (no
poster-axis-aligned leftover field). \|

\| Plate corners \| Rotated + \`plateCorners: 'texture'\` hands corners
back in working space (regression vs today's skip). \|

\| \`validatePlacement\` \| Uses working-frame safe/plate/texture
remaining; rejects when the rotated fill leaves no texture; still
rejects a QR footprint that leaves the original mask. \|

\| Pattern version \| Working canvas larger than the poster can force a
larger version or \`QR_LAYOUT_INVALID\` at a tiny pitch. \|

\| \`computeRotatedPlateModules\` \| Unused by assemble/validate after
the change; delete tests that only exist to describe the old hole. \|

**\## 9. Docs (with implementation)**

\- \`README.md\` step 3: the fill rotates with the QR; generation stays
upright; the mask is inverse-rotated then the overlay is rotated back.

\- \`doc/plan/web-qr-poster.md\` position/assembly contract: drop "whole
upright plate is rotated once" as the full story; the region texture
uses the same placement transform via the mask-rotate algorithm.

\- Mark this plan implemented when the gates pass.

\- Leave \[qr-rotation.md\](qr-rotation.md) as the placement/UI/schema
record. Do not rewrite it into this algorithm; point here for fill
compositing.

\`doc/plan/artistic-qr-poster.md\` remains historical.

**\## 10. Sequenced implementation and gates**

**\### 1. Working frame helpers**

\- \`qrWorkingFrame\`, mask sampling, overlay inverse map in
\`src/core/rotate.ts\` (or a sibling).

\- Unit tests for 0° identity and 30°/45°/90° round-trips.

Gate: \`pnpm test\` for the new geometry; \`pnpm typecheck\`.

**\### 2. Validate in the QR frame**

\- \`validatePlacement\` builds the working mask and upright
plate/rim/texture-remaining checks there.

\- Keep \`fitsMask\` on the original mask.

Gate: 0° validation matches current behaviour; rotated "no texture" and
"QR outside region" fixtures pass.

**\### 3. Assemble through the frame**

\- 0° fast path = today's \`assembleResolved\` body.

\- Non-zero: sample mask → upright generate on working canvas → NN
composite back, clipped to the original region.

\- Stop calling \`computeRotatedPlateModules\`.

\- Cut PNG/SVG follow §6.

Gate: 0° golden bytes unchanged; 30°/45°/90° assemblies qualify;
outside/alpha/qrPixels/moduleCut agree with the new rules; \`pnpm
test\` + \`pnpm typecheck\`.

**\### 4. Cleanup and docs**

\- Remove dead rotated-plate-hole code.

\- README + \`web-qr-poster.md\`.

\- Mark this plan implemented.

Gate: \`pnpm test\`, \`pnpm typecheck\`, \`pnpm build\`. Manual browser
check: rotate → assemble → fill cells follow the QR angle → download. Do
not run e2e unless requested.

**\## 11. Out of scope**

\- Live Canvas preview of the rotated fill (step 3 still shows the QR
group only).

\- Rotation snap / step UI (already out of scope in qr-rotation.md).

\- Rotating the original poster artwork.

\- Making auto-place search angle space.

\- Re-antialiasing the rim in poster space after rotate-back.

\- Decode-verifying the assembled artistic poster.

\- A new image-processing dependency for rotation.

**\## 12. Implementation principle**

The QR engine should keep answering:

\> What does the upright plate and the marker-free texture look like on
an axis-aligned mask?

Placement should answer:

\> Which mask is that, in the QR's frame, and where does the finished
overlay land on the poster?

Inverse-rotating the mask is how the second question is reduced to the
first. Do not teach \`markerBandRects\`, \`computeRimModules\`, or
\`renderPattern\` about angles.
