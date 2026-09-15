# QR Cool

Local TypeScript CLI for artistic QR posters. It detects the central painted region, places an existing qrcode.antfu.me QR image, and uses Qwen to fill the remaining region with decorative rounded black QR-style cells on white. Local compositing preserves every pixel outside the region and overlays the exact QR and quiet zone.

It also ships an offline `--pattern-preview` mode that renders a poster-sized QR cell texture from a random text line, using the same encoder and default rounded style as [antfu/qrcode-toolkit](https://github.com/antfu/qrcode-toolkit), with the finder and alignment markers removed.

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
```

The QR input must be square. The bundled `source/qr.png` is 753×748 and is rejected, so these commands use the square 820×820 `test/fixtures/qr.png`.

Specify exactly one of `--dry-run`, `--generate`, `--pattern-preview`, or `--generated-image`. `--input`, `--qr`, and `--out-dir` are required.

| Option | Behavior |
| --- | --- |
| `--model <name>` | Qwen model; default `qwen-image-2.0`. Account/model availability is checked by the API. |
| `--prompt <text>` | Pattern instruction; defaults to rounded dots and connected black cells on white, matching the real QR module size and density. |
| `--text <value>` | Optional exact expected QR content. |
| `--mask <path>` | Same-size PNG: white with nonzero alpha selects the painted region; black or transparent excludes it. |
| `--qr-box <x,y,size>` | Manual protection box; size must be an integer multiple of the QR module count and fit entirely inside the region. |
| `--pattern-preview` | Write `pattern.png` and `report.json` only: a poster-sized, marker-free QR cell texture. |
| `--module-pixels <n>` | Pattern module pitch; defaults to the pitch the pipeline places on the poster. Requires `--pattern-preview`. |
| `--seed <n>` | Seed for the pattern random text line; defaults to a fresh random seed per run. Requires `--pattern-preview`. |
| `--force` | Replace known artifacts in the output directory. |

## Pattern preview

`--pattern-preview` encodes a random text line with `uqr`, the encoder behind qrcode.antfu.me, using the toolkit's defaults (`ecc: M`, 2-module margin, rounded pixel style, automatic mask). Modules typed `Position` (the three finder patterns with their separators) and `Alignment` are dropped before drawing, so the result is an even field of rounded cells. Timing and format cells are kept. Nothing is composited onto the poster and no API call is made: the output is deliberately not decodable, and the scannable QR still comes from the existing placement pipeline.

The pitch defaults to the module size the pipeline places on the poster, so the texture matches it. The smallest QR version whose modules and margin cover the poster canvas is chosen and centered, cropped at whole-module offsets; cells are never scaled. With the bundled poster (688×566) and `test/fixtures/qr.png` (41 total modules, 5px/module) that is version 30: 137 modules, a 705px code and a 10px/70px crop, which needs a 1370-character random line to fill the data capacity without repeating pad codewords. Pass `--module-pixels 20` (the toolkit's default scale) for a chunkier texture, which drops to version 4 and a 62-character line. Below 6px per module the rounded cells are heavily antialiased; the report records a warning.

Reports use schema version 3 and record the seed, alphabet, text length and hash, version, module counts, pitch and its source, removed marker types, code size, canvas, crop offsets, and the pattern hash. The same seed reproduces the same bytes.

## Artifacts and verification

Dry-run and generation modes save `region-mask.png`, `layout-preview.png`, `qr.png`, `edit-mask.png`, `before-ai.png`, and `report.json`. Generation also saves `ai-raw.png`, `reference-canvas.png`, and `poster.png` when those stages succeed. Pattern preview saves only `pattern.png` and `report.json`.

Qwen receives an opaque selection guide, a crop from the center of the placed QR, and the prepared poster last as Base64 images. The crop uses whole cells from the central third and excludes the circular corner markers (smaller QR versions use a narrower crop to avoid markers). It is saved as `pattern-reference.png` and placed once, without scaling, at the top-left of a plain white reference canvas. Qwen is instructed to generate a fresh arrangement with even density, using the sample only for cell shape and size. Copying, stretching, enlarging, or tiling the sample is prohibited. The prompt forbids generated scene artwork and extra finder rings, and specifies the real QR module pitch. Decorative cells encode no additional data. Inputs are padded on the right and bottom to multiples of 16; the output is cropped back before compositing. The QR square is blanked only in the AI input so the model cannot copy its circular markers. The exact QR and its entire white quiet zone are restored locally. Qwen receives natural-language editing instructions, not an OpenAI mask parameter. Only pixels inside the editable region are used in the final poster.

Dry-run reports retain schema version 1. Generation reports use version 2 and record model, full editing prompt, canvas dimensions, request ID and usage when returned, durations, final scan checks, and protected-pixel checks. Phone scanning is recorded as `untested`. Usage is not a measured monetary cost.

Qualification requires decoding the source, normalized QR, prepared preview and final poster, including 50% resize and JPEG quality-80 variants, plus exact protected-pixel checks. Verification failures exit with code 4; API/image errors use 3; invalid arguments use 2. Automated qualification does not assess artistic quality; inspect the output for seams or remaining painted areas.

API requests have a five-minute timeout and no automatic retries. A timeout may still incur a charge. Raw downloaded artwork is retained if geometry, compositing, or verification fails. Offline reuse accepts the padded canvas size or the original image size, and must use the same input/layout for meaningful alignment.

## Library

```ts
import { generatePatternPreview, generatePoster, preparePoster } from 'qr-cool'

await preparePoster({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/preview', dryRun: true })
await generatePoster({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/qwen-pattern', apiKey: process.env.QWEN_API_KEY })
await generatePatternPreview({ inputPath: 'source/poster.png', qrPath: 'source/qr.png', outputDir: 'output/pattern-preview', seed: 1 })
```

The library uses explicit credentials or environment variables; it does not load `.env`. `compositePoster()` remains available for direct local compositing.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests use mocked API responses and local images, with no paid calls. Inputs remain PNG-only. The existing QR uses two quiet-zone modules and integer module scaling; pattern preview reimplements the toolkit's rounded cell geometry as SVG, and its test suite compares that rendering against `test/fixtures/qr.png` pixel for pixel. Web hosting and closed-outline region detection remain future work.

API documentation: [Qwen image editing](https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-api).
