# QR Cool

Local TypeScript CLI for artistic QR posters. It detects the central painted region, places an existing qrcode.antfu.me QR image, and uses Qwen to fill the remaining region with decorative rounded black QR-style cells on white. Local compositing preserves every pixel outside the region and overlays the exact QR and quiet zone.

It also ships an offline `--pattern-preview` mode that renders a poster-sized QR cell texture from a random text line, using the same encoder and default rounded style as [antfu/qrcode-toolkit](https://github.com/antfu/qrcode-toolkit), with the finder and alignment markers removed.

`--pattern-cut` then cuts that texture with a mask. The outline is traced into a vector path with filleted corners, so the cut edge is round rather than a pixel staircase, and the result is written as a self-contained SVG plus a transparent PNG.

`--assemble` finishes the poster offline: it encodes the marker-free module matrix, samples the painted region on the placed QR's own module lattice, keeps only the modules the region covers in full, draws those whole modules over the original pixels with the outer four rings forced dark, and copies the QR code grid into a plate that keeps a one-module light margin. Every drawn edge — silhouette, rim and plate — lands on a module boundary, so no cell is ever sliced. No Qwen call, and no intermediate files to pass between commands. The kept margin is half of what the profile specifies, so the run verifies the QR input and the geometry but does not decode-verify the poster.

## Setup

Node.js 22+ and pnpm are required.

```bash
pnpm install
```

For live generation, set the following in `.env` (ignored by Git), or export them in your environment. Existing environment values take precedence. Credentials are loaded only for `--generate` and are never included in reports.

```dotenv
QWEN_API_KEY=your-key
QWEN_BASE_URL=https://ws-hxrjydip77dx0nxq.cn-beijing.maas.aliyuncs.com/api/v1
```

The base URL above is the configured Beijing workspace default. Override it for another workspace. Keys and endpoints must belong to the same region.

## Commands

```bash
# Offline preview; no API key required
pnpm qr-poster -- --dry-run --input source/poster.png --qr test/fixtures/qr.png --out-dir output/preview

# One paid Qwen generation
pnpm qr-poster -- --generate --input source/poster.png --qr test/fixtures/qr.png --out-dir output/qwen-pattern

# Reuse downloaded artwork without a network call
pnpm qr-poster -- --generated-image output/qwen-pattern/ai-raw.png --input source/poster.png --qr test/fixtures/qr.png --out-dir output/recomposed

# Offline marker-free QR cell texture sized to the poster; no API key required
pnpm qr-poster -- --pattern-preview --input source/poster.png --qr test/fixtures/qr.png --out-dir output/pattern-preview --seed 1

# Offline cut of a rendered texture; no QR input and no API key required
pnpm qr-poster -- --pattern-cut --input output/pattern-preview/pattern.png --cut-mask output/qwen-fresh/edit-mask.png --out-dir output/pattern-cut

# Offline end-to-end poster: texture, cut, composite and QR overlay in one run
pnpm qr-poster -- --assemble --input source/poster.png --qr source/qr.png --out-dir output/assemble --seed 1
```

The QR input should be square with the qrcode.antfu.me two-module quiet zone. The bundled `source/qr.png` is a tight 753×748 crop of that same code — a 740px code at 20px/module with an uneven 8/5/5/3px margin — so its missing quiet zone is rebuilt locally from the code pixels without resampling. `test/fixtures/qr.png` is the same code with its margin intact and produces the same poster. A crop that does not sit on an integer module grid is still rejected.

Specify exactly one of `--dry-run`, `--generate`, `--assemble`, `--pattern-preview`, `--pattern-cut`, or `--generated-image`. `--input` and `--out-dir` are required; `--qr` is required by every mode except `--pattern-cut`.

| Option | Behavior |
| --- | --- |
| `--model <name>` | Qwen model; default `qwen-image-2.0`. Account/model availability is checked by the API. |
| `--prompt <text>` | Pattern instruction; defaults to rounded dots and connected black cells on white, matching the real QR module size and density. |
| `--text <value>` | Optional exact expected QR content. |
| `--mask <path>` | Same-size PNG: white with nonzero alpha selects the painted region; black or transparent excludes it. |
| `--qr-box <x,y,size>` | Manual protection box; size must be an integer multiple of the QR module count and fit entirely inside the region. |
| `--pattern-preview` | Write `pattern.png` and `report.json` only: a poster-sized, marker-free QR cell texture. |
| `--pattern-cut` | Cut a pattern PNG with a mask and write `pattern-cut.svg` and `pattern-cut.png` only. |
| `--assemble` | Offline end-to-end poster: phase-locked texture, whole-module safe-area cut with a four-module dark rim, composite, module QR plate holding the code at a one-module margin, geometry checks, and a schema-7 report. |
| `--cut-mask <path>` | Same-size mask PNG in the edit-mask convention: transparent or dark pixels select the cut shape. Requires `--pattern-cut`. |
| `--cut-radius <px>` | Corner fillet radius for `--pattern-cut` (default 5). For `--assemble` it is the plate corner treatment: `0` writes the square module window back and any positive value hands each plate corner module to the texture (default: two module pitches, 10px on the bundled poster). |
| `--cut-smooth <px>` | Outline simplification tolerance for `--pattern-cut` (default 3). Rejected by `--assemble`, whose cut draws whole modules and has no traced outline. |
| `--qr-margin <modules>` | Light margin `--assemble` keeps around the code, in modules; defaults to 1. A whole module keeps the plate on the lattice, so every drawn cell stays whole; a fraction (0.2 = 1px here) paints the plate at pixel precision and trims that many pixels off each texture cell along its edge. Zero is rejected: it removes the code's quiet zone and the poster stops decoding. |
| `--module-pixels <n>` | Pattern module pitch; defaults to the pitch the pipeline places on the poster. Requires `--pattern-preview`. |
| `--seed <n>` | Seed for the pattern random text line and the marker refill; defaults to a fresh random seed per run. Requires `--pattern-preview` or `--assemble`. |
| `--force` | Replace known artifacts in the output directory. |

## Pattern preview

`--pattern-preview` encodes a random text line with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults (`ecc: M`, 2-module margin, rounded pixel style, automatic mask). Modules typed `Position` (the three finder patterns with their separators) and `Alignment` are dropped and refilled with seeded random cells (1017 of them at version 30), so the result is an even field of rounded cells with no white marker-shaped holes. Timing and format cells are kept. The refill draws from its own random stream derived from the seed, so it never reuses the text line's generator state. Nothing is composited onto the poster and no API call is made: the output is deliberately not decodable, and the scannable QR still comes from the existing placement pipeline.

The pitch defaults to the module size the pipeline places on the poster, so the texture matches it. The smallest QR version whose modules and margin cover the poster canvas is chosen and centered, cropped at whole-module offsets; cells are never scaled. With the bundled poster (688×566) and `test/fixtures/qr.png` (41 total modules, 5px/module) that is version 30: 137 modules, a 705px code and a 10px/70px crop, which needs a 1370-character random line to fill the data capacity without repeating pad codewords. Pass `--module-pixels 20` (the toolkit's default scale) for a chunkier texture, which drops to version 4 and a 62-character line. Below 6px per module the rounded cells are heavily antialiased; the report records a warning.

Reports use schema version 3 and record the seed, alphabet, text length and hash, version, module counts, pitch and its source, removed marker types, the refill style and refilled cell count, code size, canvas, crop offsets, and the pattern hash. The same seed reproduces the same bytes.

## Pattern cut

`--pattern-cut` takes an already rendered pattern PNG plus a mask and writes the cut texture twice: `pattern-cut.svg`, which is self-contained (the pattern rides along as a data URI under a vector `clipPath`), and `pattern-cut.png`, an RGBA image that is transparent outside the cut. Nothing is composited onto the poster, no QR is overlaid, and no API call is made.

The mask uses the edit-mask convention: a pixel is inside the cut shape when it is transparent or dark. Both `output/qwen-fresh/edit-mask.png` (opaque white outside, transparent inside) and `region-mask.png` (white on black) therefore work, and the mask must match the pattern size.

The outline is traced along pixel borders, collapsed to corners, simplified with a Douglas-Peucker tolerance (`--cut-smooth`, default 3px), and every corner is filleted with `--cut-radius` (default 5px). The fillet clamps to half of each neighbouring edge so narrow features stay inside the polygon; a feature narrower than roughly twice the smoothing tolerance is erased entirely, so lower `--cut-smooth` when a thin shape disappears. Loops smaller than the fillet area (radius²) are dropped as specks. The path carries `fill-rule="evenodd"`, so a hole in the mask stays a hole: the real `edit-mask.png` yields the painted blob plus its 205×205 QR hole with rounded corners, 196 surviving vertices after simplification, and 21 pixel-jagged specks dropped.

The PNG comes from rasterizing only the path and applying it as the alpha channel of the untouched pattern pixels, so everything inside the cut stays bit-exact and everything outside is fully transparent; only the cut edge is antialiased.

Reports use schema version 4 and record the pattern and mask hashes and sizes, the radius, smoothing tolerance, keep rule and speck threshold, the traced and kept loop counts, traced and simplified vertex counts, holes, cut area and bounds, both artifact hashes, and warnings.

## Assembly

`--assemble` is the offline end-to-end mode and the one to use when no Qwen call should be made. It follows one workflow — QR generator, module matrix, painted-region mask, safe-area calculation, draw full modules — and resolves the layout exactly like `--dry-run` (same detection, `--mask` and `--qr-box` overrides), then in a single run:

1. Encodes the marker-free module matrix and renders it at the pitch the pipeline places on the poster, using `--seed` for the text line and marker refill. The crop window is phase-locked to the placement so a module boundary lands on the QR's lattice; the generator asks for one module of headroom, so a canvas the tightest version would fill exactly can still lock. On the bundled poster that is crop 11/69 with a residual phase of 0/0 — the earlier 9/71 was two pixels off, which would have sliced every drawn cell.
2. Builds the module lattice from the placement origin (5px from (249,201) here) and marks a module **safe** only when its whole block is on the canvas and every pixel of it is inside the detected or supplied region. A partly covered module is dropped and keeps the original artwork, so no drawn edge ever crosses a cell: 4,778 modules are safe and 451 are dropped, 6,047 region pixels of artwork kept.
3. Marks the **QR plate** on the same lattice: the plate window is the placement box inset by `2 × pitch − margin`, and every module that window covers leaves the drawn set, so the cut never relies on artwork showing through the plate. At the default one-module margin that is a 195×195 window at 254,206 and a 39×39-module hole, minus its four corner modules, which stay texture — a 1,517-module hole. A fractional `--qr-margin` makes the window pixel-tight instead: it sits a fraction inside the neighbouring cells, which are then trimmed by the plate (see the decode table and the report warning).
4. Forces the outer four rings of drawn modules dark (Chebyshev distance ≤ 4 from the nearest unsafe module; the plate never seeds the rim). Those 1,316 rim modules are the module-level replacement for the old 20px black border, and the remaining 1,945 drawn modules carry the texture.
5. Renders only those 3,261 modules — 81,525px — over the original pixels. Dropped modules and everything outside the region keep their bytes, so nothing is punched transparent and the "nothing outside the painted region changes" guarantee holds literally. Rim modules are ordinary dark cells of the texture, so the outline speaks the same language as the field.
6. Copies the normalized QR **with one light module kept** into that hole: the 195px crop (a 5px margin around the 185px code grid) sits at 254,206 and the four corner modules are handed back to the texture instead of the QR's own margin. `--cut-radius 0` keeps all 39×39 modules and paints the square window. The plate carries no dark band. The profile specifies a two-module margin, so the run does not claim a scannable result; see the decode table below.

With the bundled poster and QR the run reports the region at 125,497px, a 205px QR at 5px/module (box 249,201), a version-30 texture at seed 1 cropped at 11/69 so its lattice matches, a 137×113 lattice with 4,778 safe modules, 451 dropped partial modules, 3,261 drawn modules on it, and a 1,517-module plate hole behind a 5px margin. A layout that leaves no texture module after the rim and the plate is rejected with `QR_LAYOUT_INVALID` (exit 2) instead of drawing a black slab.

Decode evidence, measured on this build by re-running the assembly with each margin and decoding the poster at three scales (`ZXing`, falling back to `jsQR`):

| Margin | Module-level | Full size | 50% | JPEG-80 |
| --- | --- | --- | --- | --- |
| 2 modules (source profile) | yes | decodes | decodes | decodes |
| **1 module (default)** | **yes** | decodes | decodes | decodes |
| 1 module, square window | yes | decodes | decodes | decodes |
| 0.4 module = 2px | no (trims 2px per cell) | decodes | decodes | decodes |
| 0.2 module = 1px | no (trims 1px per cell) | decodes | fails | decodes |
| 0 module (hole at the code grid) | yes | fails | fails | fails |

One module is the tightest light band that is also a whole number of cells: the band around the code is a row of modules, so it is quantized by the pitch. A fraction of a module can only be painted at pixel precision, which is what `--qr-margin 0.2` (1px) does — it keeps the texture a hair from the code but trims the pixels the plate covers off the neighbouring cells, and the local decoder then stops reading the poster at half scale. A hole at the code grid with no margin at all fails at every scale, which is why zero is rejected rather than rounded away. The default is therefore the readable module-level margin; use a fraction only when the tight look matters more than the half-scale read. Either way the run does not verify the poster and `phoneScan` stays `untested`: a phone sees perspective, blur and glare that this decoder does not. The report adds `qrPlateCorners` to the checks, so the corner modules the plate gives back to the texture are verified rather than assumed, and `cornerTexturePixels` records how many window pixels they cover (100 at one module, 16 at 2px, 4 at 1px, 0 with `--cut-radius 0`).

Artifacts: `poster.png`, `pattern-cut.png` (the composited cut layer: the texture and its dark rim in whole modules, transparent everywhere else and in the plate hole), `pattern-cut.svg` (the same cut, embedded as a data URI under a clip path that is the union of the drawn module rectangles), `region-mask.png`, `qr.png` (the normalized 205px QR, kept as evidence for the quiet-zone rebuild), and `report.json`.

The schema-7 report records the input hashes and sizes, the region block, the QR metadata with `quietZoneSource: "added"` when a margin was rebuilt plus the `overlay` block describing exactly what was composited (the light margin in modules, the 5/5/195 crop and its 254,206 position), the placement, the full pattern block (seed, alphabet, text length and hash, version, module counts, pitch, removed marker types, refill count, code size, crop, and the `alignment` phase, which is the residual offset of the texture's boundaries from the QR lattice — 0/0 when they coincide), the `cut` block (module pitch and lattice origin, requested radius, safe modules, dropped partial modules and their pixels, drawn modules, the rim width and style, the number of plate corner modules handed back, keep rule and edge blend rule), the `qrPlate` block (the requested margin in modules, the pixel margin actually painted, corner modules per corner, a `module-window` or `pixel-window` path, box, hole modules, and `cornerTexturePixels`), the `shape` block (bounds and area of the drawn modules plus the module, rim and texture counts), every artifact hash, the verification checks, `phoneScan: "untested"`, and warnings. Checks are `sourceQr`, `normalizedQr`, `outsideRegionPixels`, `qrPixels`, `qrPlateCorners`, `moduleCut` (every changed pixel is inside a drawn module or the plate window), and `alphaPreserved`; the three poster decode checks are listed in `verification.skippedChecks` and a warning says so. Verification failures exit 4.

## Artifacts and verification

Dry-run and generation modes save `region-mask.png`, `layout-preview.png`, `qr.png`, `edit-mask.png`, `before-ai.png`, and `report.json`. Generation also saves `ai-raw.png`, `reference-canvas.png`, and `poster.png` when those stages succeed. Pattern preview saves only `pattern.png` and `report.json`.

Pattern cut saves only `pattern-cut.svg`, `pattern-cut.png`, and `report.json`.

Assembly saves only `poster.png`, `pattern-cut.png`, `pattern-cut.svg`, `region-mask.png`, `qr.png`, and `report.json`.

Qwen receives an opaque selection guide, a crop from the center of the placed QR, and the prepared poster last as Base64 images. The crop uses whole cells from the central third and excludes the circular corner markers (smaller QR versions use a narrower crop to avoid markers). It is saved as `pattern-reference.png` and placed once, without scaling, at the top-left of a plain white reference canvas. Qwen is instructed to generate a fresh arrangement with even density, using the sample only for cell shape and size. Copying, stretching, enlarging, or tiling the sample is prohibited. The prompt forbids generated scene artwork and extra finder rings, and specifies the real QR module pitch. Decorative cells encode no additional data. Inputs are padded on the right and bottom to multiples of 16; the output is cropped back before compositing. The QR square is blanked only in the AI input so the model cannot copy its circular markers. The exact QR and its entire white quiet zone are restored locally. Qwen receives natural-language editing instructions, not an OpenAI mask parameter. Only pixels inside the editable region are used in the final poster.

Dry-run reports retain schema version 1. Generation reports use version 2 and record model, full editing prompt, canvas dimensions, request ID and usage when returned, durations, final scan checks, and protected-pixel checks. Phone scanning is recorded as `untested`. Usage is not a measured monetary cost.

Qualification requires decoding the source, normalized QR, prepared preview and final poster, including 50% resize and JPEG quality-80 variants, plus exact protected-pixel checks. Verification failures exit with code 4; API/image errors use 3; invalid arguments use 2. Automated qualification does not assess artistic quality; inspect the output for seams or remaining painted areas.

Before any of that, the QR input is resolved to a square image with a two-module quiet zone. The documented profile is preferred; when the image is a tight code-grid crop instead, the integer-scaled module grid is located by fitting the ink bounding box and minimizing the per-module luma variance, then the code pixels are copied 1:1 onto a fresh light margin and `quietZoneSource: "added"` plus the trimmed margin are recorded. Nothing is rescaled, so a conforming source and its code-grid crop produce byte-identical posters. A crop that cannot be fitted to the grid is rejected with `QR_INVALID`.

API requests have a five-minute timeout and no automatic retries. A timeout may still incur a charge. Raw downloaded artwork is retained if geometry, compositing, or verification fails. Offline reuse accepts the padded canvas size or the original image size, and must use the same input/layout for meaningful alignment.

## Library

```ts
import { assemblePoster, generatePatternCut, generatePatternPreview, generatePoster, preparePoster } from 'qr-cool'

await preparePoster({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/preview', dryRun: true })
await generatePoster({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/qwen-pattern', apiKey: process.env.QWEN_API_KEY })
await generatePatternPreview({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/pattern-preview', seed: 1 })
await generatePatternCut({ inputPath: 'output/pattern-preview/pattern.png', maskPath: 'output/qwen-fresh/edit-mask.png', outputDir: 'output/pattern-cut' })
await assemblePoster({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/assemble', seed: 1 })
```

The library uses explicit credentials or environment variables; it does not load `.env`. `compositePoster()` remains available for direct local compositing, and `resolveQrSource()` exposes the QR profile check with its code-grid fallback.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests use mocked API responses and local images, with no paid calls. Inputs remain PNG-only. The existing QR uses two quiet-zone modules and integer module scaling, and the QR suite covers the strict profile, the code-grid crop of `source/qr.png` rebuilding byte-for-byte onto `test/fixtures/qr.png`, and rejection of a crop that misses the grid; pattern preview reimplements the toolkit's rounded cell geometry as SVG, and its test suite compares that rendering against `test/fixtures/qr.png` pixel for pixel, including the phase-locked crop and the per-module include mask. Pattern cut traces the mask outline into a filleted SVG path and asserts that pixels inside the cut stay bit-exact, that a hole stays a hole, and that the same inputs reproduce identical artifact hashes. Assembly asserts the schema-7 report, the measured 4,778 safe / 451 dropped / 3,261 drawn / 1,316 rim / 1,945 texture module counts, that the written cut layer is uniform per module with no partial cell, that every drawn module survives into the poster untouched at the default margin, that dropped modules and everything outside the region stay byte-exact while drawn modules match a freshly rendered texture, the 1,517-module plate hole with its four corner modules as bit-exact texture, `--cut-radius 0` painting the 1,521-module square window, the pixel-tight `--qr-margin 0.2` mode with its 73 trimmed cells and its warning, a local-decoder pass at full size, 50% and JPEG-80 at the default margin and at full size and JPEG-80 only in the 0.2 mode, the rejected `--cut-smooth`, the rejected `--qr-margin 0` and `--qr-margin` outside assembly, the rejected texture-free layout, seed reproducibility, and that the trimmed and square QR inputs give the same poster bytes. The CLI cases skip themselves on sandboxes that refuse to start child processes. Web hosting and closed-outline region detection remain future work.

API documentation: [Qwen image editing](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-api).
