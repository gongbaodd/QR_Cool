import { contentSchema } from './schema'
import { deriveMaskLetter, TEXT_MASK_FONTS } from './text-mask'
import type { EditorStoreState } from './store'

export const selectSuggestedMask = (state: EditorStoreState) => deriveMaskLetter(state.document.content)
export const selectEffectiveMask = (state: EditorStoreState) => {
  const text = state.maskSelection.origin === 'auto' ? selectSuggestedMask(state) : state.maskSelection.text
  return text.trim().slice(0, 1).toUpperCase()
}
export const selectMaskFont = (state: EditorStoreState) =>
  TEXT_MASK_FONTS.find((entry) => entry.id === state.maskSelection.fontId) ?? TEXT_MASK_FONTS[1]!
export const selectIsBlank = (state: EditorStoreState) =>
  state.maskSelection.fontId === 'blank' && !state.maskSelection.selectedIcon
export const selectIsIconMode = (state: EditorStoreState) => !!state.maskSelection.selectedIcon
export const selectIsFollowingInput = (state: EditorStoreState) => state.maskSelection.origin === 'auto'
export const selectTrimmedSearch = (state: EditorStoreState) => state.maskSelection.text.trim()
export const selectPreparationError = (state: EditorStoreState) =>
  state.document.error && state.document.field !== 'content' ? state.document.error : null
export const selectCommittedContentError = (state: EditorStoreState) =>
  state.document.field === 'content' ? state.document.error : null
export const selectCurrent = (state: EditorStoreState) =>
  !!state.document.prepared && state.document.prepared.revision === state.document.revision && !state.document.error
export const selectBusy = (state: EditorStoreState) =>
  !!state.document.busy || state.maskSelection.busy || state.iconSearch.loading
export const selectCanAssemble = (state: EditorStoreState) =>
  contentSchema.safeParse(state.document.content).success &&
  selectCurrent(state) &&
  !!state.document.placement &&
  !selectBusy(state)
export const selectVisibleContentError = (state: EditorStoreState) =>
  (state.draft.blurred ? state.draft.error : null) ?? selectCommittedContentError(state)
