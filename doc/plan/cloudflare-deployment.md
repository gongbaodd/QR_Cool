# Plan: Deploy mahu-QR to Cloudflare Workers

## Goal and deployment shape

Host the existing Next.js 16 editor and its single server route, `GET /api/icons`, on one Cloudflare Worker. Keep poster assembly in the visitor's Web Worker: PNGs, masks, QR artifacts, and exports stay in the browser. The deployed Worker serves the page and static assets and proxies icon search to `icons.grida.co`; it needs no database, object storage, render API, or persistent filesystem.

The first target is a `*.workers.dev` URL. Add a custom domain after the preview passes. Keep the existing Node `pnpm dev`, `pnpm build`, and `pnpm start` path working during migration.

> **Worker rename.** The rebrand renamed `wrangler.jsonc`'s `name` from `qr-cool` to `mahu-qr`. This changes the deployed Worker identity, so the `*.workers.dev` URL becomes `mahu-qr.<account>.workers.dev` and a fresh deployment creates a new Worker (the old `qr-cool` Worker keeps serving until deleted). Deploy the rename deliberately and record the new production URL below when the account is connected.

## Platform choice

Use **vinext on Cloudflare Workers** as the first implementation path. [Cloudflare currently recommends vinext for Next.js on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) and documents a migration that leaves the existing Next.js setup available. It supports App Router and Route Handlers, the two server features this app uses. Cloudflare calls vinext beta, so acceptance depends on this project's production build and browser behavior, not the compatibility scan alone.

The main compatibility risks are specific to this repository:

- StyleX uses `babel.config.json` to transform `stylex.create()` and `postcss.config.mjs` to extract the `@stylex` stylesheet. Vite must run an equivalent Babel transform before StyleX extraction; a successful page load with missing or runtime-injected styles is a failed migration.
- The editor imports both jSquash and resvg `.wasm` files as asset URLs inside a dedicated browser worker. `next.config.ts` has Turbopack rules and an explicit initialization workaround. Confirm that Vite emits both binaries, gives the worker valid URLs, and serves the expected MIME type. The current Turbopack rule does not configure Vite.
- `serverExternalPackages` in `next.config.ts` controls Next's server bundling. Check that vinext does not pull `sharp`, other native test dependencies, or browser codec code into the deployed Worker.

If these gates cannot be met without changing the rendering pipeline or losing StyleX output, use the [OpenNext Cloudflare adapter](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) as the fallback. It transforms the existing `next build` output, preserving the current compilation path, but needs its own Worker preview and route checks. Keep the app on Workers in either case. A Pages static export would require moving `/api/icons` into a separate function and does not meet this one-Worker deployment goal.

## Implementation sequence

### 1. Establish a baseline and run the compatibility check

1. Record the current `pnpm test`, `pnpm typecheck`, and `pnpm build` results and inspect the generated page for the StyleX stylesheet and worker/WASM assets.
2. Run the [vinext compatibility check](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/#add-vinext-with-the-cli) in an isolated branch or worktree. Review findings against `next.config.ts`, `babel.config.json`, `postcss.config.mjs`, `src/core/imaging/browser.ts`, and `src/lib/editor/worker/editor-worker-client.ts`. Treat the check as a starting point; it cannot prove StyleX or codec correctness.
3. Confirm the current vinext, Vite, Wrangler, Node, and pnpm requirements before pinning versions in `package.json` and `pnpm-lock.yaml`. The package already requires Node 22+ and pnpm 10.

**Gate:** Document any compatibility gap and the precise fix before changing the production build path.

### 2. Add the Worker build without replacing the Node build

1. Run `vinext init` for Cloudflare Workers, then review its changes instead of accepting generated defaults blindly. Keep the existing scripts; add explicit `dev:vinext`, `build:vinext`, and Worker preview/deploy scripts following the installed vinext version's CLI. Commit a `vite.config.ts` and `wrangler.jsonc` with a stable Worker name, a pinned compatibility date, and only the bindings the app actually uses. Start without KV, R2, or Images bindings.
2. Reconcile Vite's CSS/JS transforms with the existing StyleX Babel and PostCSS settings. Confirm the `@stylex` slot is replaced with compiled atomic rules in the production CSS and that the layout has the same fonts and styling as the Node build.
3. Configure Vite's browser worker and `.wasm` handling as needed. Check actual built URLs and requests for both codec binaries; preserve the current explicit `initWasm`/jSquash initialization behavior and browser-only loading.
4. Keep `GET /api/icons` as a same-origin Route Handler. Preserve its input bounds, 8-second timeout, response shape, and `Cache-Control: no-store`. Do not change the client fetch path or allow poster files to reach the Worker.
5. Ignore generated vinext/Cloudflare build output and local secret files. Do not commit credentials. There are no required app secrets today.

**Gate:** Both `pnpm build` and the Worker production build succeed. The Worker artifact is within the account's size limits, and its page includes the expected CSS, JS worker, WASM assets, and public fonts. Use the local poster fixture in the browser smoke test.

### 3. Verify in the Workers runtime

1. Run the vinext local Workers preview, not just `next dev`. Confirm `/` loads, `GET /api/icons?q=heart` reaches the upstream service and returns JSON, and `GET /api/icons?q=` and overlong queries keep their current behavior. For repeatable automated checks, mock upstream responses; do not depend on the live icon service.
2. In a browser, exercise upload → mask/letter or icon search → place QR → assemble → preview → download. Verify exact download bytes, no poster upload/network render call, and no console or network failures for worker scripts, `.wasm`, fonts, or images. Check the production preview on Chromium and at least one other engine because codec URL handling is browser-sensitive.
3. Compare a representative result with the existing Node-built browser baseline using the project's pixel invariant and artifact checks. Do not weaken mandatory export verification to make the deployment pass.
4. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before handoff. Keep `pnpm test:e2e` out of the routine gate per repository instructions; update and run `e2e/editor.spec.ts` only when requested by the maintainer.

**Gate:** The full editor journey works from local Workers preview, including icon search and full-resolution export, with no differences in protected pixels or QR plate output.

### 4. Deploy and operate

1. Connect the repository to [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) or use an authenticated CI deploy. Install from the lockfile, run the project's required checks, build with the chosen adapter, and deploy only from the production branch. Set the build environment's Node and pnpm versions explicitly. Do not add an API token to the repository.
2. Deploy first to `*.workers.dev`; repeat the page, asset, `/api/icons`, and export smoke checks against that URL. Review Worker request errors, CPU use, and asset/cache behavior. The icon route is the only request that calls an upstream service; leave its responses uncached as implemented.
3. Attach the custom domain and validate HTTPS and the same-origin `/api/icons` path. Keep static versioned assets cacheable through the adapter's normal asset handling; do not cache the icon API or user-generated Blobs. Document the production URL, build command, deploy command, and owner in `README.md` once selected.
4. For rollback, retain the last known-good Worker deployment/version and redeploy or roll back to it if the new release fails. Verify that the page and its versioned assets move together. The existing Docker/Node deployment remains a recovery option while the Worker path is being proven.

**Gate:** The public URL passes the same smoke checks, errors are observable, and a rollback procedure has been exercised or documented against a retained version.

## Fallback decision

Switch to OpenNext only if the vinext preview fails one of the StyleX, browser worker/WASM, Route Handler, or pixel-output gates and a small, maintainable configuration change cannot fix it. Follow the [OpenNext existing-app setup](https://opennext.js.org/cloudflare/get-started): add `@opennextjs/cloudflare` and Wrangler, `open-next.config.ts`, and `wrangler.jsonc` with `main: .open-next/worker.js`, `assets.directory: .open-next/assets`, and `nodejs_compat`; then run its build and preview commands. Verify its generated Worker size and all gates in sections 2–4. Do not add R2 incremental caching unless a feature in this app needs it.

## References

- [Cloudflare: Next.js on Workers and vinext migration](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [vinext migration and differences from Next.js](https://vinext.dev/docs)
- [Cloudflare: OpenNext adapter](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [Cloudflare: Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Next.js deployment guidance](https://nextjs.org/docs/app/getting-started/deploying)
