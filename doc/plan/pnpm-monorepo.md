# Plan: Separate the web editor and render API with pnpm workspaces

Status: proposed; no application or deployment changes made.

## Recommendation

Convert this repository into a small pnpm workspace with two applications and one private shared renderer package. Keep one Git repository and one lockfile. The benefit is clearer dependency, runtime, and configuration ownership while renderer changes remain atomic across both applications.

The current structure is workable and already supports independent deployments. A monorepo will not inherently improve rendering speed, lower Cloudflare costs, or create deployment isolation that is currently missing. It does add package manifests, explicit exports, and build-path maintenance. In this project that cost is justified because the render API already depends on substantial reusable code housed under editor-specific paths.

Use pnpm's existing workspace support; defer Turborepo, Nx, package publishing, and a separate repository. There are only two deployable applications, and filtered pnpm scripts are sufficient initially. pnpm 10 supports a root `pnpm-workspace.yaml` and explicit `workspace:*` dependencies between local packages. [pnpm 10 workspace documentation](https://pnpm.io/10.x/workspaces)

## Current coupling

- The root `package.json` mixes Next.js, React, StyleX, browser interaction libraries, renderer dependencies, Wrangler, and test tooling. One TypeScript configuration includes both applications.
- `wrangler.jsonc` deploys the editor as `mahu-qr`; `wrangler.render.jsonc` deploys the API as `mahu-qr-renderer`. Preserve both identities and deployment paths.
- `src/worker-api/index.ts` imports the PNG guard and worker compatibility shim from `src/lib/editor/`, plus the recipe implementation from `src/lib/recipe/recipe.ts`.
- Recipes depend on `src/lib/editor/schema.ts` and `src/lib/editor/engine/pipeline.ts`. The pipeline is already environment-independent and uses the shared `src/core/` algorithms through the imaging seam.
- `src/lib/editor/engine/` also contains the reusable session engine, error mapping, and input/output types. Its cache and revision logic should move without redesign. Zustand, Comlink wiring, and browser interaction remain application concerns.
- Next/Turbopack and vinext/Vite have separate WASM and StyleX build handling. Cloudflare initializes the same codecs from bundled WASM modules, whereas the browser loads emitted asset URLs.
- `scripts/test-worker-api.ts` assumes a root Wrangler executable and rewrites literal configuration paths. `scripts/prepare-api-fixtures.ts` derives fixture paths from `process.cwd()`. Moving folders alone would break this tooling.

## Target layout

```text
apps/
  web/                         # @mahu-qr/web
    src/app/                   # Includes GET /api/icons and static metadata assets
    src/components/
    src/styles/
    src/lib/editor/            # Store, reducer, selectors, masks, UI helpers
      worker/                  # Comlink entry point and browser worker client
    public/                    # Brand and font assets, moved byte-for-byte
    package.json
    tsconfig.json
    next.config.ts
    next-env.d.ts
    vite.config.ts
    babel.config.json
    postcss.config.mjs
    wrangler.jsonc
  render-api/                   # @mahu-qr/render-api
    src/index.ts
    package.json
    tsconfig.json
    wrangler.jsonc
packages/
  renderer/                    # @mahu-qr/renderer; private, source TypeScript
    src/core/                  # Existing algorithms and imaging backends
    src/engine/                # Existing platform-independent engine
    src/schema.ts
    src/png-guard.ts
    src/recipe.ts
    src/worker-shim.ts
    src/types/                 # Shared declarations as appropriate
    package.json
    tsconfig.json
test/                          # Existing unit/parity and API contract suites
e2e/                           # Existing browser journeys
scripts/                       # Repository test, fixture, and benchmark tools
source/                        # Existing source fixtures
doc/
package.json                   # Command aliases and repository tooling
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
tsconfig.json                  # Repository tooling/tests; no Next plugin
vitest.config.ts
playwright.config.ts
cucumber.mjs
```

Keep tests and their fixtures at their current repository paths for the initial migration. This limits unrelated churn and preserves the Yaak/Hurl fixture workflow. Shared lint, formatting, Husky, and lint-staged configuration stay at the repository root. Do not create separate UI, schema, imaging, or configuration packages until another consumer needs an independent boundary.

## Package boundaries

Both applications depend on `@mahu-qr/renderer` through `workspace:*`. Neither application imports the other. The renderer must not import from either application, use their `@/` aliases, or depend on React, Next.js, Zustand, Motion, Comlink, or HTTP request handling.

Move `src/core/`, all of `src/lib/editor/engine/`, the shared schema and PNG guard, the recipe implementation, and the ZXing worker shim into the renderer. Move the engine intact first: extracting it is sufficient, and this migration should not rewrite its session cache or stale-completion semantics. Keep `EditorEngineApi` as a plain typed interface; actual Comlink exposure remains in `apps/web`.

Use relative imports within the renderer and explicit exported subpaths between packages. Define the export list from actual consumers: core geometry/palette/types/errors, schema, PNG guard, engine, pipeline, recipes, imaging types/registration, and each runtime backend. Do not expose a broad barrel that eagerly imports every backend. The API should import recipes and its codec initialization directly, without evaluating the editor session engine. Move recipe input types to a neutral type module if needed to preserve a type-only dependency and avoid a runtime cycle.

Keep separate explicit entry points for browser imaging, Cloudflare imaging, Node imaging, and the worker shim. Import the shim before decoder modules in both worker entry points, and preserve this side effect in package metadata. Preserve the single imaging registry instance within each runtime; avoid resolving the same code through both package imports and copied source aliases.

Dependency ownership:

| Owner              | Dependencies and responsibility                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app            | Next, React, StyleX, UI libraries, Zustand/Zundo, Comlink; Next and vinext/Vite build configuration                                                |
| Render API         | Shared renderer, directly imported validation dependencies such as Zod, Wrangler; routing, auth, bounded request reads, rate limiting, HTTP errors |
| Renderer           | uqr, Zod, ZXing, jsQR, jSquash, resvg; geometry, rendering, verification, schemas, recipes, session engine                                         |
| Repository tooling | Vitest, Playwright, Cucumber, tsx, lint/format tools and script dependencies; declare every direct import explicitly                               |

Keep `sharp` development-only for Node imaging/tests/scripts, with an explicit declaration wherever tooling resolves it. Never import the Node backend from a runtime-neutral export. Audit direct dependency ownership, including WASM imports and fixture scripts using `require.resolve`, under pnpm's isolated dependency layout; do not fix missing declarations by enabling broad hoisting.

Use private source-TypeScript exports initially, with consuming bundlers compiling the renderer. This avoids a second generated library artifact and watch process. The installed Next documentation says Turbopack handles workspace package transpilation automatically; add `transpilePackages` only if a demonstrated build requirement calls for it. Validate vinext and Wrangler separately. [Next.js package transpilation documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)

## Migration sequence

### 1. Establish the workspace and renderer boundary

Add `apps/*` and `packages/*` to `pnpm-workspace.yaml`. Retain Node 22+, pnpm 10.33.2, the existing dependency versions, build-script allowlist, and `roughjs` override. Keep one root lockfile; review dependency-resolution changes separately from workspace importer changes.

Extract the renderer while the web app can temporarily remain at the root. Rewrite internal aliases, add explicit exports, and update both consumers and test/script imports. Temporary application re-exports may keep an intermediate commit reviewable, but remove them before completion. Do not leave a package-to-app back-reference.

Split TypeScript configuration into shared strict compiler options and environment-specific configurations. Keep Next's plugin, generated types, JSX settings, and `@/*` alias in the web application. Check the Worker and renderer independently; do not let an API typecheck depend on generated `.next` files. Type-check browser and Cloudflare WASM entry points with the appropriate declarations: URL strings and `WebAssembly.Module` are different contracts.

Checkpoint: the import graph has no renderer-to-app edges, no app-to-app edges, and no accidental backend initialization through a barrel export.

### 2. Move the applications and preserve build behavior

Move the API entry and render Wrangler config into `apps/render-api`. Move the remaining web source, `public`, and web build configs into `apps/web`. Preserve the existing `/api/icons` route and all asset URLs. Do not regenerate mascot images, fonts, PNG goldens, or recipes as part of the move.

Update StyleX's Babel aliases, PostCSS scan paths, Vite source-root handling, and configuration-relative paths. Preserve the web worker module format, top-level WASM initialization, Vite's nested-worker WASM plugin, and Turbopack asset rules. Ensure Turbopack's root includes the shared package; the root lockfile should support automatic detection, with an explicit root only if needed. Read the installed Next guides and use `modern-web-guidance` before any frontend implementation changes.

Keep generated web output local to `apps/web` (`.next`, `dist`, `.wrangler`), and API Wrangler state local to its app except for the isolated test harness. Update ignore rules for nested generated directories and local environment variants. Move local API configuration guidance to `apps/render-api/.dev.vars`; keep secrets scoped to the render Worker and out of the web environment.

Checkpoint: each app owns its config and dependencies, and neither requires building the other to start or bundle.

### 3. Preserve commands and repair repository tooling

Keep existing root commands as explicit forwarding scripts. `pnpm dev`, `build`, and `start` continue to target the web app; `dev:vinext`, `build:vinext`, `preview:workers`, and `deploy:workers` retain their meanings. `dev:render-worker` and `deploy:render-worker` target the API. Use filtered package scripts, and forward CLI arguments such as Playwright's `--hostname`. Do not add a root command that implicitly deploys both Workers.

Root `typecheck` should cover both applications, the renderer, and repository test/script imports. Root `test` retains the existing test suite. Preserve all API, BDD, browser-test, lint, and format entry points; adapt Cucumber's executable resolution and Playwright's server command to package ownership.

Keep API test runs rooted at the repository and write only under ignored `output/api-tests/`. Replace the API runner's assumptions about `node_modules/wrangler`, config location, entry-point strings, and temporary config-relative paths. Resolve Wrangler from its owning package and ensure the generated test config uses the API's intended TypeScript configuration. Keep loopback binding, fresh local tokens, isolated rate-limit state, and no reading of project secrets.

Make fixture/benchmark scripts resolve repository assets deliberately rather than relying on a filtered script's working directory. Keep committed `test/api/fixtures/`, expected PNGs, Hurl files, and Yaak collection usable at their existing paths. Update Vitest aliases to point editor imports at the web application and renderer imports at package exports; preserve Node backend setup and parity harness initialization.

Checkpoint: existing documented commands remain usable from the repository root; test tooling does not import obsolete `src/` locations or write artifacts into application source folders.

### 4. Preserve independent deployments and finish documentation

Keep Worker names, routes, compatibility dates/flags, assets binding, API secret name, CPU limit, observability settings, and rate-limit namespace unchanged. Web preview/deployment must use the newly located vinext-generated `apps/web/dist/server/wrangler.json`; API deployment must select its own config explicitly.

If Workers Builds is connected, set each build root to its application directory and ensure installation can access the root workspace and lockfile. Watch the app's own directory plus `packages/renderer/**`, root dependency/workspace/TypeScript configuration, and relevant build tooling. A shared renderer change must trigger both consumers; a web-only change should not force an API deployment. Dashboard build configuration is not visible in this checkout and must be checked during implementation. Cloudflare documents separate Worker roots, commands, and watch paths for a shared repository. [Cloudflare monorepo deployment guidance](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)

Update `README.md`, `doc/plan/web-qr-poster.md`, `test/api/README.md`, and `AGENTS.md` to record shipped paths, commands, ownership, and runtime invariants. Update active deployment/API plans that would otherwise give incorrect paths; label historical paths as historical where appropriate. Once the migration ships and its durable constraints are promoted, remove this completed plan according to repository policy.

## Acceptance and verification

Implementation is complete when both apps consume the same renderer package, build and deploy independently, and preserve all existing behavior. No algorithm changes, dependency upgrades, recipe version bumps, or new runtime services belong in this migration.

The following are future verification gates, not commands authorized by this planning request. Run tests, typechecks, builds, API checks, fixture regeneration, and E2E only when the maintainer explicitly requests them, as required by `AGENTS.md`.

- A clean workspace install with the frozen lockfile resolves all direct dependencies. Package-boundary review finds no cross-app imports or renderer references to web aliases.
- Requested unit/parity checks preserve existing golden PNG bytes, schema-8 reports, default palette, placement/rotation behavior, and mandatory export checks. Existing recipe version 1 fixtures replay unchanged; do not regenerate expected outputs to hide a regression.
- Requested typechecks cover each package and repository tooling. Requested Next and vinext builds both include working browser worker/WASM assets and compiled StyleX styles. A requested local Wrangler dry run bundles the API without Next/React, native `sharp`, or web UI code.
- Manual browser checks cover upload, mask editing, placement, assembly, original/raster downloads, recipe export, and worker disposal/stale completions. Editor assembly continues entirely in the browser and sends no requests to the render API. Update or run E2E journeys only on request.
- Requested local Hurl checks cover rendering, PNG parity, auth, invalid input, body limits, and rate limiting. They continue to use local workerd and write only under `output/api-tests/`; production is never the default test target.
- Web preview still serves brand/font assets and `/api/icons`. API replay still returns no-store binary responses, stores no request assets, fetches no recipe URLs, and preserves existing limits. Existing deployed recipes remain compatible across independently deployed app versions.

Use incremental commits for extraction, application moves, and tooling/documentation changes. Keep production deployments unchanged until validation is complete. A rollback reverts code/configuration moves and any associated build-root/watch-path changes; there is no data migration. Do not delete or recreate deployed Workers as part of this restructuring.
