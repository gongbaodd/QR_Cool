# Zustand editor state migration

Status: implemented, 2026-09-22. Verification: `pnpm build` passed. `pnpm test` ran 101 tests; 100 passed and the existing engine artifact parity assertion failed because the poster SHA-256 was `310916c86e2395514673ae3ae1045f8bfed5487317ff33d700dd66f179736dc3` instead of the pinned `5a76e5608b37cce8f319ae821265fc06866117d4caba47972947dcf117f056f7`. The failing test and renderer files were not changed by this migration.

Later update (2026-09-23): the no-history constraint below applied to the original migration. Zundo now keeps a bounded, read-only timeline of dated state snapshots for tracing; it does not add undo/redo controls or persist editor data.

## Outcome and scope

Make Zustand the single owner of shared editor session state. Replace `Editor.tsx`'s `useReducer` and scattered shared `useState` values with a typed, editor-scoped store and narrow subscriptions. Preserve the current UI, rendering output, draft/Generate interaction, automatic/manual mask behavior, and export contract.

This is an implementation handoff, not an implemented migration. Work through the phases below in order. Checkpoints describe what to inspect and eventually verify; they do not require stopping for approval between phases. Do not install dependencies or change application code just to execute this planning document's creation.

Use one store instance per mounted editor, not a module-level singleton. Keep component-local interaction state local. Do not add persistence, undo/redo, URL synchronization, Redux DevTools, Immer, another request library, or a general-purpose slice framework. `File` and `Blob` references are valid in this in-memory store; never serialize them or the entered content to storage, logs, or devtools.

This plan supersedes the prohibition on a global state library in `reactive-editor-layout.md` for this migration only. Its product behavior and the repository's rendering invariants still apply. Current source and the implemented sections of the README take precedence over historical server-rendering and step-based descriptions in older plans.

## Read before implementing

- `AGENTS.md`, `README.md`, and `doc/plan/reactive-editor-layout.md`.
- `src/lib/editor/state.ts`, `schema.ts`, and `text-mask.ts`.
- `src/components/editor/Editor.tsx` and all four existing `hooks/use-*.ts` files.
- `PreviewPanel.tsx`, `MaskPanel.tsx`, `PatternSettings.tsx`, `EditorHeader.tsx`, and `ResponsiveEditorPanel.tsx`.
- `src/lib/editor/worker/editor-worker-client.ts`, `editor-worker.ts`, and the revision/settle logic in `engine/engine.ts`.
- `test/state.test.ts`, `test/engine.test.ts`, and `vitest.config.ts`.
- The installed Next.js guide at `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` before writing code.

Reapply the `modern-web-guidance` skill before client implementation. During planning, its state-management search returned unrelated guides; browsing its catalog identified `validate-input-after-interaction` as relevant to preserving validation timing. Keep validation feedback after blur/submit, clear errors while correcting input, and retain invalid-submit focus. Do not replace the existing Zod rules or restyle the form as part of this migration.

Use Zustand 5 APIs. Official guidance supports a vanilla store factory with a React provider, deterministic initial state, and no store reads/writes from Server Components. Put the provider around the editor, keeping `src/app/page.tsx` a Server Component. See [Zustand's Next.js guide](https://zustand.docs.pmnd.rs/learn/guides/nextjs).

Prefer primitive/reference selectors; use `useShallow` when selecting an object or tuple. Avoid freshly allocated selector results without stabilization and the removed `zustand/context` API. See [v5 migration guidance](https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5) and [useShallow guidance](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow).

## Current ownership and target ownership

| Current location                    | Values                                                                                                                              | Target                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `state.ts` / `Editor.tsx` reducer   | revision, committed content, settings, prepared payload, placement, result, engine busy/error/field, result view                    | Zustand `document` branch; retain pure reducer transitions internally |
| `Editor.tsx`                        | draftContent, draftError, draftBlurred                                                                                              | Zustand `draft` branch                                                |
| `Editor.tsx`                        | poster and mask Files                                                                                                               | Zustand `sources` branch                                              |
| `use-mask-selection.ts`             | origin, maskText, maskFontId, selectedIcon, maskBusy                                                                                | Zustand `maskSelection` branch                                        |
| `use-icon-search.ts`                | results, total, loading, error, fetchedQuery, galleryMode                                                                           | Zustand `iconSearch` branch                                           |
| `Editor.tsx`                        | maskOpen, patternSettingsOpen                                                                                                      | Zustand `panels` branch                                               |
| `Editor.tsx` and `use-blob-urls.ts` | poster/prepared/artifact object URLs                                                                                                | Existing UI resource hooks, outside the store                         |
| Runtime hooks                       | timers, pending-operation tokens, signatures, waiters, abort controllers, worker proxy                                              | Hook refs/runtime handles, outside observable state                   |
| Canvas and dialogs                  | decoded images, mask pixels, Konva/DOM refs, viewport, hover, showMask, marker dialog, media query state, focus, thumbnail failures | Existing component-local state/refs                                   |

Move shared values without keeping mirrored React state. Derived values are selectors/helpers, not stored copies: suggested letter, effective mask text, selected icon ID, mask font, isBlank/isIconMode/isFollowingInput, trimmed search query, visible content error, preparation error, current preview, aggregate busy, and export readiness.

Use explicit branch types and fresh initial objects/arrays for each store. Preserve the defaults from `initialState`, including seed `0` for the deterministic initial render; generate the real session seed only during browser initialization. Preserve File/Blob identity through transitions.

## Target files and responsibilities

| File                                                  | Responsibility                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/editor/state.ts`                             | Existing `State`, `Action`, `Prepared`, `Result`, and pure reducer; add an initial-state factory so instances do not share mutable defaults                                           |
| `src/lib/editor/store.ts` (new)                       | `createEditorStore()`, typed state branches and synchronous domain actions using `createStore` from `zustand/vanilla`; no browser side effects                                        |
| `src/lib/editor/selectors.ts` (new)                   | Shared pure derived selectors; use existing schema and mask helpers                                                                                                                   |
| `src/components/editor/EditorStoreProvider.tsx` (new) | Client context carrying a stable store API; lazy `useState(createEditorStore)`; typed `useEditorStore(selector)` and `useEditorStoreApi()` hooks with a useful missing-provider error |
| `src/components/editor/Editor.tsx`                    | Provider boundary and workspace composition; DOM focus refs and minimal runtime callback wiring                                                                                       |
| `src/components/editor/hooks/use-engine-request.ts`   | Single mounted engine request controller, narrow subscriptions and latest store snapshots; 450 ms preparation timer                                                                   |
| `src/components/editor/hooks/use-mask-selection.ts`   | Single mounted mask controller; browser rendering and async lifecycle; store-backed selection values                                                                                  |
| `src/components/editor/hooks/use-icon-search.ts`      | Single mounted search controller; fetch/cache lifecycle; store-backed search values                                                                                                   |
| `src/components/editor/hooks/use-blob-urls.ts`        | Keep Blob URL ownership and cleanup here                                                                                                                                              |
| `src/lib/editor/worker/editor-worker-client.ts`       | Session-owned, lazily created worker handle with explicit disposal                                                                                                                    |
| `test/editor-store.test.ts` (new)                     | Domain transitions, store isolation, selectors, atomic source updates, stale completions                                                                                              |

Retaining the reducer as a pure function is intentional: Zustand owns the state and subscriptions, while the existing revision rules remain in one place. UI code calls named actions rather than dispatching arbitrary patches. Do not introduce a second active `useReducer` or copy the transition rules into every action.

## State transitions and action contract

Use functional `set` updates based on the latest store state. When several branches change together, publish one update. Keep action references stable. Internal completion actions are for runtime controllers, not arbitrary UI mutation.

| Action family                                            | Required behavior                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setDraftContent`, `blurDraft`, `commitDraft`            | Typing changes only draft/error state. Blur validates. Invalid commit exposes the existing message and returns a failure indicator so the header can focus its input. Valid commit uses `contentSchema`'s parsed value. Committing the same value clears draft errors without changing revision. A changed value goes through one document edit. |
| `patchSettings`, `setSeed`, `movePlacement`              | Merge a partial settings patch against current settings, never a captured render snapshot. Pass a generated seed into the action. Canonicalize placement using current prepared QR metadata and retain the existing no-prepared guard. Use the document edit transition.                                                                         |
| `initializeSources`, `replaceMask`                       | Commit relevant File references and document invalidation atomically. A mask replacement resets prepared/placement. Initialization commits both blank files and the fresh seed together. Oversized-mask error belongs to the resulting revision in that same update.                                                                             |
| Mask selection actions                                   | Preserve the current 10-character field limit, effective-letter derivation, blank/font/icon precedence, manual freezing, and Follow input. Update selection fields atomically. Rendering stays in the controller; a successful latest mask render calls `replaceMask`.                                                                           |
| Engine `start`, `acceptPrepared`, `acceptResult`, `fail` | Delegate to the reducer, retaining revision equality checks and payload/Blob references. Stale completions are no-ops, including stale errors/busy events.                                                                                                                                                                                       |
| Search start/success/failure and gallery close           | Update only search state. Preserve last-term caching and existing messages. Opening the gallery must check the current query after async completion.                                                                                                                                                                                             |
| Panel open/close and result view                         | No revision bump, no source change, no new worker request, no result invalidation.                                                                                                                                                                                                                                                               |

The document edit transition must increment revision exactly once and clear `result`, `busy`, `error`, `field`, and `showingResult`. Keep the previous `prepared` and placement unless the edit explicitly resets them. A stale prepared image may remain visible while updating, but the `current` selector must reject it for export.

Do not interpret a complete automatic-mask workflow as one revision: a content commit and a subsequently generated mask file currently cause separate invalidations. Preserve that behavior. UI-only changes and async status/completion updates must not increment the document revision.

`current` remains “prepared exists, prepared revision matches document revision, and there is no document error.” Aggregate busy includes engine work, mask rendering, and icon search. Export requires valid committed content, current prepared data, placement, and no busy work. Reuse these selectors for both button state and request guards; an imperative assemble call must not bypass eligibility.

## Async and resource rules

### Worker requests

- Keep one mounted `useEngineRequest` controller per editor. Obtain a coherent snapshot with `store.getState()` when starting a request: files, committed content, settings, placement, prepared metadata, revision, and mask state must come from the same snapshot.
- Keep the 450 ms timer keyed to revision/source identity/mask busy changes. Completion state, draft typing, gallery/panel toggles, or newly allocated selector objects must not schedule another prepare.
- Preserve the manual-mask empty-content placeholder `A` for preparation only. Never write it into committed content or permit it to enable assembly.
- Preserve `automatic` placement inclusion rules and `previousTotalModules` on manual preparation. Continue transferring fresh file byte buffers with Comlink; do not place transferred/detached buffers in the store.
- Check lifecycle token and revision again after asynchronous file reads and before dispatching work; reject obsolete work before spending worker time. On settle, the store must still check revision even if the worker reports success. The worker only learns a newer revision when it receives a newer request.
- Use a controller operation token in addition to the document revision so an older same-revision retry cannot clear a newer request's busy/error state. Starting assembly clears a pending automatic prepare timer. Do not let a same-revision prepare completion overwrite the assembly outcome.
- Catch File read, worker construction, RPC, and transfer failures as well as typed engine failures. Only the active operation may settle its busy/error state. Cleanup invalidates tokens and clears timers. Remove the current no-op `cancel()` abstraction once its callers are migrated.

### Worker lifetime

The existing client caches a module-level Comlink proxy and the engine remembers its highest revision. A new store starting at revision zero cannot safely reuse a worker left at a higher revision. Fix this boundary as part of the migration, without changing rendering algorithms:

1. Replace the global getter with a factory that returns a lazy worker client accessor and a disposer, scoped to the mounted request controller.
2. Create the actual Worker only from browser runtime code. Release its Comlink proxy and terminate the owned Worker during cleanup.
3. Effect setup after cleanup must create a fresh handle, including React Strict Mode's setup/cleanup/setup cycle. Invalidate pending callbacks before disposal and ignore settlements from the old handle.
4. Do not reset a shared worker's revision to accommodate a new store. Each mounted editor owns its worker/cache session; unrelated editor instances must not interfere.

### Mask rendering

- Keep font loading, SVG fetching/rasterization, canvas work, and temporary SVG URL cleanup in `use-mask-selection.ts` (or an extracted browser helper).
- Read selection data from the store and retain one render-signature guard and latest-operation token. Do not duplicate rendering in both a newly added effect and the old event handlers. Choose one scheduling path for each selection action.
- Automatic rendering follows committed content only. Manual text/font/icon selection stays fixed across committed-content changes. Follow input returns to the existing automatic derivation.
- Mark busy before async work, close the gallery as today, and ensure only the current selection/signature can commit a mask File or clear busy. Guard `toBlob` callbacks and async error paths too.
- Mask-generation identity is separate from worker revision: an unrelated settings edit must not strand a valid mask operation or attach its error to an obsolete revision. If the selection/source dimensions still match at settlement, commit against the latest document revision; otherwise drop it.
- Cleanup invalidates work and releases any waiters. `whenSettled` currently has no consumer; remove it if it remains unused rather than moving Promise resolvers into Zustand.
- Preserve existing blank/font/icon rendering precedence and output. If source behavior disagrees with older prose, record it instead of silently adding a mask behavior fix to this refactor.

### Search and initialization

- Keep icon search explicitly click-driven. Read the current trimmed mask field via a selector/store snapshot instead of `searchQueryRef`. Retain one cached fetched term and its results, reopen that cache without refetching, and never open results for an abandoned query.
- Use a request token and cleanup/AbortController for icon fetches; stale requests cannot overwrite a newer result or clear its loading status. Preserve results-cache behavior when the field changes without another search.
- Keep the source initialization canvases in a browser effect or extracted initialization hook. Late blank `toBlob` callbacks must not replace newer files, discard settings/content changes, or write after cleanup. Commit both files atomically using current settings and a guarded source identity.
- Do not retain the current `blankStarted` latch unchanged when adding cleanup: Strict Mode cleanup must not leave the second setup unable to finish initialization. Restart safely or reuse an explicitly owned pending initialization, then discard superseded completions.
- Keep object URLs out of Zustand. Use the existing Blob URL hook at the preview/download boundary, including the poster if convenient. Revoke URLs on replacement/unmount. Preview and download must share the exact assembled Blob.

## Sequenced implementation

### Phase 1 — Store foundation

- [x] Add `zustand@^5` with pnpm, updating only the intended manifest/lockfile entries; do not upgrade unrelated packages.
- [x] Add the state factory, branch types, vanilla store, named actions, selectors, and provider described above.
- [x] Route core document actions through the existing reducer; keep draft, source, selection, search, and panel branches separate from renderer data.
- [x] Add focused store tests for the transition contract before UI rewiring. Fix `test/state.test.ts`'s artifact stub to use a Blob instead of a string, without weakening the types.

Checkpoint: the store can be constructed without DOM/Worker globals; two factories have independent defaults; stale reducer completions return the existing state; selectors allocate no unstable defaults. No UI migration or runtime effect is required to establish this foundation.

### Phase 2 — Sources and async controllers

- [x] Adapt the three controller hooks to the scoped store API and remove shared `useState` mirrors and `Dispatch<Action>` inputs.
- [x] Apply the lifecycle/worker ownership rules above. Preserve debounce, transfer, cache, placement, and error behavior.
- [x] Move blank source initialization to a guarded browser lifecycle; make file/revision commits atomic.
- [x] Keep only runtime resources in refs. Hooks may return thin event callbacks for consumers; they must not return a second authoritative state object.

Checkpoint: rapid edits cannot produce a file/revision mismatch or stale export; old mask/search work cannot win; cleanup and Strict Mode re-setup remain usable. Source/settings updates use the latest state, not `state.revision + 1` or a captured settings spread.

### Phase 3 — Connect editor surfaces

- [x] Wrap the workspace in `EditorStoreProvider` inside the editor client boundary. Remove `useReducer`, duplicate shared `useState`, `searchQueryRef`, and the old broad `edit/dispatch` prop wiring from `Editor.tsx`.
- [x] Subscribe the header to draft/validation/status and commit actions; keep input focus refs local.
- [x] Subscribe Mask selection and the gallery to their branches/selectors. Mount each controller once above their consumers, not once per panel or per breakpoint.
- [x] Subscribe Pattern settings to committed settings and named actions. Keep generic controls presentational where useful; thin connected wrappers are acceptable.
- [x] Subscribe the preview to prepared/placement/result/readiness and panel state. Create object URLs at this boundary. Preserve lazy Canvas/ResultPanel/MarkerDialog/IconGallery loading and all existing StyleX markup.
- [x] Keep panel trigger refs, native dialog focus behavior, canvas drag/hover/resize state, and marker-dialog state out of the store. Pass DOM refs and runtime callbacks as narrow props when needed; removing every prop is not the goal.
- [x] Avoid a root `useEditorStore(s => s)` subscription or bundling every branch into one selector. Controller callbacks should be stable where practical. Use memoized section boundaries if parent controller updates would otherwise rerender unrelated panels; do not memoize every control indiscriminately.

Checkpoint: committed editor state has exactly one owner; changing the draft does not trigger worker preparation, mutate the mask, or invalidate a download. Store selection isolates unrelated updates, and the same sidebar instances survive desktop/mobile resizing.

### Phase 4 — Regression coverage and documentation

- [x] Add/update the focused tests listed below using the existing Node Vitest setup and injected/mock runtime boundaries. Extract a small controller helper when necessary to test races; do not add a browser testing framework for this migration.
- [x] Update README Architecture with store ownership, local-state exceptions, lack of persistence, and worker lifetime.
- [x] Add an implemented migration section to `doc/plan/web-qr-poster.md` and update its state-management dependency entry; clearly distinguish obsolete reducer/server-era descriptions from current behavior without rewriting historical design wholesale.
- [x] Update the state-ownership sentence in `AGENTS.md` once implementation actually lands, preserving all invariant/command rules and the generated Next.js block. Update obsolete reducer-hook comments in touched files.
- [x] Mark this plan implemented only after code is complete; list verification as pending if the maintainer has not requested it. Summarize any known unrelated pre-existing discrepancy separately.

## Verification handoff

Do not run `pnpm test`, `pnpm typecheck`, `pnpm build`, or alternative invocations that bypass this policy unless the user explicitly asks for verification. Do not update `e2e/editor.spec.ts` or run `pnpm test:e2e` until separately requested. Creating relevant unit tests is part of implementation; running them is a separate maintainer-controlled step.

Meaningful automated cases to add:

1. Draft typing/blur/invalid commit/unchanged commit preserve document revision and artifact identity; a changed valid commit invalidates exactly once.
2. Consecutive settings patches merge without lost fields; placement stays canonical; reset edits clear prepared/placement while normal edits preserve the old preview.
3. Source File replacement and resulting revision/error are visible in one store notification, with no intermediate mismatched snapshot.
4. Stale prepared/result/error/busy events do not alter the current document. Current completions retain exact Blob references. Store instances do not share settings, arrays, or UI branches.
5. Automatic mask derivation uses committed content; manual selection survives content commits; Follow input restores automatic mode. Mask/search/panel status updates do not create revision loops.
6. Deferred fake worker/file/mask operations finish in reverse order: old work cannot overwrite new work, clear its busy flag, or attach an error to the wrong operation. Same-revision prepare/assemble ordering is covered.
7. Search cache reopening, query changes during fetch, cleanup, and stale loading/error completion use a mocked fetch; no real upstream calls.
8. Worker disposal/recreation and late initialization callbacks are covered with fake handles/deferred callbacks. A fresh editor session can accept low revisions after an older session reached high revisions.
9. Readiness selectors reject stale prepared data, invalid committed content, missing placement, errors, and every busy source; immutable UI updates preserve unrelated branch references.

Manual acceptance scenarios for the maintainer:

- Start empty; type a draft without preparing; Generate valid/invalid/unchanged content and confirm validation/focus timing.
- Select a manual mask before valid content: placeholder preview works, export remains unavailable. Commit content, change it in automatic/manual modes, then Follow input.
- Change settings rapidly, move/resize/rotate placement, edit marker settings, and regenerate the pattern. No stale result becomes downloadable.
- Assemble and download; return to editing; type an uncommitted draft and verify the existing result survives; commit an edit and verify it becomes invalid.
- Search/reopen cached icons, change the query during loading, choose masks quickly, and inspect failed-search/mask errors.
- Resize through desktop/mobile layouts and exercise drawers/gallery/marker dialog focus and Escape behavior. Confirm values survive resizing.
- Unmount/remount the editor, including development Strict Mode, and verify worker readiness, source initialization, and object URL cleanup without hydration warnings or update loops.

When verification is explicitly requested, run the authorized commands and report results accurately. Passing store tests alone does not establish visual parity, browser cleanup, or rendering correctness.
