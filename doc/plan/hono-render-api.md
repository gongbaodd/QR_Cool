# Rewrite the render API with Hono

Status: implemented 2026-09-26, pending verification (the gated `pnpm test:api*` suites and `pnpm typecheck` run on maintainer request). Remove this plan once verified.

## Goal

Use Hono for routing and request composition in the independently deployed `apps/render-api/` Worker. Keep recipe validation and rendering in `@mahu-qr/renderer`; this is an HTTP-layer rewrite, with the current public API and PNG bytes preserved.

The current baseline is `apps/render-api/src/index.ts`, including the staged `GET /health` endpoint. `README.md` also has staged health documentation. Preserve those changes while implementing this plan.

## Contract to preserve

| Request                       | Existing behavior                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                 | Public `200` JSON `{"status":"ok"}` with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Other methods return an empty `405` with `Allow: GET`. This is liveness only.                                                   |
| `POST /v1/render`             | Bearer auth, then the `RENDER_API_LIMIT` binding, then media type and `artifact` checks, then a bounded UTF-8 JSON read, recipe validation, and shared rendering. Default artifact is `poster.png`; `qr.png` is the other accepted value. |
| Other methods on `/v1/render` | `405` JSON `METHOD_NOT_ALLOWED` with `Allow: POST`, before authentication or quota use.                                                                                                                                                   |
| Other paths                   | `404` JSON `NOT_FOUND`, including the test runner's `/__api_test_ready__` probe. Do not normalize trailing slashes into known routes.                                                                                                     |
| Errors                        | Preserve status, code, message, `requestId` JSON shape, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Preserve the existing Zod, PNG guard, renderer, and unexpected-error mappings. Do not log request content.      |
| Success                       | The exact verified PNG bytes from `renderRecipe`, `image/png`, `Content-Disposition` with the selected filename, `X-Request-Id`, `no-store`, and `nosniff`.                                                                               |

Retain the 28 MiB request limit on both declared length and streamed bytes, strict UTF-8 decoding, the 10 MiB/4-megapixel PNG guards, timing-safe bearer verification, and the current ten-per-minute-per-location limiter binding. Authentication must not read the body; failed auth must not consume quota. Authenticated validation failures do consume quota. No CORS or new route is part of this change.

## Design

1. Add `hono` only to `apps/render-api/package.json` using the root pnpm workspace and update the single root lockfile. Keep `apps/render-api/wrangler.jsonc`, the package boundary, and the renderer imports. Import `@mahu-qr/renderer/worker-shim` before decoder modules.
2. Build one typed Hono app in `apps/render-api/src/index.ts`, exported as the Worker entry. Use Hono's strict path matching, `get('/health')`, `post('/v1/render')`, and a top-level `notFound` handler. Put an explicit method guard on each known path so Hono's default 404 and automatic `HEAD` handling cannot change the existing 405 contract. Keep the guard ahead of auth, and check the original request method for `HEAD` on `/health`.
3. Give each request a UUID in request-scoped Hono context. Compose render-route checks in the existing order: method, auth, rate limit, content type, artifact, bounded body, JSON parse, imaging readiness, render. Small route-specific middleware or helpers are appropriate; do not add a generic API framework, a second validation schema, or Hono's default bearer/body parsers if they change error shapes or buffer an unchecked request body.
4. Reuse the existing bounded reader, token hashing and comparison, limiter key, and error mapping. Centralize API error responses through Hono's `onError` and `notFound` hooks where they preserve the contract. The bounded reader must remain the only path that consumes recipe JSON; `c.req.json()` is unsuitable before its byte and UTF-8 checks. Return the renderer's PNG bytes directly, without re-encoding.
5. Type `c.env` from Wrangler-generated bindings where practical (`wrangler types --env-interface CloudflareBindings`), accounting for the secret supplied outside `wrangler.jsonc`. Keep generated types scoped to `apps/render-api/`; do not hand-copy the rate-limit binding shape into another app. If Wrangler does not include the secret in generated types, add only a narrow local declaration for that secret.

Hono's [Workers integration](https://hono.dev/docs/getting-started/cloudflare-workers) supports exporting the app directly and binding access through `c.env`. Its [middleware order](https://hono.dev/docs/guides/middleware) follows registration order, so route checks must be registered deliberately. Hono's [strict routing](https://hono.dev/docs/api/hono#strict-mode) preserves `/v1/render` versus `/v1/render/`; its [automatic HEAD handling](https://hono.dev/docs/guides/best-practices#head-request-best-practices) requires the explicit compatibility check above.

## Build sequence and checkpoints

1. **Record the baseline.** Read the staged health changes and the existing Hurl assertions in `test/api/`. List the response details above as the parity target. Keep the committed expected PNG hashes and recipe fixtures unchanged.
2. **Replace the HTTP shell.** Add Hono, route the two known paths, register request ID and error handling, then move the existing auth, quota, body guard, and render call behind `POST /v1/render`. Keep the Worker-only secret and rate-limit binding in the existing config. Check that a route or middleware short circuit cannot skip a required header or change error priority.
3. **Extend contract coverage.** Add Hurl cases for `GET /health`, non-GET `/health`, `HEAD /health`, `HEAD /v1/render`, exact paths with trailing slashes, and method-before-auth priority. Retain the smoke fixture SHA-256 assertions for poster, QR, transparent, and rotated outputs. Keep the existing malformed JSON/UTF-8, oversized streamed body, image limit, and quota cases. Add a focused handler check only if Hurl cannot exercise a particular streamed-overflow or thrown-error branch; do not add production fault routes.
4. **Verify when implementation is requested.** `AGENTS.md` requires an explicit maintainer request before running `pnpm test:api:smoke`, `pnpm test:api`, `pnpm test:api:limits`, `pnpm typecheck`, `pnpm test`, or `pnpm build`. When requested, run the API suites against local workerd, compare all response contracts and PNG hashes, then run the requested broader checks. No production call or fixture regeneration is needed for an HTTP-only rewrite.
5. **Update shipped documentation.** Once the rewrite lands, update `README.md` and `doc/plan/web-qr-poster.md` to describe Hono ownership of the Worker HTTP layer, while preserving the staged health documentation. Update `test/api/README.md` for any added contract cases. Promote durable constraints to `AGENTS.md` and remove this completed plan after the implementation is verified.

## Acceptance

- The Worker entry is a Hono app, and `apps/web/` and `packages/renderer/` need no source changes.
- Every existing Hurl assertion and the added health/HEAD/path cases pass in local workerd; the response PNG hashes match the existing manifests.
- Auth, quota, body limits, error shapes, request IDs, and response headers retain their current order and values.
- The root lockfile is the only lockfile changed; no renderer fixture, recipe schema, or golden output changes.
