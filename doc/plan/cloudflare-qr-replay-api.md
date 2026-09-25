# Cloudflare QR replay API and portable recipe export

Status: implementation in progress; the local Hurl/Yaak test scaffolding is implemented, while HTTP execution, manual Yaak import, automated checks, and workerd parity remain outstanding. Date: 2026-09-25.

## Outcome and scope

After a successful assembly, the user can download `mahu-qr.recipe.json`. Sending that file to a Cloudflare Worker recreates the assembled artistic QR poster and returns the image file directly. The JSON is self-contained, as requested: it includes the source poster and final selected-region mask, so replay requires no original browser session, uploaded asset store, font download, or icon service.

“Process” means a declarative recipe containing the resolved inputs needed to repeat the render. It does not mean recording clicks or replaying the editor's interaction history.

The first release provides:

- **Export recipe JSON** after successful assembly, alongside the existing downloads.
- `POST /v1/render` with the recipe as its JSON request body; default response is the original-resolution `poster.png`.
- Optional `?artifact=qr.png` for the standalone QR artifact, distinct from the assembled poster. This retains the current transparent-background QR behavior.
- The same shared QR generation, assembly, placement validation, and mandatory pixel checks in the browser and Cloudflare runtime.

Local editing, previews, and assembly remain available. This adds a server execution target for the QR logic rather than making every editor interaction depend on the network. Migrating the editor's Assemble button to remote execution, importing recipes into the editor, batch jobs, raster size variants, and remote asset storage are outside this first release.

## Current implementation and reuse points

| Existing code                                                        | Planned use                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/editor/engine/{engine,pipeline,types,index}.ts`             | Reuse the in-memory rendering pipeline; isolate replay from browser session revisions and caches.                          |
| `src/core/`                                                          | Keep QR encoding, seeded texture, rotation, safe-module coverage, assembly, and verification as the single implementation. |
| `src/core/imaging/{types,browser,pixels,index}.ts`                   | Share the jSquash/resvg algorithms through the imaging seam, with Cloudflare-specific WASM initialization.                 |
| `src/lib/editor/{schema,png-guard}.ts`                               | Reuse settings and PNG validation; add a strict external recipe schema.                                                    |
| `src/components/editor/hooks/use-engine-request.ts`                  | Capture the exact accepted assembly input and attach the recipe to that result.                                            |
| `src/lib/editor/worker/editor-worker.ts`                             | Produce the portable recipe in the existing session-owned browser worker.                                                  |
| `src/components/editor/ResultPanel.tsx` and `hooks/use-blob-urls.ts` | Expose the recipe Blob as a downloadable file with normal object-URL cleanup.                                              |
| `wrangler.jsonc` and `vite.config.ts`                                | Preserve the existing vinext app deployment; introduce a separate render Worker configuration.                             |

The app already has a Cloudflare deployment path, but that Worker serves the app and icon proxy; image rendering still runs in a browser Web Worker. This proposal is separate from `cloudflare-deployment.md`.

`report.json` is a schema-8 verification report, not a replay recipe. Keep it and the current artifact bytes unchanged. In particular, an assembly already emits `region-mask.png`; use that exact resolved mask for replay, including automatic selection, custom masks, text/icon masks, Fill, and Auto fill.

## Recipe contract

Add a shared, strict Zod schema, provisionally `src/lib/recipe/schema.ts`, with independent recipe and renderer versions. Export all settings explicitly; future defaults must not change old recipes. The JSON contains no UI state, draft text, revision counters, object URLs, `File` objects, credentials, or executable operations.

Illustrative structure below; the base64 and digest placeholders must be replaced by actual bytes and SHA-256 values by the exporter. Geometry and settings must come from a successful assembly, not these sample values.

```json
{
  "format": "mahu-qr-recipe",
  "schemaVersion": 1,
  "rendererVersion": "mahu-qr-renderer-1",
  "content": "https://example.com",
  "source": {
    "poster": {
      "mimeType": "image/png",
      "encoding": "base64",
      "sha256": "<sha256 of original poster PNG bytes>",
      "data": "<base64 PNG bytes>"
    },
    "regionMask": {
      "mimeType": "image/png",
      "encoding": "base64",
      "sha256": "<sha256 of resolved region-mask.png bytes>",
      "data": "<base64 PNG bytes>"
    },
    "width": 688,
    "height": 566,
    "transparentBlank": false
  },
  "placement": { "x": 240, "y": 160, "size": 164, "rotation": 0 },
  "settings": {
    "seed": 123456,
    "qrMargin": 1,
    "plateCorners": "texture",
    "regionMargin": false,
    "rimModules": 1,
    "rimRounded": false,
    "ecc": "M",
    "pixelStyle": "dot",
    "finderMarkers": {
      "tl": { "style": "rounded", "shape": "circle", "inner": "circle" },
      "tr": { "style": "rounded", "shape": "circle", "inner": "circle" },
      "bl": { "style": "rounded", "shape": "circle", "inner": "circle" }
    },
    "markerSub": "square",
    "colors": { "pixel": "#000000", "marker": "#000000", "background": "#ffffff" }
  }
}
```

Contract details:

- Preserve the original source PNG bytes, including alpha. For a generated blank canvas, embed its source PNG and retain `transparentBlank`; bytes alone do not describe that assembly behavior.
- Always embed the final original-coordinate mask. Opaque white selects; unselected pixels do not. Validate its dimensions against the poster. Do not use the overlay, assembled poster, or rotated working mask as the source mask.
- Export committed content exactly, including any encoded payload produced by the content form. An uploaded QR input contributes its decoded committed content, not a dependency on the uploaded QR file.
- Include canonical placement in original poster pixels and canonical rotation. Require an integer module pitch of at least 4. Replay rejects invalid placement without snapping, recentering, or choosing another location.
- Use one normalized settings object. The current assembly call accepts settings both nested and flattened; add one mapping adapter so conflicting copies cannot enter the public contract.
- Validate embedded asset digests against decoded bytes. Digests detect corruption; they are not authentication or permission to skip validation.
- Reject unknown schema/renderer versions explicitly. Version the QR encoder, seeded algorithm, rasterizer/codec behavior, and settings semantics together; pin their dependencies. Retain an old renderer for supported recipes or return an unsupported-version error, never silently replay with changed behavior.
- Replay is a fresh computation from inputs. Do not embed the finished poster and return it as a substitute for executing the recipe.

This introduces a deliberate, narrow exception to the current “no base64 image transport” rule: PNG data is embedded inside portable recipe JSON. Browser worker artifacts remain Blobs, and the API response remains binary. No R2, KV, D1, or asset-upload endpoint is needed.

## Export lifecycle

1. Capture source poster bytes, committed content, normalized settings, `transparentBlank`, and canonical placement for the assembly operation.
2. Once assembly passes all mandatory checks, pair that snapshot with its emitted `region-mask.png`. Build the recipe from these inputs, not a later read of the live editor store.
3. Serialize a JSON Blob in the browser worker. Deliver it through a separate recipe field or artifact entry after the existing schema-8 artifacts have been produced; do not rewrite `report.json` or add recipe data to that report.
4. Accept the recipe and image result together under the existing document-revision and operation-token checks. Keep recipe Blobs out of the Zundo trace, like other artifacts.
5. Expose **Export recipe JSON** only for the accepted result. Downloading it creates no document revision, preparation, assembly, or network request. Use the existing Blob URL lifecycle.
6. Drop stale recipe completions on source replacement, invalidation, or unmount. Draft-only typing must leave the current result and its recipe intact; committed document edits follow existing result invalidation.

The exported recipe always targets original-resolution assembly, regardless of the currently selected smaller PNG download. Label this explicitly beside the export action. If serialization fails or exceeds the documented recipe limit, keep the verified image downloadable and report the recipe error through the existing toast surface; never expose a partial JSON file.

## Worker architecture

Add an independently deployable module Worker, provisionally `src/worker-api/index.ts`, with `wrangler.render.jsonc`. It imports the shared recipe parser and renderer, and contains only HTTP validation, access control, response mapping, and request-local orchestration. Keep the vinext UI Worker and its build path unchanged.

Extract or expose a runtime-neutral replay entry point under `src/lib/recipe/render.ts`. It should call the same assembly pipeline with explicit placement and the embedded final mask, without preparing UI previews or deriving a new mask. Avoid a shared `EditorEngine`: its latest-revision tracking and source caches belong to a browser session, not unrelated HTTP callers.

Add `src/core/imaging/cloudflare.ts` and factor shared codec operations if needed. The browser backend currently fetches emitted WASM asset URLs; the API Worker should import bundled WASM modules and supply them to codec initialization. Both installed codecs declare support for `WebAssembly.Module`, but successful bundling and execution still need a workerd proof. Cloudflare documents importing and instantiating bundled WASM modules in [Wasm in JavaScript](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/).

Audit these runtime boundaries before promising compatibility:

- Browser-only WASM URL imports must not enter the server graph. No Sharp/native add-ons, DOM/canvas dependency, Comlink host, CLI, or temporary filesystem in requests.
- Verify the QR decoders, including the existing ZXing `window.BigInt` workaround, in workerd. Do not assume the browser worker shim is sufficient.
- `src/core/imaging/index.ts` currently holds a mutable global backend. Install a single fixed backend once for this Worker, or thread it explicitly; never switch it per request. Only codec initialization may be shared, with no retained request images or revision state.
- Ensure WASM render handles and temporary buffers are released on both success and failure. Prove that codec use is safe for overlapping requests; serialize codec access if required without retaining an unbounded queue of parsed recipes.
- Initially reuse existing artifact construction for correctness. If memory requires generating fewer artifacts, split emission from verification while preserving every mandatory check and every existing browser artifact byte.

## HTTP contract

| Request                           | Response                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| `POST /v1/render`                 | Verified original-resolution `poster.png` as `image/png`.         |
| `POST /v1/render?artifact=qr.png` | The same replay's standalone transparent `qr.png` as `image/png`. |

Both requests accept the exported JSON directly with `Content-Type: application/json`. Accept `artifact=poster.png` explicitly as well; reject other values. `GET` does not accept recipes. Large JSON and source images belong in the POST body, not URL query parameters.

Document a runnable example using the actual deployed endpoint when available:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $MAHU_QR_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @mahu-qr.recipe.json \
  'https://<render-worker-host>/v1/render' \
  --output poster.png
```

Successful responses use `Content-Disposition: attachment` with the fixed artifact filename, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Return binary PNG bytes directly. Run full assembly validation before sending a successful image response, including for the standalone QR selection.

Errors use JSON `{ "error": { "code": "...", "message": "...", "field": "..." }, "requestId": "..." }`; `field` is optional. Do not expose stack traces or submitted content.

| Status    | Meaning                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| 400       | Malformed JSON/base64, invalid schema, digest mismatch, unsupported version, or unknown artifact.                 |
| 401 / 403 | Missing or invalid credentials / access denied.                                                                   |
| 405 / 415 | Unsupported HTTP method / media type.                                                                             |
| 413       | Request, asset, pixel, or derived working-frame limit exceeded.                                                   |
| 422       | Invalid PNG, mask, content, palette, placement, or mandatory verification failure caused by the requested render. |
| 429 / 503 | Rate limit / bounded render capacity exceeded; include retry guidance.                                            |
| 500       | Unexpected internal rendering failure.                                                                            |

Use a secret-bound API credential for the initial programmatic API, validate before expensive work, and use timing-safe verification. Do not embed credentials in exported JSON or browser bundles. Apply rate limiting and bounded admission before buffering large bodies. A local capacity guard protects an isolate; it is not a global account quota. CORS is disabled by default because exporting locally and calling via curl do not require it; add an explicit origin allowlist only for an actual browser consumer.

Do not fetch QR content, asset URLs, arbitrary SVG, or font URLs supplied by a recipe. The accepted inputs are bounded embedded PNGs and declarative settings. Do not log request bodies, QR content, authorization headers, embedded images, or rendered output. Enable sampled Workers Logs and Traces for request IDs, timings, dimensions, sizes, and error codes.

## Runtime feasibility and limits

This is the first implementation gate. A browser rendering successfully does not prove it fits an edge isolate. Cloudflare currently documents 128 MB per isolate including WASM allocations, shared across concurrent requests; Workers Free has a 10 ms CPU limit, while Paid defaults to 30 seconds and can be configured higher. Target Workers Paid provisionally and measure before choosing the production CPU budget. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), checked 2026-09-25.

Preserve the editor's 10 MiB per PNG and 4-megapixel limits as the desired supported input range. A self-contained recipe with two maximum-size PNGs needs approximately 27 MiB of base64 plus JSON overhead. A provisional wire ceiling of 28 MiB accommodates this, but is not a claim that rendering it fits memory. The current `MAX_BODY_BYTES` assumes binary files and is unsuitable for this JSON contract.

Enforce a bounded byte read before JSON parsing even without `Content-Length`; validate strict base64 and decoded lengths before allocation where possible. Reject unsupported content encodings, excessive nesting, unknown fields, non-finite values, corrupt/truncated images, APNG, and mismatched dimensions. Reuse PNG header guards and verify decoded dimensions. Bound rotated working-frame area and intermediate allocations in addition to source pixels.

Benchmark small fixtures, maximum-size/noisy PNGs, long QR content, rotation, intricate masks, repeated requests, and overlapping calls. Include raw body, parsed strings, decoded bytes, RGBA buffers, integral/coverage arrays, WASM memory, SVGs, artifacts, and warm-isolate high-water memory. Keep admission limits low enough for measured peak memory with headroom; avoid buffering another maximum recipe while a render is active.

If the existing supported range does not fit, first remove redundant allocations and unused artifact materialization without changing output. Do not silently downscale or remove verification. Record the blocker and choose explicitly between a documented API-specific limit and a Worker-fronted larger compute runtime. Queues alone do not solve per-render memory pressure. A reduced range does not satisfy full editor-to-API replay parity and must be called out before declaring this plan complete.

## Sequenced implementation

### 1. Prove the runtime and rendering budget

Build the smallest local workerd entry that initializes bundled codecs and executes one real assembly using existing fixtures. Audit imports and decoder compatibility, then measure the boundary cases above. Record codec versions, CPU, peak memory, request bounds, and concurrency budget. Do not add remote infrastructure as part of this spike.

**Gate:** The Worker renders fixture PNGs with all mandatory checks passing, matches the browser WASM renderer, and has a credible measured path to the supported input envelope.

### 2. Define recipe parsing and deterministic replay

Add strict schemas, binary/base64 conversion, asset hashes, supported renderer-version dispatch, normalized settings mapping, and a request-independent render entry point. Freeze the final source mask instead of rerunning detection or font/icon generation.

**Gate:** A serialized recipe independently regenerates the same poster pixels and QR artifact; invalid inputs fail before unsafe allocations. Existing Node golden outputs and schema-8 artifacts remain byte-identical.

### 3. Attach portable export to accepted assembly

Capture inputs at assembly time, serialize inside the existing browser worker, attach the recipe under the current stale-completion boundary, and add the download action with Blob URL cleanup. Read the repository's modern-web guidance and relevant installed Next.js docs before UI implementation.

**Gate:** Assemble → export JSON works with no upload. Later draft edits, committed edits, mask replacement, source replacement, and delayed completions cannot mix a recipe with the wrong result. Smaller PNG selection does not change the original-resolution recipe.

### 4. Add the API and isolated deployment configuration

Implement the HTTP contract, bounded reader, authentication, rate/admission limits, error mapping, and binary output. Add dedicated local preview/deploy commands and generated binding types. Use the implementation date as the new Worker's compatibility date; preserve the UI Worker's date/configuration. Enable logs and traces with sensitive-data exclusions.

**Gate:** A saved recipe submitted by a separate HTTP client to the local Workers runtime returns a verified PNG. Requests share no source cache, revision, or recipe state. Browser assembly remains usable with the API unavailable.

### 5. Verify parity, document, and release

Cover uploaded/transparent blank posters; detected/custom/text/icon masks; Fill/Auto fill; all pixel and marker shapes; colors; margins/rims; rotation; fixed seeds; and multiple content/ECC combinations. Test malformed and oversized bodies, forged asset hashes, unknown versions, invalid layout, concurrent callers, codec failure, and stale browser export completion. Use fixtures and mocks; no paid calls in automated tests.

Compare exact decoded RGBA and protected pixels between browser WASM and workerd. Require byte identity when the same pinned encoder produces PNGs; investigate any differences before release. Keep Node golden bytes unchanged. Report comparisons may normalize runtime metadata and the intentional detected-mask-to-explicit-mask provenance change, while preserving schema 8 and mandatory check outcomes. Poster decode checks remain skipped and `phoneScan` remains `untested`.

Local HTTP contract tooling is implemented in `test/api/`: Hurl exercises the local Worker with browser-WASM expected fixtures, and a Postman v2.1 collection can be imported into Yaak for manual inspection. Run `pnpm test:api:smoke`, `pnpm test:api`, or the quota-isolated `pnpm test:api:limits` only when requested, per `AGENTS.md`. These HTTP cases still need an authorized run; import the collection into Yaak to verify file-body setup in the desktop app. The suite does not replace the broader workerd parity, supported-range memory, or failure-injection gates above. Update/run `e2e/editor.spec.ts` only on request.

Before release, update `README.md`, `doc/plan/web-qr-poster.md`, and durable `AGENTS.md` constraints: explain local assembly versus explicit remote replay, recipe contents, the base64 exception, API authentication, limits, privacy behavior, version support, and curl usage. Document actual preview/deploy commands and rollback. Roll out the API independently; a rollback must not silently reinterpret an unsupported recipe version. Remove this proposal after its implemented constraints have been promoted to those canonical documents.

**Acceptance:** From a fresh process, the user can submit only the exported JSON plus API credentials and receive the same verified original-resolution artistic QR poster, without access to the original editor session or separate assets.
