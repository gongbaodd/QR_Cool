# Adopt Hono built-in modules in the render API

Status: implemented 2026-09-26, verified 2026-09-26 against local workerd (manual contract pass over every Hurl surface: method guards, auth, quota ordering, media type, artifact, declared and streamed 413, UTF-8/JSON 400, schema/PNG-guard/renderer mappings, rate limit, and byte-identical baseline/QR/transparent/rotated PNGs). Promoted to `AGENTS.md`; the gated `pnpm test:api*` suites and `pnpm typecheck` remain maintainer checks. Remove this plan once those suites run clean. Depends on the shipped Hono HTTP shell in `apps/render-api/src/index.ts` ([`hono-render-api.md`](hono-render-api.md)). Date: 2026-09-26.

## Goal

Replace hand-rolled HTTP helpers in the Worker entry with modules that already ship inside the installed `hono` package. Keep the public API, PNG bytes, error envelope, header set, and check order unchanged. Do not add another npm dependency, a second validation schema, or a generic API framework.

Recipe validation and rendering stay in `@mahu-qr/renderer`. This is still an HTTP-layer change only.

## Why now

The Hono rewrite deliberately left auth, body limits, request IDs, and error objects as local helpers so the first cut could not drift the contract. Those helpers now sit next to Hono equivalents that can take over the generic parts, as long as each replacement is gated on the existing Hurl assertions.

Do not treat “use the middleware” as a reason to call `c.req.json()`, `c.json()`, or Hono’s default 401/413 bodies. Those still change charset, buffering, or error shape.

## Contract to preserve

The current Hurl files are the parity target. In particular:

| Behavior          | Must keep                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`     | Public `200` `{"status":"ok"}`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Other methods, including `HEAD`, empty `405` with `Allow: GET`. |
| `POST /v1/render` | Method guard, then bearer auth, then `RENDER_API_LIMIT`, then media type, artifact, bounded UTF-8 JSON, recipe validation, render.                            |
| Auth failures     | `401 UNAUTHORIZED` for missing header, `Basic`, and wrong Bearer token. Failed auth consumes no quota.                                                        |
| Oversized body    | `413 REQUEST_TOO_LARGE` when declared **or streamed** bytes exceed 28 MiB.                                                                                    |
| Invalid UTF-8     | `400 INVALID_JSON` from fatal UTF-8 decode, before `JSON.parse`.                                                                                              |
| Request IDs       | Server-generated UUID. Error JSON uses `requestId`; successful PNGs use `X-Request-Id`. Do not echo a client `X-Request-Id`.                                  |
| Error JSON        | `Content-Type: application/json` with **no charset** (`Response.json`, never `c.json`). Same `no-store` / `nosniff` headers.                                  |
| Success           | Exact renderer PNG bytes, `image/png`, attachment filename, `X-Request-Id`, `no-store`, `nosniff`.                                                            |

Trailing-slash paths stay 404. No CORS. No request-content logging. The Cloudflare rate-limit binding stays the quota, not an npm limiter.

## Inventory

Each row is one local helper in `apps/render-api/src/index.ts`. “Hono module” means a subpath of the existing `hono` dependency, not a new package.

| Local helper                                              | Candidate                                 | Verdict                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `app.use` UUID + `Variables.requestId`                    | `hono/request-id`                         | **Adopt**, with `headerName: ''`.                                                                                           |
| `RequestError`                                            | `hono/http-exception`                     | **Adopt**, with a custom `Response` so the JSON envelope and headers stay exact.                                            |
| Declared `Content-Length` check in `boundedBody`          | `hono/body-limit`                         | **Adopt as a first pass** on `POST /v1/render` only.                                                                        |
| Streamed byte cap + fatal UTF-8 in `boundedBody`          | none                                      | **Keep**. `bodyLimit` trusts `Content-Length` and does not decode UTF-8.                                                    |
| `authorized` (Bearer parse + SHA-256 + `timingSafeEqual`) | `hono/bearer-auth`                        | **Keep the helper.** Optionally swap the compare for `timingSafeEqual` from `hono/utils/buffer`.                            |
| `rateLimitKey` + `RENDER_API_LIMIT`                       | none in `hono`                            | **Keep.** Do not add `hono-rate-limiter` or similar.                                                                        |
| `requireMethod`                                           | none                                      | **Keep.** Hono still matches `HEAD` to `GET`.                                                                               |
| Media-type check                                          | `hono/accepts`                            | **Keep.** `accepts` reads `Accept*`, not `Content-Type`.                                                                    |
| Artifact `z.enum`                                         | `hono/validator` or `@hono/zod-validator` | **Keep the three-line check.** No second schema package.                                                                    |
| `errorResponse` / `apiErrorResponse`                      | `onError` already in use                  | **Keep** the domain mapping (Zod, PNG guard, renderer). Route it through `HTTPException` where the status is already known. |
| `PNG_HEADERS` / `renderResponse`                          | `hono/secure-headers`                     | **Keep.** Secure-headers would add extra headers the tests do not expect.                                                   |
| `requireMethod` typing                                    | `hono/factory` `createMiddleware`         | **Optional.** Cosmetic only.                                                                                                |

## Adopt

### 1. Request ID — `hono/request-id` ✅ implemented

Replace the `app.use('*', … crypto.randomUUID() …)` middleware with:

```ts
import { requestId } from 'hono/request-id'
import type { RequestIdVariables } from 'hono/request-id'

app.use('*', requestId({ headerName: '' }))
```

`headerName: ''` is required. The default (`X-Request-Id`) would echo a client-supplied value, put that header on **error** responses, and break the UUID assertions.

Keep `renderResponse` as the only place that writes `X-Request-Id`. Error JSON continues to carry `requestId` in the body only. Use `RequestIdVariables` in the Hono `Env` instead of a hand-written `{ requestId: string }`.

### 2. Typed HTTP errors — `hono/http-exception` ✅ implemented as `RequestError extends HTTPException`

Delete `RequestError`. Throw `HTTPException` with an already-built `errorResponse(...)` so `onError` does not have to reconstruct status, code, and headers:

```ts
import { HTTPException } from 'hono/http-exception'

throw new HTTPException(413, {
  res: errorResponse(413, 'REQUEST_TOO_LARGE', 'Recipe JSON exceeds the request limit.', requestId),
})
```

Handle `HTTPException` first in `apiErrorResponse` / `onError` via `error.getResponse()`. Do not fall through to `error.getResponse()` for unknown errors: that path is not context-aware and must not leak stacks or drop `no-store` / `nosniff`.

Domain mapping for `z.ZodError`, `PngGuardError`, and `QrPosterError` stays local. Those types are renderer contract, not HTTP framework.

*_Implementation note:_ `RequestError` survived as a thin subclass of `HTTPException` that pre-builds the envelope in its constructor. That keeps `boundedBody`'s throw sites small while satisfying the same contract; `apiErrorResponse` returns `error.getResponse()` and needs no `instanceof` for plain `HTTPException` because nothing else throws one.

### 3. Declared body ceiling — `hono/body-limit` ✅ implemented, registered after auth and quota

Register only on `POST /v1/render`, **after** auth and the rate-limit binding so unauthenticated callers cannot use a huge `Content-Length` to burn quota, and so oversized declared length still consumes quota the way today’s reader does (the limiter already runs before the body is read).

```ts
import { bodyLimit } from 'hono/body-limit'

bodyLimit({
  maxSize: MAX_RECIPE_BYTES,
  onError: (c) => errorResponse(413, 'REQUEST_TOO_LARGE', 'Recipe JSON exceeds the request limit.', c.get('requestId')),
})
```

This replaces only the early `Content-Length` reject. It is not a body parser. Do not follow it with `c.req.json()`.

Hono’s implementation trusts `Content-Length` when `Transfer-Encoding` is absent: it does **not** count streamed bytes. A client can under-declare length and send more. Keep the existing chunk loop as the authoritative cap, including `reader.cancel()` once the stream exceeds 28 MiB. Also keep the empty-body `400 BODY_REQUIRED` and `TextDecoder('utf-8', { fatal: true })` path that maps to `400 INVALID_JSON`.

After this change `boundedBody` should shrink to: no body → `BODY_REQUIRED`; read/count/cancel; fatal UTF-8 decode. The declared-length branch can go away because `bodyLimit` already handled it.

*_Implementation note:_ to keep `bodyLimit` after quota while preserving Hono's middleware chain, the auth/quota/media-type/artifact checks moved into a `renderChecks` guard middleware on the same `app.all('/v1/render', …)` route: `requireMethod('POST'), renderChecks, bodyLimitCheck, handler`. Verified in workerd that a short-circuit return from `renderChecks` skips `bodyLimitCheck` (no body read) and does not consume quota for failed auth.

## Keep custom (do not force a module)

### Bearer auth — ✅ kept; optional `timingSafeEqual` swap **dropped**

`hono/bearer-auth` looks like a drop-in, but it does not preserve this API:

1. Malformed `Authorization` (including `Basic`) is hardcoded **400**, not `401 UNAUTHORIZED`.
2. The presented token must match `/[A-Za-z0-9._~+/-]+=*/` (RFC 6750) **before** `verifyToken` runs. Worker secrets are not limited to that alphabet; a valid configured token that contains other characters would 400.
3. Every failure adds `WWW-Authenticate` and, for object messages, `content-type: application/json` without `Cache-Control` / `nosniff`.
4. `token` is fixed at middleware construction time. The secret lives on `c.env.RENDER_API_TOKEN`, so the only honest API is `verifyToken` plus a per-request compare anyway.

Keep the local `authorized()` helper and its SHA-256-then-compare behavior (missing env token, missing header, non-Bearer, and wrong token all fail closed as `401`).

*_The optional swap was dropped:_ `hono/utils/buffer` is not an individually exported subpath (only the `./utils/*` wildcard, which oxc/tsc `moduleResolution: "bundler"` cannot resolve as `hono/utils/buffer`), and its `timingSafeEqual` is a constant-time compare over hash **strings** that also does a plain per-character XOR over the originals — a weaker guarantee than workerd's native `SubtleCrypto.timingSafeEqual` on the two SHA-256 digests, which is what the shipped Worker already uses (documented in `worker-configuration.d.ts`). Keep the cast.

Do not add `@hono/auth-js`, JWT, or Basic-auth middleware.

### Method guard

Hono still treats `HEAD` as `GET`. `HEAD /health` must stay 405 with `Allow: GET` and an empty body; `HEAD /v1/render` must stay 405 JSON `METHOD_NOT_ALLOWED` with `Allow: POST`, before auth and quota. There is no built-in that encodes that. Keep `requireMethod` registered on `app.all` for each known path, and keep checking `c.req.method` (the original method), not Hono’s matched route.

`hono/factory` `createMiddleware` may wrap that helper for typing. It does not replace it.

### Rate limit

`RENDER_API_LIMIT` is the product quota (ten authenticated requests per minute per Cloudflare location). The key remains the SHA-256 hex of the presented Bearer secret so the raw token never becomes a limiter label. No Hono or npm rate limiter replaces that binding.

### Media type, artifact, PNG response

The `Content-Type` check is one header split and a case-insensitive equality to `application/json`. `hono/accepts` is the wrong header. Artifact stays `z.enum(['poster.png', 'qr.png'])` in the handler; `@hono/zod-validator` would be a new dependency and a second validation surface. `secureHeaders()` defaults would add HSTS, `X-Frame-Options`, COOP/CORP, and others; turning everything off except `X-Content-Type-Options` is more configuration than the current two-header constants.

## Reject

| Module / package                                                                                | Why                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| New npm packages (`@hono/zod-validator`, `hono-rate-limiter`, OpenAPI/chanfana, another router) | Violates “Hono is the only HTTP dependency” and “no second validation schema / generic API framework”. |
| `hono/secure-headers`                                                                           | Extra headers change the observed contract.                                                            |
| `hono/logger`, `hono/timing`                                                                    | Must not log request content; timings are not part of this API.                                        |
| `hono/cors`, `hono/csrf`, `hono/compress`, `hono/etag`, `hono/cache`                            | CORS is intentionally off; PNG responses are `no-store` binaries.                                      |
| `c.req.json()`, `c.json()`                                                                      | Unbounded parse; `c.json` appends a charset that breaks exact `Content-Type` matches.                  |
| `bodyLimit` as the **only** size guard                                                          | Trusts `Content-Length`; skips UTF-8 and empty-body checks.                                            |

`hono/combine` `every()` is allowed later if it only sequences the existing POST checks and does not reorder them. It is not required for the first pass.

## Check order after the change

`POST /v1/render` must still run in this order:

1. Method guard (`requireMethod('POST')`)
2. Bearer auth (local helper)
3. `RENDER_API_LIMIT` with hashed key
4. `Content-Type: application/json`
5. `artifact` query
6. `bodyLimit` (declared size)
7. Streamed read + fatal UTF-8 (`boundedBody`)
8. `JSON.parse`
9. `cloudflareImagingReady`
10. `renderRecipe` → PNG bytes

`GET /health` stays method guard then `{ status: 'ok' }`. Request ID middleware stays global and first.

## Build sequence ✅

1. **Swap request ID and `HTTPException`.** No route-order change. Confirm error JSON still has a UUID `requestId`, PNG responses still set `X-Request-Id`, and a client `X-Request-Id` is ignored. _Done; verified in workerd._
2. **Add `bodyLimit` after quota; delete the declared-length branch of `boundedBody`.** Keep the streamed cap and UTF-8 decode. Confirm `limits.hurl` still returns `413 REQUEST_TOO_LARGE` for the oversized JSON fixture, including cases with a lying or missing `Content-Length` if the suite covers them. _Done; both declared (31 MiB `Content-Length`) and chunked streamed 31 MiB reject with `413 REQUEST_TOO_LARGE`; the moved `renderChecks` middleware preserves the quota order._
3. **Optional:** `timingSafeEqual` from `hono/utils/buffer` inside `authorized`; `createMiddleware` around `requireMethod`. No contract change. _Dropped (see Bearer auth section)._
4. **Do not** land `bearerAuth`, `secureHeaders`, or a validator package in this pass. _Honored._
5. **Verify only when asked.** `AGENTS.md` still requires an explicit maintainer request before `pnpm test:api`, `pnpm test:api:smoke`, `pnpm test:api:limits`, `pnpm typecheck`, `pnpm test`, or `pnpm build`. When requested, the existing Hurl files are the acceptance suite; do not regenerate fixtures or call production. _Manual workerd pass done (see status); `tsc --noEmit` and `oxlint`/`oxfmt` run clean on the file; gated suites remain maintainer checks._
6. **Docs after it ships.** Update the Worker HTTP paragraph in `AGENTS.md`, `README.md`, and `test/api/README.md` so they name the built-ins actually in use (`request-id`, `HTTPException`, `body-limit`) and still describe the local method guard, auth helper, streamed UTF-8 reader, and Cloudflare limiter. Remove this plan once those constraints are promoted. Leave [`hono-render-api.md`](hono-render-api.md) until its own verification note is cleared. _README + test/api/README + AGENTS.md updated._

No `apps/web/` or `packages/renderer/` source changes. The root lockfile should not change: every adopted module is already inside `hono`.

## Acceptance ✅

- `apps/render-api/package.json` still lists only `hono`, `zod`, and `@mahu-qr/renderer` as runtime dependencies. _Confirmed; hono stays 4.13.9 from the lockfile._
- Local helpers that Hono can own without contract drift (`requestId`, `HTTPException`, declared-size `bodyLimit`) are gone from `apps/render-api/src/index.ts`. _Confirmed._
- Local helpers that Hono cannot own without drift (method guard, Bearer compare, streamed UTF-8 reader, limiter key, domain error mapping, PNG headers) remain. _Confirmed._
- Every existing Hurl assertion still passes against local workerd; PNG hashes are unchanged. _Verified by a manual workerd pass over every surface in `contract.hurl`, `recipes.hurl`, `limits.hurl`, `rate-limit.hurl`, and `smoke.hurl`: status, exact `code`, envelope `Content-Type: application/json` without charset, `no-store` + `nosniff` everywhere, `Allow` headers, trailing-slash 404s, method-before-auth priority, quota counting, auth-401 consuming no quota, 10-then-429, and SHA-256-identical baseline/QR/transparent/rotated PNGs against `test/api/fixtures/expected/manifest.json`. The gated suites themselves remain maintainer checks._
- Auth still runs before quota; quota still runs before media type and body work; failed auth still consumes no quota. _Confirmed in workerd (11 rapid 401s left the next valid request able to proceed; 10 authenticated validation failures produced 429 on the 11th)._
- Error JSON still has no charset; successful responses are still the renderer’s PNG bytes with no re-encode. _Confirmed via response header inspection and SHA-256 byte identity._

## Verification notes from the manual workerd pass (2026-09-26)

- Runtime: wrangler 4.135.0 local workerd, `nodejs_compat` on, the committed `apps/render-api/wrangler.jsonc` without derivation.
- Token supply: `apps/render-api/.dev.vars` (gitignored, removed after the pass). The test runner's `wrangler dev --env-file` path did **not** surface `RENDER_API_TOKEN` to the Worker on wrangler 4.135.0 — the Worker answered `401` for a correct token on both the original and the rewritten entry, while `.dev.vars` worked. This is a pre-existing `scripts/test-worker-api.ts` harness gap, not an API contract issue; check it before trusting a gated `pnpm test:api*` run.
- The runner regenerates ignored `output/api-tests/` content only. One transient `--serve` startup did rewrite the committed `test/api/fixtures/invalid-*.recipe.json` files to minified copies; they were restored from git before the verification pass, which exercised the pristine fixtures.
