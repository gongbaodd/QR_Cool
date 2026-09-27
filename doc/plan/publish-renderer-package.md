# Plan: Publish the renderer as a standalone package

Status: implementation prepared; package is configured for public release under `@gongbaodd`. Registry release is pending an external install check and npm authentication. Date: 2026-09-27.

## Outcome

Publish `packages/renderer` as a versioned, installable package so another Node.js project can read a `mahu-qr.recipe.json` exported by the editor and generate the QR artifact or the assembled poster. The package remains the single implementation used by the editor and replay Worker; publishing must not fork the QR encoder or rendering algorithms.

The first public workflow should be straightforward:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { renderRecipeFile } from '@gongbaodd/qr-renderer/node'

const result = await renderRecipeFile(await readFile('mahu-qr.recipe.json'), {
  artifact: 'poster.png',
})
await writeFile(result.filename, result.png)
```

The API and exact entry-point name are provisional. Decide and document whether a CLI is part of the first release; it should call the same public Node API and must not become a separate renderer. At minimum, the package API accepts parsed JSON or UTF-8 recipe bytes/string and returns PNG bytes plus the selected artifact filename. Default to `poster.png`; allow `qr.png` explicitly.

## Current baseline

- `packages/renderer/package.json` is `@gongbaodd/qr-renderer@0.1.0`, marked `private: true`, and exports source TypeScript subpaths directly.
- `src/recipe.ts` exports `recipeSchema`, `PortableRecipe`, `createRecipeBlob`, and `renderRecipe`. `renderRecipe` validates the strict schema, verifies embedded PNG digests and dimensions, then calls the shared assembly pipeline.
- Imaging backends are split across browser, Cloudflare, and Node. The Node backend currently depends on Sharp, while the package manifest lists the browser codec and decoder dependencies as ordinary dependencies.
- The root workspace consumes the package through `workspace:*`. The editor and render Worker rely on explicit subpaths and their runtime-specific imaging setup.

## Scope and boundaries

### In scope

- Publish a supported package with a documented public API for replaying exported recipes.
- Produce distributable JavaScript and declaration files for the supported Node.js runtime, with explicit exports and package metadata.
- Include the required codec/WASM assets and runtime initialization in the published package; prove the installed package works outside this monorepo.
- Make the Node imaging backend a supported package entry that can decode and encode PNGs and run the existing mandatory verification path.
- Preserve source workspace use by the editor and Worker, and retain the single root lockfile.
- Document installation, recipe input, supported artifacts, runtime requirements, version compatibility, errors, and a minimal usage example.

### Out of scope for the first release

- Browser or Cloudflare Worker consumers switching to the published build; they can continue using the workspace source entry points.
- New recipe formats, remote rendering services, URL fetching, asset storage, batch scheduling, or editor import flows.
- Changes to QR generation semantics, settings defaults, golden outputs, or the schema-8 assembly report.
- Publishing the app, mascot/brand assets, tests, fixtures, or repository tooling as part of the package.

## Package design

1. **Define supported public entry points.** Keep low-level source subpaths used inside this monorepo stable. Add a deliberate Node entry such as `@gongbaodd/qr-renderer/node` and a small root API only if it has unambiguous runtime behavior. Do not expose internal modules merely because they exist. Separate public API types from internal imaging types where practical.
2. **Add recipe replay adapters.** Retain the strict schema, version checks, SHA-256 verification, PNG dimension checks, and `assemblePayload` replay. Add a Node-friendly adapter that reads a file's supplied bytes without requiring the caller to construct a browser `Blob`; keep filesystem access out of the core recipe and render functions. Parse strings/bytes with a documented UTF-8 and size policy before schema validation. Reject malformed or unsupported recipe/renderer versions with actionable errors.
3. **Choose Node imaging dependencies deliberately.** Use the existing Sharp backend for Node. Decide whether Sharp is a required dependency or an optional peer selected by the `/node` entry; ensure the published dependency graph does not force browser-only consumers to install Sharp or native binaries. Keep jSquash/resvg WASM setup confined to browser/Worker paths. Verify the Node entry does not load browser globals, `worker-shim`, or Cloudflare bindings.
4. **Create a reproducible package build.** Compile distributable ESM JavaScript and `.d.ts` files into package-local output and map `exports`, `types`, and `files` to only supported artifacts. Preserve source imports for workspace applications as needed without publishing raw TypeScript as the Node default. Ensure packed files include any required WASM, licenses, and notices, and exclude tests, fixtures, generated app output, and repository-only tools.
5. **Add optional CLI only after API shape is fixed.** If included, expose a documented command accepting an input recipe path, optional output path, and `poster.png`/`qr.png` artifact selection. Write only the requested output; report validation errors to stderr with a nonzero exit. The CLI must have no network behavior and call the same API. If CLI is deferred, clearly state the supported library workflow.
6. **Prepare registry and release metadata.** Remove the private flag, choose the npm scope/access policy and license, provide package README/repository/homepage/bugs metadata, pin compatible runtime/dependency ranges, and define versioning/deprecation policy. Preserve the recipe's independent schema and renderer version compatibility rules; package releases alone must not silently change old recipe output.
7. **Document usage and compatibility.** Add installation and Node examples, explain how to obtain `mahu-qr.recipe.json` from the editor, list the two artifacts and default behavior, identify supported Node versions and platform constraints (including Sharp), and describe deterministic replay guarantees and unsupported renderer versions. Keep the repository README's description of the renderer accurate.
8. **Release process.** Build from a clean checkout using root workspace tooling, inspect the packed file list and manifest, install the tarball into a temporary external consumer project, and exercise one committed recipe fixture without production calls. Publish a prerelease first, verify package registry metadata and a fresh install, then publish the stable version. Tag the source revision and record the published version.

## Compatibility and integrity requirements

- A recipe is untrusted input. Enforce the existing 28 MiB recipe limit, 10 MiB/four-megapixel PNG limits, strict schema, image digests, dimensions, placement rules, and mandatory assembly checks before returning output.
- Do not fetch the QR content, embedded URLs, or any recipe-provided URL. Do not send recipe bytes or rendered assets to a service.
- Keep `poster.png` as the default assembled full-poster output. `qr.png` remains the standalone transparent QR artifact and must not be described as the poster.
- Replay behavior is determined by the recipe schema/renderer versions and pinned algorithms/dependencies, not by whatever settings happen to be current. Unknown versions fail explicitly.
- Keep package imports environment-neutral where promised. Node-only filesystem access belongs in the Node adapter/CLI; the shared renderer core remains free of filesystem and process side effects.
- Existing editor and Worker source imports remain compatible, and output bytes for existing golden cases remain unchanged.

## Acceptance criteria

- A clean external Node.js project can install the published or locally packed package and render a committed editor-exported recipe to `poster.png`; it can select `qr.png` as well.
- The API accepts the documented recipe input forms, returns usable PNG bytes and artifact naming, and reports malformed, oversized, digest-mismatched, dimension-mismatched, invalid-placement, and unsupported-version recipes as errors without partial output.
- Replaying a fixed recipe through the Node package produces the same decoded RGBA pixels as the existing shared pipeline for both artifacts (PNG encoding byte differences are acceptable only when decoded pixels match).
- The distributable contains all required runtime code, declarations, codec assets, licenses/notices, and README, while excluding repository tests, fixtures, app code, and unrelated files.
- Root workspace users can still typecheck/import the package through existing explicit subpaths, with no app-to-app imports and no duplicate renderer implementation.
- The package's Node entry and any CLI perform no network calls and write no files except the explicit CLI output path supplied by the user.

## Implementation sequence

1. Settle package naming/access, Node version floor, API shape, and first-release CLI inclusion.
2. Implement the Node adapter over `renderRecipe`, with bounded input parsing and explicit artifact selection; keep recipe validation/rendering shared.
3. Establish package build output, export maps, dependency treatment, included assets, and package README.
4. Add focused library/CLI tests using committed local fixtures and compare decoded pixels against the current pipeline; never use production services.
5. Inspect the package tarball and validate installation/rendering from a separate temporary consumer project.
6. Update `README.md` and `doc/plan/web-qr-poster.md` with the published package boundary and supported recipe workflow.
7. Publish a prerelease, verify a fresh registry install, then publish and tag the stable release.
8. After implementation ships, remove this completed plan and keep the durable package contract in the canonical docs.
