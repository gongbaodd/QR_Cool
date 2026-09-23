import { describe, expect, it } from 'vitest'
import { createEditorStore } from '@/lib/editor/store'
import { selectCanAssemble, selectCurrent, selectEffectiveMask } from '@/lib/editor/selectors'

describe('editor store', () => {
  it('keeps store instances isolated and starts deterministically', () => {
    const first = createEditorStore()
    const second = createEditorStore()
    first.getState().actions.setDraftContent('first')
    first.getState().actions.patchSettings({ ecc: 'H' })

    expect(second.getState().draft.content).toBe('')
    expect(second.getState().document.settings.ecc).toBe('M')
    expect(first.getState().document.settings).not.toBe(second.getState().document.settings)
    expect(first.getState().document.settings.seed).toBe(0)
  })

  it('commits only valid draft changes and preserves unchanged revisions', () => {
    const store = createEditorStore()
    const actions = store.getState().actions
    actions.setDraftContent('hello')
    const revision = store.getState().document.revision
    expect(actions.commitDraft()).toBe(true)
    expect(store.getState().document.content).toBe('hello')
    expect(store.getState().document.revision).toBe(revision + 1)

    const committedRevision = store.getState().document.revision
    actions.setDraftContent('hello')
    expect(actions.commitDraft()).toBe(true)
    expect(store.getState().document.revision).toBe(committedRevision)

    actions.setDraftContent('')
    expect(actions.commitDraft()).toBe(false)
    expect(store.getState().draft.blurred).toBe(true)
    expect(store.getState().draft.error).toBeTruthy()
  })

  it('merges settings against the latest state and keeps stale completions out', () => {
    const store = createEditorStore()
    const actions = store.getState().actions
    actions.patchSettings({ ecc: 'Q' })
    actions.patchSettings({ pixelStyle: 'dot' })
    expect(store.getState().document.settings).toMatchObject({ ecc: 'Q', pixelStyle: 'dot' })

    const stale = {
      apiVersion: 1 as const,
      revision: 0,
      width: 1,
      height: 1,
      mask: new Blob(),
      overlay: new Blob(),
      qr: new Blob(),
      qrMetadata: { totalModules: 21, version: 1 },
      placement: { x: 0, y: 0, size: 84, rotation: 0 },
      validation: null,
    }
    const before = store.getState().document
    actions.acceptPrepared(stale)
    expect(store.getState().document).toBe(before)
  })

  it('uses committed content for automatic masks and rejects stale readiness', () => {
    const store = createEditorStore()
    const actions = store.getState().actions
    actions.setDraftContent('https://example.test')
    actions.commitDraft()
    expect(selectEffectiveMask(store.getState())).toBe('E')
    expect(selectCurrent(store.getState())).toBe(false)
    expect(selectCanAssemble(store.getState())).toBe(false)
  })

  it('publishes source replacement and revision together', () => {
    const store = createEditorStore()
    const poster = new File([new Blob(['poster'])], 'poster.png', { type: 'image/png' })
    const mask = new File([new Blob(['mask'])], 'mask.png', { type: 'image/png' })
    let notifications = 0
    const unsubscribe = store.subscribe(() => notifications++)
    store.getState().actions.initializeSources(poster, mask, 123)
    unsubscribe()
    expect(notifications).toBe(1)
    expect(store.getState().sources.poster).toBe(poster)
    expect(store.getState().sources.mask).toBe(mask)
    expect(store.getState().document.revision).toBe(1)
    expect(store.getState().document.settings.seed).toBe(123)
  })

  it('initializes the poster when automatic mask rendering finishes first', () => {
    const store = createEditorStore()
    const actions = store.getState().actions
    const poster = new File(['poster'], 'poster.png', { type: 'image/png' })
    const initialMask = new File(['blank'], 'blank.png', { type: 'image/png' })
    const renderedMask = new File(['rendered'], 'mask.png', { type: 'image/png' })

    actions.replaceMask(renderedMask)
    actions.initializeSources(poster, initialMask, 123, true)

    expect(store.getState().sources).toEqual({ poster, mask: renderedMask, transparentBlank: true })
    expect(store.getState().document.settings.seed).toBe(123)
    expect(store.getState().document.revision).toBe(2)
  })
})
