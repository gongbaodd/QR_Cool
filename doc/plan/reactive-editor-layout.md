# Reactive editor layout plan

Status: implemented, 2026-09-22. Implementation target: GPT-5.6 Luna. Browser/manual review and build diagnostics remain handoff items.

## Outcome

Replace the four-step editor with one continuously available, reactive workspace.

- The header owns a single-line **Text or URL** draft field and a **Generate** button. Generate commits the draft and starts the reactive refresh; it is not a final completion action.
- Desktop shows three persistent columns under the header: **Mask selection**, **Preview canvas**, and **QR details**.
- Mobile keeps the input and preview visible. Mask selection opens as a left-side modal drawer and QR details opens as a right-side modal drawer.
- Typing changes only the draft. Until Generate is clicked, the committed mask, QR, and preview stay unchanged (validation may still be shown after blur/submit).
- After Generate commits the draft, while the mask is in automatic mode, the committed input updates both the derived mask and the worker-rendered poster preview.
- The first explicit user change inside Mask selection freezes the mask. Later text changes still update the QR and preview, but do not replace that user-selected mask.
- A visible **Follow input** action returns a frozen mask to automatic mode.
- There is no Continue/Generate completion step. After a committed input, mask choice or QR configuration change updates the live preview automatically. Keep the existing full-resolution assembly/download implementation available as an export concern, but do not make it a required navigation state for editing.

This is a presentation and interaction refactor, not a renderer rewrite. Preserve every renderer, image, placement, export, and verification invariant in `AGENTS.md`.

## Required interpretation

The phrases in the request are implemented as follows so Luna does not have to guess during the build.

| Request                               | Concrete behavior                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| “Show A as default”                   | For an empty committed input, automatic mode starts with a blank full-canvas mask. Once a non-empty value is committed, the automatic mask derives its letter and uses the default `fathead` font. The initial committed content and editable draft are empty rather than prefilled with `https://example.com`; nothing refreshes until Generate is clicked. |
| “Listens to the input”                | The field is a draft. Typing never changes the mask, worker input, QR, or preview. Generate validates and commits the draft; only then does auto-mask derivation, mask Blob creation, and worker preparation begin. After that commit, configuration edits remain reactive.                                                                                  |
| Mask derivation                       | For a website-like value, keep the existing rule: first host letter after scheme and `www.`. For other non-empty text, use the first ASCII letter or digit in the trimmed value. Uppercase letters; preserve digits. Empty input selects blank; unsupported non-empty input falls back to `A`. Keep this rule in a pure helper with unit tests.              |
| “Mask Selection has selected by user” | Typing in the mask search/letter field, choosing a font, choosing blank, choosing an icon, or committing a Fill operation switches `origin` to `manual` and freezes the effective letter/art. Merely opening/closing the panel or icon gallery does not.                                                                                                     |
| Frozen mask                           | A committed-content change must not change `manualText`, `fontId`, `selectedIconId`, the committed mask Blob, or a fill edit. It still invalidates the old result and refreshes the QR preview with the new payload. An uncommitted draft must change none of these.                                                                                         |
| “Generate button”                     | Keep one header Generate button as the draft commit/apply action. It validates the draft, commits it as the new worker input, and starts the mask/preview refresh. Remove the old completion meaning: there is no required final Generate/Continue step, and settings changes update the preview automatically.                                              |
| “Slide in as modal”                   | On mobile, each side panel uses one native `<dialog>` node shown with `showModal()`, placed against its corresponding viewport edge, with a backdrop and a reduced-motion-aware slide transition. Mask comes from the left; QR details comes from the right. Desktop uses those same mounted panel instances as non-modal, in-flow sidebars.                 |

If product direction differs on the empty initial input or plain-text letter derivation, change those two decisions before Phase 2. Do not leave the behavior implicit in component effects.

## Invariants and non-goals

### Preserve

- PNG-only source/mask validation, 10 MiB and 4-megapixel limits, one-frame guards, and exact dimension matching.
- The existing browser-only worker architecture, Comlink transport, SHA-256 source cache, and revision-based stale-result rejection.
- `uqr` encoding defaults and every artistic-module, plate, marker, placement, rotation, protected-pixel, and schema-8 verification rule.
- The 450 ms automatic preparation debounce unless profiling during this work proves it is too slow. Input and mask UI feedback must be immediate even while the worker is debounced.
- `state.result` invalidation on every committed content/settings/placement/mask edit, and one assembled Blob shared by result preview and download. Draft typing alone must not invalidate a result.
- Exact placement controls, marker dialogs, Pattern settings, icon search, mask Fill, and all current error messages unless this plan explicitly relocates them.
- StyleX ownership: shared tokens/recipes in `src/styles/`; component layout beside the component; no new editor rules in `globals.css`.

### Do not add

- No render API, base64 transport, server action, route mutation, persistence, account state, service worker, URL payload synchronization, or paid API call.
- No renderer algorithm change, QR default change, new UI framework, drawer dependency, gesture library, or global state library.
- No separate mobile copy of either settings panel. The same component instance and lifted state must survive desktop/mobile breakpoint changes.
- No continuous prepare on invalid text and no icon search merely because the main content field changed.
- No e2e rewrite or `pnpm test:e2e` run until the maintainer has exercised the UI manually and explicitly asks for the browser journeys to be updated.

## Guidance to follow

Before client implementation, run the repository-mandated `modern-web-guidance` search again if its skill version has changed. The 2026-09-04 guides used for this plan were `forms`, `navigation-drawer`, and `performance`.

Apply their relevant constraints:

- Use a real `<form>`, visible label, named input, and `<button type="submit">` for the header control. Keep the field at least 16 px on mobile, tap targets at least 48 px, visible focus, `aria-describedby`, and `enterKeyHint="go"`.
- Do not show an error on each keystroke. Clear a visible error while correcting input; expose validation after blur or submit. Internal validity may still prevent a worker request.
- Do not disable **Generate** merely to hide invalidity. On invalid submit, reveal the error and focus the input. Disable it only while the draft commit/mask refresh is in flight to prevent duplicate commits.
- Keep immediate UI work separate from heavy processing. The worker remains responsible for prepare/assemble; rapid edits are debounced and stale results are dropped.
- Mobile modal panels require correct `aria-expanded`/`aria-controls`, Escape and backdrop dismissal, focus entry/return, background inertness, and reduced-motion behavior.
- The preview is above the fold. Do not lazy-load it as if it were below-the-fold media, and reserve its aspect-ratio space to prevent layout shift.

Before editing Next.js code, read the installed version's relevant documents, not remembered APIs:

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`

`Editor` remains the client boundary because it owns state, effects, file/canvas APIs, worker calls, dialogs, and event handlers. `next/dynamic` declarations stay at module scope; `ssr: false` stays inside a Client Component.

## Current code to reuse

| Existing area                                                          | Keep                                                                                              | Change                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/editor/Editor.tsx`                                     | Reducer ownership, Files, object URLs, engine hook, icon hook, placement edits, mask fill scaling | Remove `step`, `textConfirmed`, `fitRevealed`, `canEnter`, `goto`, and all Continue/Back transitions. Become the reactive controller for the header, three-column shell, drawer state, and generation.                    |
| `src/lib/editor/state.ts`                                              | Revision, committed content/settings/prepared/placement/result/busy/error, stale-response guards  | Set initial committed content to `''`. Keep the editable draft outside the renderer reducer (controlled local editor/header state). Keep result invalidation for committed edits. Do not put transient drawer state here. |
| `src/components/editor/hooks/use-engine-request.ts`                    | Worker client, transferable Files, debounce, revision guard                                       | Keep automatic prepare for committed content/settings/mask edits. Remove the header's prepare-then-assemble `generateLatest()` requirement; expose a current-revision prepare/request status for the reactive preview.    |
| `src/components/editor/hooks/use-mask-selection.ts`                    | Font/icon rendering and mask Blob creation                                                        | Drive it with an explicit pure auto/manual state machine, render signature, and async selection token. Expose `origin`, `effectiveMask`, `isFollowingInput`, `followInput()`, and `whenSettled()`.                        |
| `src/lib/editor/text-mask.ts`                                          | Font metadata, icon/search helpers, fitting                                                       | Add the pure reactive derivation helper and default constants. Do not overload `deriveMaskLetter()` with UI state transitions.                                                                                            |
| `StepMaskSearch.tsx` + `MaskPreviewCanvas.tsx`                         | Search, font tiles, icon gallery trigger, Fill, actual mask preview                               | Compose them into the persistent `MaskPanel`. Remove step numbers and Continue/Back controls. Add auto/manual status and **Follow input**. Make the canvas compact enough for the left column.                            |
| `PreviewPanel.tsx`                                                     | `Canvas`, result view, marker dialog, dimensions/status                                           | Make it the center panel for all editing states. Remove step branches and the embedded Pattern settings. Add updating/error overlays and mobile panel triggers.                                                           |
| `PatternSettings.tsx`                                                  | All current settings and mini previews                                                            | Render inside the right `QrDetailsPanel`; retain native radios and exact setting mutations.                                                                                                                               |
| `EditorHeader.tsx`                                                     | Wordmark and local-processing note                                                                | Accept controlled draft props and own the visible label/input/Generate status markup. Generate commits the draft only; it is not an export/completion control. Collapse gracefully to two rows on mobile.                 |
| `StepRail.tsx`, `StepInput.tsx`, `StepAdjust.tsx`, `StepGenerate.tsx`  | Nothing unique after migration except example buttons and explanatory copy                        | Remove from the render path in Phase 3. Move useful example buttons into the header form. Delete the obsolete files only after imports, docs, and tests no longer reference them.                                         |
| `IconGallery.tsx`, `MarkerDialog.tsx`, `ResultPanel.tsx`, `Canvas.tsx` | Existing behavior and dynamic boundaries                                                          | Keep. Verify nested modal focus when IconGallery opens from the mobile mask drawer.                                                                                                                                       |

## Target information architecture

### Desktop, wider than the editor mobile breakpoint

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ QR / COOL   Text or URL [________________________________] [ Generate ]      │
│             examples / validation / preparation or generation status        │
├───────────────────┬────────────────────────────────┬─────────────────────────┤
│ MASK SELECTION    │ PREVIEW CANVAS                 │ QR DETAILS              │
│ Auto · follows    │ live poster + movable QR       │ error correction        │
│ input             │ busy/error overlay             │ pixel style             │
│ [mask preview]     │ or assembled result            │ seed / rim / corners    │
│ search + fonts    │                                │ marker entry points     │
│ icons / fill      │                                │                         │
└───────────────────┴────────────────────────────────┴─────────────────────────┘
```

- Use a CSS grid resembling `minmax(15rem, 0.8fr) minmax(22rem, 1.7fr) minmax(18rem, 0.9fr)` and tune against real controls. The center must be the flexible column and every grid child must have `min-width: 0`.
- Switch to mobile before the three declared minimums can fit without horizontal scrolling. Start the implementation at `max-width: 900px`, verify 200% zoom and long localized labels, and raise the breakpoint if the center falls below a usable canvas width.
- The header is sticky at the block start. Side panels may have sticky internal headings and independent `overflow-y: auto`, but do not lock the page to exactly `100vh`; zoomed content must remain reachable. Use `svh`/`dvh` only for drawer bounds, not to clip the main document.
- The preview reserves a square/aspect-ratio area and may scale down. It must never force the sidebars outside the viewport.

### Mobile, at or below the breakpoint

```text
┌──────────────────────────────┐
│ QR / COOL                    │
│ Text or URL [______________] │
│ [ Generate ]                 │
├──────────────────────────────┤
│ [ Mask ]  PREVIEW [Details]  │
│                              │
│       live poster canvas     │
│                              │
│ status / placement controls  │
└──────────────────────────────┘

Mask trigger                   Details trigger
      ↓                               ↓
┌──────────────────────┐      ┌──────────────────────┐
│ left modal drawer    │      │ right modal drawer   │
│ mask controls        │      │ QR settings          │
└──────────────────────┘      └──────────────────────┘
```

- Only the header form, preview, preview status, canvas placement controls, and two drawer triggers are in the normal mobile flow.
- Each trigger is at least 48 px, has visible text plus an optional decorative icon, `aria-expanded`, and `aria-controls`.
- The drawer width is `min(24rem, calc(100dvw - 2rem))`; leave a visible strip of backdrop for light-dismiss. Use `100svh` as the stable maximum height and make the sheet itself vertically scrollable.
- The dialog close button stays first in the focus order. Opening focuses the drawer heading or first relevant field; closing returns focus to its trigger. Only one editor drawer can be modal at a time.
- The drawer enters from its physical requested side, while spacing and layout properties should otherwise use logical CSS properties. A future RTL pass may intentionally swap sides, but that is outside this change.
- Slide transitions are progressive enhancement. Under `prefers-reduced-motion: reduce`, open/close immediately. Failure of transition support must never prevent showing or closing the modal.

## Reactive state model

Keep renderer state in the existing reducer and mask-choice state in a new pure module. Do not encode UI modes by checking whether strings happen to be empty.

```ts
export type MaskOrigin = 'auto' | 'manual'

export interface MaskChoiceState {
  origin: MaskOrigin
  autoLetter: string
  manualText: string
  fontId: string
  selectedIconId: string | null
  selectedIcon: IconItem | null
  fillRevision: number
}
```

Recommended constants:

```ts
export const DEFAULT_AUTO_MASK = 'A'
export const DEFAULT_AUTO_MASK_FONT_ID = 'fathead'
```

The effective choice is derived, not mirrored:

```ts
const effectiveText = state.origin === 'auto' ? state.autoLetter : state.manualText
```

### Pure mask transitions

| Event                     | Auto mode                                                                                                        | Manual mode                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Committed content changes | Recompute `autoLetter`; keep the default auto font; schedule one mask render if the signature changed            | Do not alter mask choice or committed Blob |
| User edits mask field     | Copy entered value into `manualText`, switch to manual, clear selected icon if the letter preview becomes active | Update manual text; remain manual          |
| User chooses a font       | Freeze current effective character into `manualText`, set font, clear icon, render                               | Update font and render                     |
| User chooses blank        | Switch to manual blank, clear icon, render full-white mask                                                       | Same                                       |
| User chooses icon         | Switch to manual, store the selected item/id, render icon                                                        | Same                                       |
| User commits Fill         | Switch/stay manual and increment `fillRevision`; the filled Blob becomes authoritative                           | Same                                       |
| User clicks Follow input  | Switch to auto, recompute from current main input, clear icon/fill authority, restore default auto font, render  | Same                                       |

Use a stable render signature such as `origin|effectiveText|fontId|iconId|widthxheight|fillRevision`. Cache the last committed signature. A `prepared` response that repeats the same dimensions must not redraw a new File and bump the editor revision again; otherwise preparation will loop forever.

Font loading and icon fetching are asynchronous. Increment a selection token before each render. A completion may call `onUploadMask` only if its token is still current. This prevents a slow old font or icon from overwriting a newer user selection.

### Draft and committed-content flow

Keep two clearly named values in the editor controller:

- `draftContent`: the controlled header field. It changes on every keystroke and is never sent to the worker.
- `state.content`: the committed content. It changes only from a valid Generate submit and is the only value used by mask derivation, QR preparation, placement, assembly, and export.

An invalid or empty draft may show a field error, but it must not clear a good committed preview. Submitting a valid draft dispatches the normal reducer edit, increments the revision, and clears the old result. Clicking Generate again with the same draft is a no-op unless the committed revision has otherwise become stale.

```text
typing draftContent
  → immediate controlled field update only
  → no mask/worker/preview change

Generate submit with valid draft
  → commit draftContent as state.content and increment revision
  → auto-mask render if and only if mask origin is auto and signature changed
  → 450 ms debounced worker prepare for the committed revision
  → stale worker outcomes are ignored
  → current prepared Blob URLs replace old URLs
  → center canvas clears aria-busy and displays the current revision

committed settings/placement/mask edit
  → reducer edit increments revision and clears result/error/busy
  → immediate controlled UI update
  → 450 ms debounced worker prepare for the final File + editor revision
  → stale worker outcomes are ignored
  → current prepared Blob URLs replace old URLs
  → center canvas clears aria-busy and displays the current revision
```

Keep the last good preview visible while a newer revision prepares, but mark the panel `aria-busy="true"`, add a non-blocking **Updating preview…** veil/status, and do not present the stale preview as export-ready. Do not tear down and recreate the canvas on every keystroke.

### Generate commit flow

Generate is a draft commit, not an assembly operation.

1. Validate `draftContent` with `contentSchema`. If invalid, return a typed validation outcome; the header reveals the message and focuses the input. Do not dispatch an edit or start the worker.
2. If the draft equals the committed content, keep the current preview and return without incrementing the revision.
3. If the draft differs, dispatch the normal content edit. The mask hook observes the newly committed value, updates its auto letter, and exposes `whenSettled()` for the preparation coordinator.
4. The debounced prepare request uses the committed content and the settled mask File. The center preview becomes current when its prepared revision matches the reducer revision.
5. Configuration edits after the commit use the existing edit → debounce → prepare path. They must update the center preview without any completion button or step transition.
6. Preserve the existing assemble/result/download code as an explicit export concern if the product still exposes it, but do not navigate to `ResultPanel` as a consequence of typing, Generate, or changing settings.

Do not infer commit success from a later `useEffect` observing reducer state. The header submit handler should own validation/no-op/dispatch, while the existing revision guard owns worker freshness.

## Component design

### `EditorHeader.tsx`

Turn the header into a controlled form component with these props:

- `content`, `contentError`, `busy`, and a concise preview/generation status.
- `onContentChange`, `onContentBlur`, `onSubmit`, and existing example selection.

Markup requirements:

- Keep the wordmark link.
- Use `<form noValidate>` only if Zod remains the sole source for custom capacity/newline messages; retain native `required`/`maxLength` where they exactly match the schema.
- Use a single-line `<input type="text" id="content" name="content">`, not the current textarea. Set `enterKeyHint="go"` and associate hint/error text through `aria-describedby`.
- Use `<button type="submit">Generate</button>`. While committing/refreshing, keep the button's accessible name understandable (for example **Applying…**); this control does not assemble or download a poster.
- Retain the Hello and Website examples as compact secondary buttons below or beside the field. They call the same content-change path and therefore obey mask auto/manual behavior.
- Put the local-processing promise in secondary copy; hide or shorten it at narrow widths without hiding the field label.

### `MaskPanel.tsx`

Create `src/components/editor/MaskPanel.tsx` by adapting `StepMaskSearch`.

- Heading: **Mask selection**; no step number.
- At the top show a text status, not color alone: **Following input · blank** for empty input, a derived letter for committed content, or **Custom mask · A / icon / blank**.
- In auto mode, explain that the mask changes with the content. In manual mode, show **Follow input**.
- Put a compact `MaskPreviewCanvas` before the large tile grid so the blank initial mask or derived letter is obvious.
- Keep the mask search field, 3×4 font grid, icon search, notes, errors, and Fill tool.
- Rename legacy step-specific ids and comments. Parameterize any id referenced by labels if the panel wrapper needs a stable drawer id.
- Remove Continue/Back and `canContinue` props. Fit failures belong to the center status and may also be repeated in the mask panel when actionable there.
- Preserve the icon gallery as a separate dynamically loaded native dialog. Test focus return to the search button when it is opened from inside the mask drawer.

### `QrDetailsPanel.tsx`

Create `src/components/editor/QrDetailsPanel.tsx`.

- Heading: **QR details**; include current encoded content in a wrapping metadata line.
- Render `PatternSettings` unchanged first; later cleanup may rename its heading to avoid **QR details / Pattern settings** duplication.
- Add visible buttons or summaries for finder and alignment marker settings if required to make the existing marker dialogs keyboard-reachable. Do not remove marker clicking from the canvas.
- Preparation errors caused by ECC/style growth may be summarized here and fully announced in the center status.
- No Generate/Continue completion button lives in this panel. The header Generate button remains the draft commit action.

### `PreviewPanel.tsx`

Simplify to four mutually exclusive center states:

1. No valid committed input/source yet: stable placeholder explaining that entering text or a URL and clicking Generate starts the preview.
2. Preparing without a prior prepared value: stable canvas skeleton/status.
3. Editing with a prepared placement: existing `Canvas`, dimensions badge, placement hints, and marker interaction.
4. `showingResult && result`: existing `ResultPanel` and Return to editing.

The current step-2 mask branch and settings cell move out. Keep `MarkerDialog` next to the canvas controller. Add mobile **Mask** and **QR details** trigger buttons to the preview heading/tool row; CSS hides them on desktop.

Use both revision and busy state to decide whether the displayed canvas is current. A generic `!!state.error` is not enough: distinguish content errors, mask/placement preparation errors, and an assembly error in copy and `aria-live` treatment.

### `ResponsiveEditorPanel.tsx`

Create one small primitive for each side panel instead of duplicating modal logic.

Suggested props: `id`, `side: 'left' | 'right'`, `labelledBy`, `mobileOpen`, `onMobileOpenChange`, `triggerRef`, and `children`.

Implementation contract:

- Render one native `<dialog>` node per panel and keep it mounted.
- Mirror the CSS breakpoint with `matchMedia`. Before paint, use `dialog.show()` and in-flow/static dialog styles on desktop. On mobile, close the non-modal dialog until the trigger calls `showModal()`.
- When the viewport crosses the breakpoint, normalize dialog state: mobile → desktop closes any modal then calls `show()`; desktop → mobile calls `close()` and resets `aria-expanded`.
- On mobile handle `cancel`, explicit close, and a genuine backdrop pointer click. Do not close when pointer-down starts in the sheet and pointer-up ends outside.
- Native modal behavior provides top-layer placement and background inertness. Verify rather than recreating a focus trap.
- Restore focus to the correct trigger. Do not restore to a node hidden by the breakpoint.
- Keep the slide class until the close transition completes, then call `close()`. Reduced motion bypasses the wait. A timeout fallback must ensure a missing `transitionend` cannot strand an open modal.
- Expose no desktop-only `role="dialog"` announcement if testing shows it is confusing. The primitive may set `role="complementary"` for non-modal desktop and native dialog semantics only for mobile.

Build this primitive and its resize/focus behavior before moving the large forms into it. If native non-modal `<dialog>` cannot behave as an in-flow grid item in the supported browsers, stop at the checkpoint and choose one of these fallbacks in order: a single portal-able panel node, then a fixed overlay with explicit `inert` and focus management. Do not duplicate the settings DOM.

## Implementation sequence for GPT-5.6 Luna

Keep each phase reviewable. Do not mix renderer changes into these commits.

### Phase 0 — Baseline and documentation check

1. Read `AGENTS.md`, this plan, the modern web guidance, and the installed Next.js client/lazy-loading docs named above.
2. Run `git status --short`; preserve unrelated user changes.
3. Run the required baseline: `pnpm test`, `pnpm typecheck`, and `pnpm build`. Record any pre-existing failure before editing.
4. Start the production app only if needed for inspection. Do not run e2e.

Checkpoint: baseline results are known and no renderer file needs to change.

### Phase 1 — Pure automatic/manual mask state

1. Add pure derivation/defaults and a mask-choice reducer in `src/lib/editor/`.
2. Add unit tests for URL, plain text, digit, empty/unsupported fallback, auto updates, every manual-freeze event, and Follow input.
3. Refactor `use-mask-selection.ts` around that reducer without changing the visible step UI yet.
4. Add render-signature de-duplication and async token protection. Expose a Promise or explicit settled state so the committed-content preparation coordinator can wait for the automatic mask.
5. Verify the existing step UI still works before changing layout.

Checkpoint: `pnpm test` and `pnpm typecheck` pass; no repeated prepare loop occurs while leaving the current mask step open.

### Phase 2 — Draft commit and reactive preview orchestration

1. Keep the worker request hook focused on debounced committed-revision preparation and the existing explicit assembly API. Do not add a header `generateLatest()` prepare-then-assemble operation.
2. Preserve transferable bytes and cache behavior. Avoid reading a File twice when a committed revision can reuse the same snapshot safely.
3. Return typed outcomes and test stale capture behavior through reducer/engine unit tests.
4. Change initial content to empty and create the blank poster source on editor mount (or first client layout) so the workspace can react without a Continue gate.
5. Ensure the auto-mask render settles before the matching committed revision enters prepare.

Checkpoint: an imperative unit/integration path can type a draft without changing the preview, click Generate to commit it, and observe a prepared current revision; configuration edits then refresh the preview without a completion action.

### Phase 3 — Desktop single-screen shell

1. Expand `EditorHeader` into the controlled form.
2. Add `MaskPanel` and `QrDetailsPanel`; move existing UI rather than reimplementing settings.
3. Simplify `PreviewPanel` to center-preview/result states.
4. Replace the step rail/workspace branch in `Editor.tsx` with the three-column grid.
5. Remove step warmers. Re-evaluate dynamic imports by visibility: Canvas is central; IconGallery remains on demand; ResultPanel and marker dialogs may remain dynamic; PatternSettings is immediately needed on desktop.
6. Remove the obsolete step state and transition functions. Keep old step files until compilation and manual review are green.
7. Add immediate status and error routing. Generate from the header must commit the draft without visiting a panel; no step completion is required.

Checkpoint: at desktop width, all three columns are present; draft edits do not move the preview; Generate commits and refreshes the auto mask/preview; a user-chosen mask survives later committed content edits; settings update the preview automatically.

### Phase 4 — Mobile modal drawers

1. Implement and prove `ResponsiveEditorPanel` with tiny placeholder content first.
2. Move the same MaskPanel and QrDetailsPanel instances into the left/right responsive wrappers.
3. Add mobile triggers to the preview toolbar and wire `aria-controls`/`aria-expanded`.
4. Add side-specific slide transitions, backdrop, Close buttons, reduced-motion behavior, focus entry/return, Escape/backdrop dismissal, and breakpoint normalization.
5. Exercise icon-gallery nesting, on-screen keyboard behavior in mask search, page scroll locking, and rotation between portrait/landscape.

Checkpoint: at 320 px only header + preview are in normal flow; each panel opens from the correct side, is fully keyboard operable, dismisses through every promised path, and never loses mask/settings state.

### Phase 5 — Cleanup, documentation, and manual review

1. Delete `StepRail.tsx` and obsolete `steps/` components only after `rg` confirms no imports, tests, or docs still require them.
2. Remove step-number copy, step-only CSS, comments, preload logic, and state.
3. Update `README.md` Editing/Architecture sections and `doc/plan/web-qr-poster.md` to describe the shipped reactive workspace. Mark this plan's status and completed phases.
4. Run `pnpm lint`/`pnpm format:check` if changed files require cleanup, then the mandatory `pnpm test`, `pnpm typecheck`, and `pnpm build`.
5. The maintainer manually exercises desktop and mobile behavior. Stop here for browser-journey approval.

Checkpoint: required commands pass and the maintainer approves the UI behavior.

### Phase 6 — Browser journey migration, only when requested

After explicit maintainer instruction:

1. Replace step navigation helpers in `e2e/editor.spec.ts` with dashboard readiness helpers.
2. Rewrite `e2e/features/text-input.feature`, `mask-search.feature`, `adjust-qr.feature`, and `poster-journey.feature` so they describe draft-vs-committed input, auto-follow, manual freeze, desktop columns, mobile drawers, automatic preview updates, and result invalidation.
3. Update the corresponding Cucumber steps; keep icon APIs mocked and preserve the no-render-API assertion.
4. Run only the requested suites (`pnpm test:e2e` and/or `pnpm test:bdd`) after the manual browser pass.

## Verification matrix

### Unit and integration coverage

- Initial content is empty; initial visible auto mask is blank/full-canvas, then non-empty committed content derives a letter with the declared default font.
- `https://example.com` derives `E`; `www.XYZ.com` derives `X`; `Hello QR / COOL` derives `H`; `123` derives `1`; unsupported/empty content falls back to `A` for mask display while remaining invalid QR content when empty.
- Typing at least three draft edits leaves the committed mask/QR/preview unchanged; clicking Generate once commits the final draft and auto mode settles on the matching mask without stale async work winning.
- Manual typing, font, blank, icon, and Fill each freeze the mask independently.
- Follow input clears icon/fill authority, restores the default auto font, and immediately catches up to current content.
- Repeating a prepared dimension does not create an infinite mask File/revision loop.
- An invalid draft never increments the reducer revision or starts preparation; a valid changed draft commits once; clicking Generate again with the same draft is a no-op.
- Reducer edits still clear result/showingResult and ignore stale prepared/result/error actions.
- Blob URL lifecycle and exact result Blob sharing remain covered.

### Manual desktop checks

- 1280×800 and a width just above the chosen breakpoint show three usable columns without horizontal page scroll.
- Header remains reachable; sidebars can scroll to every control; the center canvas has stable dimensions.
- Keyboard order is header input → Generate/examples → Mask controls → canvas/tools → QR controls, or another documented logical order that does not jump unpredictably.
- Changing content rapidly shows immediate controlled text, an updating status, and only the newest prepared QR.
- Typing does not refresh the preview before Generate. Generate immediately after typing commits the final draft, not the prior draft; the preview then becomes current after preparation.
- After a commit, changing ECC, pixel style, seed, rim, placement, or mask selection refreshes the preview automatically without a completion click.
- Selecting a font/icon/blank/fill and then editing content keeps the chosen mask.
- ECC/pixel/seed/rim and placement edits react without a step transition.
- Marker dialogs, result return, artifacts, and download still work.

### Manual mobile and accessibility checks

- Test 320×568, 390×844, landscape, coarse pointer, and 200% browser zoom.
- The input remains at least 16 px and the field/button are not obscured by the on-screen keyboard.
- Normal flow contains no hidden sidebar gap and no horizontal scroll.
- Drawer triggers and close controls are at least 48 px with visible focus.
- Left and right drawers announce their headings, keep focus inside while modal, close on Escape/backdrop/Close, and restore focus.
- Opening the icon gallery from the mask drawer and closing it returns to a sensible control without closing or corrupting the underlying selection.
- Reduced motion removes slide animation but not modal behavior.
- Screen-reader status is concise: do not repeatedly announce every keystroke; announce validation failures, meaningful prepare failures, committed-preview refresh, and result/export readiness.

### Regression commands

Required before implementation handoff:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Do not run `pnpm test:e2e` as a routine phase gate. Run it only in Phase 6 after the requested journey update.

## Risks and controls

| Risk                                                         | Control                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto mask Blob redraw causes a revision/prepare loop         | Stable render signature includes dimensions; upload only when signature differs; unit test repeated prepared dimensions.                                                                                   |
| A slow icon/font response overwrites a later choice          | Monotonic selection token checked before committing Blob or state.                                                                                                                                         |
| Draft edits accidentally refresh the preview                 | Keep `draftContent` separate from committed `state.content`; only valid Generate submit dispatches the content edit.                                                                                       |
| Generate commits the previous draft                          | Read the current controlled draft in the submit handler and dispatch that exact value; tests cover typing → immediate submit.                                                                              |
| Rapid committed-content edits overwhelm mask canvas/worker   | Synchronous committed derived label for immediate feedback, one mask-render task per signature, existing 450 ms prepare debounce, worker stale dropping.                                                   |
| Desktop/mobile switch loses settings or duplicates ids       | One mounted panel instance; responsive dialog changes presentation, not component identity.                                                                                                                |
| Non-modal desktop `<dialog>` has poor layout/semantics       | Prove the primitive before panel migration; use the documented single-node fallback, never duplicated controls.                                                                                            |
| Drawer animation strands the dialog open/closed              | Native dialog is the source of modal state; reduced-motion direct path and timeout fallback around close transition.                                                                                       |
| Hidden mobile panels inflate initial JS                      | Measure the new build. Preserve dynamic IconGallery/Result/Marker boundaries and only defer QR details if it does not make desktop appear incomplete.                                                      |
| Region too small no longer has a Continue click to reveal it | Show fit failure after current prepare in center status and relevant mask panel; the next valid configuration edit re-prepares automatically and the header submit can re-announce the actionable surface. |
| Behavior docs and browser tests remain step-based            | Update README/web plan in Phase 5; update e2e/Gherkin only after explicit manual-review request in Phase 6.                                                                                                |

## Definition of done

- No step rail, step gate, Continue, Back, or step-dependent preview branch remains in the shipped editor. The one header Generate button is only the draft commit/apply action.
- Desktop header + three-column layout and mobile header + preview + two modal drawers match the requested information architecture.
- Initial empty-input mask is visibly blank; non-empty auto-follow and every manual-freeze transition are deterministic and tested; **Follow input** restores reactivity.
- Header Generate commits only the newest valid draft and preserves stale-response safety; it is not required to complete/export the poster.
- After a commit, every supported configuration change updates the live preview automatically without a completion click.
- Existing placement, styles, marker controls, assembly, verification, artifacts, and exact Blob download behavior remain intact.
- Keyboard, screen-reader, touch, reduced-motion, zoom, resize, and mobile modal behaviors pass the manual matrix.
- `README.md` and `doc/plan/web-qr-poster.md` describe the new behavior.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass. Browser suites are updated and run only when the maintainer requests Phase 6.
