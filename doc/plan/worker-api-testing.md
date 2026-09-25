# Worker API testing with yaak-app-client and Hurl

Status: implementation in progress; fixtures, Hurl files, and the importable Yaak collection are in place. HTTP suite execution and Yaak desktop import remain pending. Date: 2026-09-25.

## Outcome and scope

Provide a reusable Yaak workspace for inspecting the render API manually and a Hurl suite for repeatable HTTP assertions against the real local Cloudflare Workers runtime. Both clients submit the same portable-recipe fixtures to `POST /v1/render` and exercise successful PNG responses and rejected requests.

This extends the verification work in [the QR replay API plan](cloudflare-qr-replay-api.md). It does not change editor behavior, deploy a Worker, call a paid service, or replace existing engine tests. Automated runs default to local workerd only; remote testing is a separate, explicitly requested activity.

## Current implementation

- `apps/render-api/src/index.ts` owns routing, bearer authentication, rate limiting, bounded body reading, response headers, and error mapping.
- `packages/renderer/src/recipe.ts` owns recipe versioning, embedded PNG validation, digest checking, and replay through the shared assembly pipeline.
- `apps/render-api/wrangler.jsonc` is the dedicated render Worker configuration; `pnpm dev:render-worker` starts it.
- `RENDER_API_TOKEN` is required. `RENDER_API_LIMIT` permits ten authenticated requests per minute per Cloudflare location. Validation failures consume quota because the limiter runs before media-type, artifact, and body validation.
- Limits are 28 MiB of JSON, 10 MiB per embedded PNG, and 4,000,000 pixels per image.
- `/usr/bin/yaak-app-client` and `/usr/bin/hurl` are already available in the inspected environment. Hurl reports version 8.0.1; record the Yaak application version when creating its workspace.

Use the current code as the baseline for assertions. The earlier API proposal includes responses such as 403 and 503 that the current handler does not implement. Do not add expectations for those statuses, a health route, or a `Retry-After` header without a separate contract change.

## Tool responsibilities and shared files

Yaak handles exploratory requests, environment selection, and visual inspection of PNGs and error responses. Export a native workspace from the installed app rather than guessing its serialization format. Yaak can send an entire JSON file with its Binary File body mode; explicitly set `Content-Type: application/json`. This avoids copying embedded base64 into every request. See [Yaak's large-value guidance](https://yaak.app/docs/getting-started/working-with-large-values).

Hurl owns executable status, header, JSON, and binary assertions. Use file-backed request bodies, sequential execution, bounded timeouts, and JUnit reports. Its documented response assertions include SHA-256 comparisons. See the [Hurl manual](https://hurl.dev/docs/manual.html) and [binary-response examples](https://hurl.dev/docs/samples.html).

Proposed layout:

```text
test/api/
  README.md                       # setup, case IDs, expected results, troubleshooting
  fixtures/
    baseline.recipe.json          # small, public, deterministic valid recipe
    transparent.recipe.json
    rotated.recipe.json
    expected/                     # independently captured browser PNGs and hashes
  hurl/
    smoke.hurl                    # default poster, explicit poster, standalone QR
    routing-auth.hurl
    validation.hurl
    limits.hurl
    rate-limit.hurl                # isolated run
  yaak/
    worker-api.yaak.json           # provisional name; use actual native export format
scripts/
  prepare-api-fixtures.ts          # deterministic invalid/large fixture mutations
  test-worker-api.ts               # local lifecycle, pacing, Hurl, PNG comparison
output/api-tests/                 # ignored generated fixtures, responses, reports
```

Share stable case IDs and fixture paths between the Yaak request names and Hurl files. Keep expected outcomes in a case table in `test/api/README.md`; Hurl remains the executable assertion source. Do not introduce a custom collection converter or another test framework.

## Implementation sequence

### 1. Establish local startup and fixtures

1. Start the existing render Worker locally on an explicit loopback address and port. Use a dedicated local-only token from an ignored configuration file or process binding; never overwrite an existing `.dev.vars` file. Confirm the supported secret-loading options for the installed Wrangler version before implementing the runner.
2. Poll an unknown path for the expected `404 NOT_FOUND` envelope to establish readiness without consuming render quota. Fail startup on a bounded timeout, and terminate only the process started by the runner.
3. Capture a small successful browser assembly, its exported recipe, original-resolution `poster.png`, and `qr.png`. Use public artwork or a generated local blank, fixed content/settings/seed, and the exact final `region-mask.png` embedded by the exporter.
4. Add transparent and rotated fixtures to exercise alpha preservation and the shared rotated-frame path. Include a non-default valid palette and margin/rim combination in this small set. Leave exhaustive shape combinations to existing engine tests.
5. Store fixture provenance, dimensions, settings, and expected hashes. Expected PNGs must come from the accepted browser assembly, not from the API response under test. Compare decoded RGBA as well as pinned-encoder PNG bytes; investigate differences instead of automatically regenerating expected files.
6. Generate negative fixtures by changing one property at a time. Recompute an image digest when testing PNG validation so a digest failure does not hide the intended branch. Generate large bodies only into `output/api-tests/`.

Checkpoint: one local replay returns the independently expected poster, and fixture regeneration is deterministic without network access. If workerd/WASM startup or parity fails, record the blocker before expanding the suite.

### 2. Create the Yaak workspace

Create a workspace named `mahu-QR Worker API` with folders for Success, Routing and Auth, Validation, Limits, and Rate Limit. Configure `base_url`, a private `render_api_token`, and local fixture paths. Default to the local Worker; do not include a working remote environment or credentials in the export.

Add requests corresponding to the matrix below. Set bearer authentication centrally for authenticated folders, with explicit overrides for missing/wrong-token cases. Use JSON files as raw request bodies, not multipart uploads. Document path rebinding after importing the workspace on another machine.

Manually inspect the poster and QR PNGs, their download filenames, and a representative error envelope. Send cases individually: Yaak's folder Send All runs requests concurrently, which would interfere with quota-sensitive cases. See [Yaak's multiple-request behavior](https://yaak.app/docs/advanced/running-multiple-requests).

Checkpoint: a fresh import can run the baseline and rejection requests after setting local variables, and the exported files contain no tokens, private artwork, response history, or machine-specific paths that cannot be rebound.

### 3. Implement the Hurl contract matrix

For successful responses assert status 200, `Content-Type: image/png`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, the exact attachment filename, and a UUID-shaped `X-Request-Id`. Check the body against its expected bytes/hash; decode saved PNGs with the existing imaging tools to verify dimensions and exact RGBA parity.

For errors assert the expected status and `error.code`, a nonempty `error.message`, a UUID-shaped JSON `requestId`, JSON content type, `no-store`, and `nosniff`. Error IDs currently live in the JSON body, not an `X-Request-Id` header. Avoid matching full human-readable messages or random IDs.

| Group                 | Cases                                                                                                 | Current expected result                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Successful replay     | Default artifact and explicit `artifact=poster.png`; repeat fixed recipe                              | 200, identical poster bytes                                  |
| Standalone QR         | `artifact=qr.png`                                                                                     | 200, expected QR bytes and `qr.png` filename                 |
| Rendering variants    | Transparent and rotated recipes with valid settings                                                   | 200, browser parity including alpha                          |
| Routing               | Unknown path; GET/PUT/OPTIONS on `/v1/render`                                                         | 404 `NOT_FOUND`; 405 `METHOD_NOT_ALLOWED` with `Allow: POST` |
| Authentication        | Missing token, wrong token, wrong scheme; separate Worker without configured token                    | 401 `UNAUTHORIZED`                                           |
| Auth acceptance       | Valid token, including case-insensitive Bearer scheme                                                 | Continues to normal request validation/rendering             |
| Media type            | Missing type or `text/plain`; JSON with charset parameter                                             | 415 `UNSUPPORTED_MEDIA_TYPE`; parameterized JSON accepted    |
| Artifact              | Unknown artifact, including an explicitly empty value                                                 | 400 `ARTIFACT_INVALID`                                       |
| Body parsing          | Malformed JSON and invalid UTF-8                                                                      | 400 `INVALID_JSON`                                           |
| Recipe schema         | Unsupported schema/renderer versions, missing fields, unknown strict fields, invalid settings/content | 400 `RECIPE_INVALID`                                         |
| Embedded assets       | Malformed base64, digest mismatch, declared/poster/mask dimension mismatch                            | 400 `RECIPE_INVALID`                                         |
| PNG header validation | Invalid signature, zero dimensions, APNG                                                              | 400 `PNG_INVALID` after valid digest checks                  |
| Placement/palette     | Schema-valid invalid placement or low-contrast valid-hex palette                                      | 422 `QR_LAYOUT_INVALID` / `COLOR_INVALID`                    |
| Request limit         | Actual body over 28 MiB                                                                               | 413 `REQUEST_TOO_LARGE`                                      |
| Image/schema limits   | Embedded base64 above schema maximum; source dimension above schema maximum                           | 413 `IMAGE_TOO_LARGE`                                        |
| Quota                 | Isolated authenticated burst, followed by window recovery                                             | 429 `RATE_LIMITED`; later requests admitted                  |

Include ordering cases: wrong token plus malformed body remains 401; authenticated wrong media type plus malformed body remains 415. Keep each other negative fixture valid through all preceding checks.

Document current boundary inconsistencies explicitly. A declared width/height product over 4,000,000 yields 400 `RECIPE_INVALID`; an oversized PNG IHDR can yield 400 `PNG_INVALID`; certain decoded-byte overflow cases yield 400 `RECIPE_INVALID`. Do not claim all oversize images return 413. Any normalization is separate implementation work with an intentional assertion update.

An empty HTTP payload may reach `BODY_REQUIRED` or `INVALID_JSON` depending on how workerd represents its stream. Establish the actual wire behavior before freezing that assertion. Test exact byte ceilings using otherwise parseable inputs (for example JSON plus trailing whitespace), and distinguish body-limit acceptance from successful maximum-size rendering.

Checkpoint: failures identify the case ID and assertion, and changing a status, error code, header, or output bytes causes the corresponding case to fail.

### 4. Make quota and exceptional cases reproducible

Run Hurl with one job and explicit request pacing. Sequential files alone do not enforce ten requests per minute. The runner must count all authenticated attempts across files and pause beyond a full quota window between batches of at most ten; do not retry unexpected 429 responses into apparent success. Keep Yaak idle while automation runs.

Run `rate-limit.hurl` separately after an idle window, using cheap authenticated invalid requests to consume quota without repeatedly rendering PNGs. Establish the local binding's actual behavior before asserting an exact eleventh-request cutoff. Check recovery after the window and that unauthenticated requests do not consume authenticated quota. Local behavior does not prove an exact global production quota.

Use focused local handler tests for branches that cannot reliably be triggered through a normal HTTP client: deterministic denied limiter results, renderer exceptions, mandatory verification failures, and streamed overflow without `Content-Length` if Hurl cannot reproduce it. Keep the real workerd happy path unmocked. Do not add production fault-injection routes or weaken authentication, rate limits, or verification to make tests pass.

Checkpoint: a complete local run and a consecutive rerun are repeatable, and resource failures remain visible instead of being mislabeled as expected validation errors.

### 5. Add commands, reports, and documentation

Add proposed commands `test:api` (local startup plus the normal Hurl suite), `test:api:smoke`, and `test:api:limits` (isolated quota and large-body cases). The scripts should check tool availability, fix fixture path resolution independently of the caller's directory, bound startup/request/shutdown time, and propagate nonzero exit codes.

Write JUnit results and downloaded images under `output/api-tests/`. Avoid verbose authorization/body dumps. Use local-only credentials for repeatable automation and private environment values for manual use. No request handler invokes a CLI or writes test files; these operations belong exclusively to the external test runner.

Update `README.md` and `doc/plan/web-qr-poster.md` with the actual API testing commands and Yaak import steps when implemented. Follow `AGENTS.md`: general tests, typecheck, builds, and browser journeys run only when explicitly requested. This planning task runs no API suite, build, deployment, or paid call.

## Acceptance and completion

- A maintainer can import the Yaak workspace and reproduce the documented success and rejection cases using the shared fixtures.
- One documented command exercises the actual local render Worker with Hurl and produces an actionable report.
- Poster and QR output match independent browser fixtures; default palette golden bytes and schema-8 reports remain unchanged.
- Tests cover authentication, routing, request validation, image integrity, placement/palette errors, limits, and quota behavior without accidental rate-limit failures.
- No credentials or private data are committed, and automation makes no remote or paid calls.
- Remaining workerd feasibility or maximum-size failures are recorded as unresolved; HTTP smoke success does not close the broader runtime-budget gate in the replay API plan.

After implementation and requested verification, promote durable testing constraints into the canonical docs and `AGENTS.md`, update the related API proposal's verification status, and remove this completed plan. Keep it while any planned work remains unimplemented.
