# Preview panel canvas, fill, and rim plan

Status: **implemented**.

## Intended behavior

`PreviewPanel.tsx` owns the complete editing preview, including the interactive QR canvas behavior currently in `Canvas.tsx`. The **Fill region** and **Add Rim** controls appear in one toolbar for both the highlighted-region view and the view with a QR code. They remain usable when the QR is shown. The assembled-result view keeps its existing result actions.

“Active when the QR code is shown” means the controls are visible and operable in that view. **Fill region** remains an explicit mode that the user turns on before clicking an enclosed area; it does not automatically fill anything. **Add Rim** reflects `settings.rimModules !== 0` and keeps the existing 0/1-module toggle behavior. The initial one-module rim is already active in editor defaults.

## Layout before implementation

- `PreviewPanel.tsx` renders `RegionPreview` when content is empty or placement preparation has failed. Only this branch renders the Fill/Rim toolbar.
- When preparation is current, `PreviewPanel.tsx` renders the lazy `Canvas.tsx` component. That component owns the Konva stage, region visibility checkbox, QR placement/rotation/resize, marker hit targets, keyboard and button nudges, and validity border.
- `RegionPreview.tsx` fills the **source mask** through `fillMaskImageData`, then sends a PNG Blob to `Editor.tsx` for `actions.replaceMask`. The QR canvas currently receives the worker-prepared region mask and overlay for display; those are not the editable source mask.
- A fill click in the QR view must map the visible poster point to source-mask pixels. It must not accidentally drag the QR, open a marker dialog, or use the rendered overlay as the editable mask.

## Proposed component and interaction design

1. Move the QR canvas behavior and its StyleX rules from `Canvas.tsx` into `PreviewPanel.tsx`; remove the separate `Canvas.tsx` after its callers are gone. Keep the Konva stage and its existing placement behavior. `PreviewPanel.tsx` becomes the single owner of the editing toolbar, canvas mode, fill status, region visibility, and marker dialog. Review the cost of moving `react-konva` out of the current lazy component while implementing; keep the initial editor load reasonable without duplicating preview state.
2. Render one Fill/Rim toolbar above either editing preview. Keep the controls as semantic buttons with `aria-pressed`, visible focus, and text state, and keep the Escape shortcut and hint for fill mode. Hide that editing toolbar in the assembled-result view.
3. Share one source-mask fill operation between the region-only and QR views, either through a small hook/helper or a common canvas data owner. Load `sourceMaskUrl` at original poster dimensions, call the existing `fillMaskImageData`, commit the resulting PNG through `onMaskFillCommit`, and show the same status/error feedback in both views. Reuse the source-mask pixel buffer across clicks. Cancel or ignore pending image loads and `toBlob` callbacks when the source mask, poster, or editing view changes.
4. In the QR view, handle fill clicks only when fill mode is on. Convert the stage pointer position through its display scale to integer poster/source-mask coordinates. Accept clicks on poster background; ensure QR drag handles, the QR plate, and marker targets do not trigger a fill. When fill mode is off, retain all existing drag, resize, rotate, marker, keyboard, and nudge interactions. Give fill mode a crosshair cue and a concise instruction.
5. Show the selected-region change immediately after a successful fill, then let the existing mask replacement and worker preparation refresh the QR and overlay. During that refresh, prevent another click from committing against an obsolete source mask. Preserve the selected fill mode across the refresh only if its source mask has caught up; otherwise exit it and require a new click on **Fill region**. Keep the current revision guard and result invalidation behavior.
6. Use `pattern.onSettings` for the same rim toggle in both editing views. The selected state must update from `settings.rimModules` after the reactive preparation cycle, including when the QR is visible. Keep thickness and rounded-rim options in Pattern settings and leave the rendering algorithm unchanged.

## Files expected to change during implementation

| File                                     | Work                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/components/editor/PreviewPanel.tsx` | Own the shared toolbar and QR canvas behavior; coordinate fill and marker/placement interaction.                       |
| `src/components/editor/Canvas.tsx`       | Remove after moving its behavior into the panel.                                                                       |
| `src/components/editor/Editor.tsx`       | Keep passing the editable `sourceMaskUrl`, prepared preview URLs, and existing callbacks; adjust props only as needed. |
| `src/lib/editor/mask-fill.ts`            | Reuse the current algorithm; extract only small browser-independent helpers if necessary.                              |
| `README.md`, `doc/plan/web-qr-poster.md` | Update the shipped-behavior description once implemented.                                                              |

## Acceptance for the implementation

- With empty content or a QR placement error, the highlighted-region preview still supports Fill region and Add Rim.
- With a visible QR, the same two controls are available. Filling a closed area updates the selected region and the refreshed QR preview; clicking an open/invalid area reports a status without changing the mask.
- Fill clicks work at scaled desktop and mobile canvas sizes. Clicking or touching the QR itself cannot silently fill the underlying mask. Escape exits fill mode.
- With fill mode off, QR dragging, corner resize, free rotation, marker dialogs, region visibility, arrow-key nudges, and touch nudge buttons behave as before.
- Toggling Add Rim while the QR is visible changes `rimModules` between 0 and 1 and updates its pressed state and prepared preview. The renderer's protected-pixel and export verification rules remain intact.
- Both editing views retain their selected mask and settings through the normal reactive transitions. The result view does not show editing controls.

## Implementation order and review gates

1. Consolidate the toolbar and fill state in `PreviewPanel.tsx`; retain the two existing preview branches. Review both layouts, control labels, and keyboard focus.
2. Share source-mask fill handling and add fill hit testing to the QR stage. Review scaled coordinates, QR/marker event isolation, and stale Blob callbacks.
3. Move the remaining `Canvas.tsx` behavior into the panel, remove the old file, and inspect the bundle/loading effect of the Konva import. Review placement and marker interactions at desktop and mobile widths.
4. Update README and `web-qr-poster.md` to describe the finished behavior. The maintainer can then perform the browser walk-through. Run `pnpm test`, `pnpm typecheck`, `pnpm build`, or `pnpm test:e2e` only if explicitly requested under `AGENTS.md`.

Implementation note: the shared toolbar uses semantic buttons with pressed states and live fill status. `PreviewPanel.tsx` now owns the Konva canvas interactions and the source-mask fill buffer. The browser verification walk-through remains for the maintainer; repository instructions reserve automated test, typecheck, and build commands for an explicit request.
