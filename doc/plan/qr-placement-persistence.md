# Preserve QR placement through preview and assembly

Status: **implemented**; browser review remains with the maintainer.

## Problem and cause

Dragging, resizing, rotating, or nudging the QR calls `movePlacement` in `src/lib/editor/store.ts`. That action stores the canonical placement and increments the document revision. The revision schedules a debounced automatic preparation in `src/components/editor/hooks/use-engine-request.ts`.

The request hook included `document.placement` and `previousTotalModules` only for non-automatic requests. The automatic preparation therefore reached `applyPlacement` without a requested placement, which made the engine choose a fresh automatic position. When its response arrived, the `prepared` reducer in `src/lib/editor/state.ts` replaced the stored placement with that new position. Assembly then read the reset position. The Zundo trace already records placement and revisions, so this sequence can be inspected without adding persistent state.

## Intended behavior

- Once a QR has been prepared, the user's latest `{ x, y, size, rotation }` remains the authoritative placement across reactive preview updates and assembly.
- The first preparation with no placement still auto-places the QR.
- Existing source reset actions, such as replacing the mask, may clear placement and start a new auto-placement. Keep those resets explicit in the store.
- A content or error-correction change that changes the QR module count passes the previous module count to `applyPlacement`, so the existing resize and recenter logic keeps the user's chosen center and rotation before validation.
- If a moved or rotated placement becomes invalid, display the placement error and leave it in place. Do not silently choose another location or allow an invalid export.
- An assembled result and Return to editing show the same placement that was last accepted for the current document revision.

## Implementation plan

1. In `use-engine-request.ts`, build both preparation and assembly inputs from the current store snapshot. Include `document.placement` whenever it exists. For preparation, include `document.prepared.qrMetadata.totalModules` as `previousTotalModules` whenever both the placement and prepared metadata exist. Remove the redundant `automatic` argument.
2. Keep the request's revision and operation-token checks around asynchronous file reads and worker completion. Review the path where a new drag arrives while a preparation is running, and ensure only the latest revision can call `acceptPrepared`. Keep the existing assembly timer cancellation.
3. Keep `state.ts`'s prepared response as the source of validated placement and error status. Check that it receives a response based on the requested placement, including resize/recenter when module count changes. Preserve the explicit `reset: true` behavior for source replacements.
4. Review the Konva commit paths in `PreviewPanel.tsx` and the `movePlacement` action. Drag, resize, rotation, arrow keys, and touch nudges should all submit canonical placement while preserving the other placement fields. No additional component-local copy of placement is needed.
5. Update `README.md` and `doc/plan/web-qr-poster.md` when the fix is implemented so they state that reactive preview and the assembled result retain the last user placement.

## Review checklist

1. Generate a QR, drag it away from the suggested location, wait past the 450 ms preview debounce, and confirm the preview stays at the chosen location. Assemble and inspect the result. Return to editing and confirm the same placement.
2. Repeat with corner resize, free rotation, arrow-key movement, and touch nudge buttons. A styling or rim change should refresh the preview without resetting placement.
3. Change content or error correction so the module count changes. Confirm the QR resizes around its previous center, retains rotation, and either stays valid or shows an invalid-placement error in place.
4. Trigger rapid consecutive moves while preparation is pending. Confirm an older worker result cannot overwrite the final move. Use the existing `getEditorTrace(store)` timeline to compare placement and revision transitions if the reset recurs.
5. Confirm first preparation still auto-places and a mask replacement still follows its explicit placement reset. Confirm invalid placement disables assembly.

Implementation note: preparation and assembly now receive the current placement; preparation also receives the prior QR module count for center-preserving resize. The Konva canvas stays mounted during preview refresh and remains available to correct a placement error. Automated checks and browser review were not run in this change. The maintainer exercises UI work in the browser. Do not run `pnpm test`, `pnpm typecheck`, `pnpm build`, or `pnpm test:e2e` unless explicitly requested under `AGENTS.md`.
