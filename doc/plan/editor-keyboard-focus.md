# Editor keyboard order and focus outline

Status: proposed. This plan records the intended UI change; implementation and browser review are pending.

## Goal

On the editor's initial URL view, the URL/Text entry field is the first control reached by Tab. Keyboard focus is clearly visible on every editor control with the same dotted vermilion outline as the intended mask-selection treatment. The order remains understandable in desktop columns, mobile drawers, and modal dialogs.

## Current behavior

- `EditorHeader.tsx` renders the Home logo link, seven content-type buttons, and then the URL/Text/Phone input. That DOM order makes the input the ninth tab stop on the initial view.
- Mask selection uses `ui.field` and `ui.button` from `src/styles/ui.stylex.ts`. Their focus outline is currently **3px dashed** `tokens.accent` with a 3px offset. The requested dot style therefore requires changing this reference treatment to `dotted` as part of the unification.
- The content-type and example buttons in `EditorHeader.tsx`, the color picker triggers and pixel-style radio cards in `PatternSettings.tsx`, and some custom controls rely on browser or component-specific focus behavior. The error-correction range and `MarkerDialog.tsx` controls use solid outlines. The poster surface and SVG marker targets need their own visible keyboard treatment.
- `ResponsiveEditorPanel.tsx` uses `tabIndex={-1}` on a drawer heading only to receive programmatic focus. `PreviewPanel.tsx` uses `tabIndex={0}` on the keyboard-editable poster surface and conditionally on marker targets. Those are functional focus targets, not ordering shortcuts.

## Implementation plan

1. **Make the content input first in a coherent reading order.** In `EditorHeader.tsx`, render the simple URL/Text/Phone input before the content-type choices and Home link. Arrange the header so the visible order follows the DOM order at desktop and mobile widths. Preserve the Home link as a reachable control and keep the content-type choices in their existing relative order. For WiFi, SMS, Email, and QRCode, which use a dialog instead of the simple input, put the "Edit details" trigger in the same first position. Do not use positive `tabIndex`, mount-time autofocus, or a key handler that intercepts Tab.
2. **Create one focus treatment in StyleX.** Add a reusable `:focus-visible` recipe in `src/styles/ui.stylex.ts`: 3px `dotted` `tokens.accent`, 3px offset, with enough room around the control to avoid clipping. Apply it to shared fields, buttons, links, checkboxes, summaries, and the header's content-type and example buttons. Remove duplicated local focus declarations where the shared recipe covers them. Keep the existing selected, invalid, hover, and disabled styling independent of keyboard focus.
3. **Cover custom controls.** Use the same outline on the error-correction range, color picker triggers, dialog controls, and the focusable poster surface. For pixel-style and marker-shape radio cards, show the outline on the visible card only when its hidden radio receives keyboard-visible focus; pointer selection should not leave a focus halo. Make SVG marker targets show a visible dotted focus indicator at the marker location, checking that the SVG viewport does not clip it. Keep the native radio/range semantics and the poster's keyboard controls.
4. **Respect modal focus boundaries.** Check the existing initial focus and focus return for the mobile mask and settings drawers, content dialogs, icon gallery, and marker dialog. Tab and Shift+Tab should stay within an open modal, Escape should close it, and focus should return to its trigger. The initial page tab order applies when those dialogs are closed; no inactive dialog control should receive Tab.
5. **Update durable documentation when implemented.** Record the final keyboard order and focus style in `README.md` and `doc/plan/web-qr-poster.md`, then remove this completed proposal as required by `AGENTS.md`.

## Browser review and acceptance

- From the browser chrome on a fresh editor load, the first Tab lands on the URL input. In Text and Phone modes the same field remains first. Shift+Tab and subsequent Tab presses follow the visible header controls, including the Home link, without skips or cycles.
- Every keyboard-reachable editor control has a visible dotted vermilion outline. Check the header, mask font cards and search, preview toolbar and poster, SVG marker targets, pattern range/radio/color controls, result actions, and dialog controls. Focus remains distinguishable from selection and error states.
- Repeat at desktop and mobile widths, 200% zoom, and with an open drawer and each modal. Check that the outline is not clipped by card, dialog, or scroll-container edges, and that focus return still works after dismissal.
- Per `AGENTS.md`, run `pnpm test`, `pnpm typecheck`, `pnpm build`, or `pnpm test:e2e` only if the maintainer explicitly asks. Update `e2e/editor.spec.ts` only when requested after manual browser review.
