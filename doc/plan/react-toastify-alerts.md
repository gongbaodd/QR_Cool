# Move editor alerts and errors to React-Toastify

Status: **implemented; manual browser review pending**.

## Goal

Show editor errors and action feedback in React-Toastify notifications outside the document flow. The poster preview, including `canvas[role="img"]` and the Konva canvas, should keep the same vertical position as messages appear, change, and clear.

## Current layout changes

| Source                               | Current presentation                                                                                                                 | Planned presentation                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Content validation                   | `EditorHeader.tsx` replaces the header status with an inline alert; `Editor.tsx` can add the same draft error below the whole editor | One content-error toast, with `aria-invalid` and a stable field description                                                           |
| Preparation, assembly, and placement | `PreviewPanel.tsx` adds an alert below the preview; `Editor.tsx` also adds `PreparationError` with Retry                             | One document-error toast; worker failures offer the matching Retry action, while invalid placement stays editable and blocks assembly |
| Icon search                          | `MaskPanel.tsx` inserts an alert into the panel                                                                                      | One icon-search toast tied to the active query                                                                                        |
| Region fill                          | `PreviewPanel.tsx` inserts fill success, open-area warning, save progress, and failure text above the preview                        | Toasts for outcomes and failures; a single progress toast may be updated to success or error                                          |
| Preview refresh                      | `PreviewPanel.tsx` inserts an “Updating preview…” banner above the toolbar                                                           | Keep progress on existing busy controls and `aria-busy`; remove the inserted banner                                                   |
| Fill instructions                    | Toggling Fill region inserts an instruction line above the canvas                                                                    | Keep the instruction in a toolbar slot with a fixed height, or in control help that does not change the preview position              |

Static labels, selected-mask descriptions, and persistent scanning guidance remain part of their controls and panels. They convey context rather than event alerts.

## Implementation plan

1. Add `react-toastify` as a direct dependency. Mount exactly one `ToastContainer` within the client editor workspace, outside the three-column editor layout. Place it at a viewport edge with mobile safe-area spacing so notifications do not cover the canvas controls. Use the library's current styling entry point and StyleX-compatible theme values; keep `globals.css` within its existing project rule.
2. Add a small editor notification bridge at the workspace level. Observe the existing Zustand error state and selected content error rather than storing toast text in Zustand or Zundo. Give each source a stable toast ID (`content`, `document`, `icon-search`, `region-fill`) so rerenders, React Strict Mode, and repeated preview revisions cannot stack duplicate alerts. Update an active toast when its message changes, dismiss it when its underlying error clears or the source changes, and ignore stale async outcomes.
3. Consolidate document errors in `Editor.tsx`. Remove the duplicate preview alert and the separate bottom draft alert. Replace `PreparationError`'s inline block with a persistent error toast. Have `useEngineRequest` expose the mode of the last failed worker request so the toast offers **Retry preparation** or **Retry assembly** as appropriate; placement validation errors need guidance to move the QR, not a retry. Keep `document.error`, `document.field`, validation, and `canAssemble` as the authority for disabling export; a dismissed toast must not clear an error. Use the existing placement invalid styling and keep the canvas mounted so the user can drag or rotate to fix it.
4. Move content and icon-search errors into the bridge. Content validation should still appear only after blur or Generate, as `selectVisibleContentError` currently specifies. Retain `aria-invalid` and an error description associated with the content input without adding a visible line that changes the sticky header height. Keep the icon query association and clear its toast when a new search begins or the error is resolved. Do not toast routine typing or every preview update.
5. Replace `fillStatus` display in `PreviewPanel.tsx` with notifications issued from the fill action and guarded image-load/Blob callbacks. Use warning for an open region, error for load or save failures, and success for a completed fill. Update or dismiss a single progress notification during save. Preserve `fillPending`, source-mask readiness, and generation guards so messages from obsolete masks cannot surface later.
6. Remove the preview refresh banner and prevent the Fill region hint from growing or shrinking the space above either editing canvas. Keep real busy state visible in button text, disabled controls, and `aria-busy`. Review the header status slot and preview toolbar at desktop and mobile widths so long messages and toast appearance leave the canvas top unchanged.
7. Update `README.md` and `doc/plan/web-qr-poster.md` when implemented. Remove `PreparationError.tsx` if it has no caller. Keep error state in the reducer and store unchanged apart from any small selector needed by the notification bridge.

## Notification behavior

- Error toasts use an assertive announcement; success and routine progress use a polite status. Avoid announcing the same message through both an inline `role="alert"` and a toast.
- Critical document and placement errors remain visible until corrected, retried, or manually dismissed. A toast can be dismissed independently of the underlying invalid state. Short-lived fill success and warnings may auto-close.
- Notifications have a close control and remain keyboard reachable. Retry is an actual button in the toast. Limit visible notification count without hiding an unresolved critical error behind a queue.
- Stable source IDs and update/dismiss behavior follow React-Toastify's documented `toastId`, `toast.update`, and `toast.dismiss` APIs. The library documents a single container and supports per-toast ARIA roles and labels.

## Review checklist

1. With the region preview visible, cause a content error, icon-search error, invalid fill click, and mask load/save failure where practical. Confirm each appears once as a toast and the canvas top stays in place.
2. With a QR visible, drag or rotate it into an invalid placement, wait for the preview request, then correct it. Confirm the canvas remains interactive, assembly is disabled while invalid, the error toast clears after correction, and no older request reopens it.
3. Trigger preparation and assembly failures. Confirm one persistent error toast and a working Retry action where applicable, with no duplicate inline error.
4. Toggle Fill region and change settings while preview refreshes. Confirm neither the busy state nor fill instruction moves the canvas vertically. Check desktop and mobile widths, keyboard focus, and screen-reader announcements.
5. Confirm the editor remains usable if a toast is manually dismissed. The reducer's validation state, field invalid state, and export gate must still reflect the real error.

Automated test, typecheck, build, and end-to-end commands run only on an explicit verification request under `AGENTS.md`; the maintainer reviews UI behavior in the browser.

## Implementation notes

- Added React-Toastify 11.1.0 and one viewport-level container in the editor workspace, with safe-area spacing and the editor palette.
- Replaced inline content, document, icon-search, and fill alerts with stable toast IDs. Document retry actions use the mode recorded by the latest failed worker request.
- Kept content error text available as the input's accessible description, and retained the existing reducer validation and assembly gate.
- Removed the preview refresh banner and dynamic fill message rows. The toolbar keeps a fixed instruction slot, and image/Blob callbacks check their source generation before showing feedback.
- Updated README and the active web editor design record. Automated verification and manual browser review were not run in this implementation turn.

## References

- [React-Toastify installation and single-container guidance](https://fkhadra.github.io/react-toastify/installation/)
- [React-Toastify accessibility guidance](https://fkhadra.github.io/react-toastify/accessibility/)
- [React-Toastify duplicate prevention and toast updates](https://fkhadra.github.io/react-toastify/prevent-duplicate/)
