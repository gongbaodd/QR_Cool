# QR / COOL

A web editor for artistic QR posters. Upload a PNG with a solid black region, enter text or a URL, position the QR, and download a full-resolution assembled poster.

## Run locally

Requires Node.js 22+ and pnpm 10.33.2.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. For a production server:

```sh
pnpm build
pnpm start
```

No credentials or accounts are needed. QR text is never fetched as a URL. Uploaded files exist only in the browser and in memory for the current server request; they are not stored on the server.

## Editing

1. **Step 1 — Blank size.** Set a white canvas width and height (up to 4 megapixels total) and choose **Use blank canvas** for a full-canvas region with no upload, or upload a **Poster PNG** instead.
2. **Step 2 — Mask or poster.** The editor detects the dense black shape and highlights it in green. If needed, upload an optional same-size **region mask PNG**: white selects the region, black excludes it. Under this step you can also draw the mask from a word in a bundled display font (Fathead, personal use only) instead of uploading one: type the word, preview the letterforms, and apply it as the mask.
3. **Step 3 — Adjust QR with the mask.** Enter one nonblank line of text or a URL. Surrounding spaces are preserved exactly. Drag the QR, resize a corner, or enter **X**, **Y**, and **Size** in original poster pixels. X/Y include the normalized QR's two-module source margin. Size snaps to whole modules, at least four pixels per module. Arrow keys move one pixel; Shift+arrow moves ten. On touch screens, use the direction buttons or drag. Zoom and scrolling change only the editing view.
4. **Step 4 — Generate.** **Assemble poster** draws and verifies the full-resolution result. Download **poster.png**, or expand **Artifacts & verification** for the QR PNG, transparent cut PNG, cut SVG, region mask, and schema-8 report.

Every input edit invalidates the previous output. Invalid manual placements are flagged and never silently moved. **Reset to automatic placement** finds a valid square with space left for texture. Longer content retains the previous center and module pitch when possible, then revalidates the enlarged QR.

Pattern settings provide a stable seed, **New pattern**, a finder margin of one or two modules, and marker corners that continue the texture or stay light. The corner setting affects the QR plate, not the poster's silhouette.

**Artistic margins can affect scanning. Test the downloaded poster with your phone.** The result is not scan-certified. The report deliberately skips poster/full-size, half-scale, and JPEG decoding checks; `phoneScan` remains `untested`.

## Renderer contract

- `uqr`, M error correction, automatic mask selection, two locally drawn source margin modules, existing rounded module geometry.
- Seeded marker-free decorative matrix, phase-locked to the placed QR's lattice. Finder/separator and alignment cells are randomly refilled; timing and function cells remain.
- Only whole modules fully covered by the selected region are drawn. The outer four safe-module rings are dark. The plate does not seed that rim.
- The actual plate is the code grid plus whole-cell finder-only light bands. Its footprint is smaller than the full QR square used for placement constraints.
- Outside-region pixels, partially covered modules, QR plate pixels, and original alpha are verified. Any mandatory check failure rejects export.
- Schema-8 reports are preserved. API response metadata is a separate version-1 envelope, with logical input names and no server paths.

The CLI, paid image generation, QR-image upload, and standalone pattern modes are retired. The browser editor is the supported product interface.

## HTTP endpoints

`POST /api/prepare` and `POST /api/assemble` use multipart form data:

- `poster`: PNG file
- `mask`: optional PNG file
- `data`: JSON containing `revision`, exact `content`, `settings: { seed, qrMargin, plateCorners }`, and optional `placement: { x, y, size }`. Assembly requires explicit placement. Preparation can also receive `previousTotalModules` to preserve center/pitch across content changes.

Preparation returns dimensions, base64 mask/overlay/QR previews, metadata, canonical placement, and a placement validation message or `null`. Assembly returns canonical placement, base64 artifact buffers, and the verification report. Responses use `Cache-Control: no-store`. Files and QR text are never logged by application code.

Errors have `{ code, message, field?, revision }`: 400 malformed request, 413 upload byte limit, 422 invalid image/content/mask/layout, 500 rendering/verification failure, or 503 renderer busy with `Retry-After: 2`. Revision can be null when the body has not been parsed. The editor aborts superseded fetches and ignores obsolete revisions; cancellation does not promise to stop server computation.

## Limits and hosting

- **10 MiB per PNG, 4 megapixels, one frame.** Dimensions and actual PNG signatures are checked server-side. Masks must match the poster dimensions.
- Total multipart body is bounded at **20 MiB + 64 KiB before parsing**, including bodies without Content-Length. Upload reads time out after 30 seconds.
- One active request per Node process, across both endpoints. Additional requests return 503 rather than waiting in an unbounded queue.
- Use a Node host with Sharp support, **at least 2 GiB RAM per process**, and a request duration of at least 120 seconds. Configure the reverse proxy with the same body limit and duration. Scale by adding independent processes with their own memory allocation. A static export or a 128-MiB Worker cannot run this renderer.
- `Dockerfile` supplies a Node 24 production build/run configuration. No deployment is performed by the project. Verify the image and resource settings on your deployment host.

### Measurements

Local Node 24.13.1, macOS ARM64. `pnpm benchmark` creates a noisy 2000×2000 PNG with a black region, prepares it, assembles it, and materializes the base64 JSON response. A measured run took **823 ms preparation, 1013 ms assembly, 556 MiB peak RSS**, with a **6.88 MiB response**. Results vary by machine, QR version, image entropy, and allocator reuse; this is a local benchmark, not a deployment guarantee.

The proposed 16-megapixel limit used about **1.2 GiB RSS** even on a simple image, so the shipped limit is 4 megapixels. Benchmark on the target host before raising limits or concurrency.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm benchmark
```

Vitest covers engine geometry, decoder fixtures, deterministic artifact hashes captured before refactoring, pixel invariants, buffer services, request limits, concurrent users, and stale reducer responses. Playwright runs production-server journeys in Chromium, Firefox, WebKit, and an iPhone touch viewport, including upload, numeric/keyboard/pointer editing, zoom, assembly, download-byte equality, invalid-placement recovery, and result invalidation.

The renderer lives in the `src/core/` engine modules; `src/server/` owns the stateless buffer services and HTTP adapters, `src/lib/editor/` holds schemas and reducer state, and `src/components/editor/` owns browser interaction. No request invokes a CLI or writes temporary files.

See [web implementation plan](doc/plan/web-qr-poster.md). The [previous artistic QR plan](doc/plan/artistic-qr-poster.md) is historical design context.
