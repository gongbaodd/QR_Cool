import { describe, it, expect } from 'vitest'
import { initialState, reducer } from '@/lib/editor/state'

describe('editor state revision guards', () => {
  it('invalidates downloads and ignores superseded responses', () => {
    const old = {
      ...initialState,
      revision: 4,
      result: { apiVersion: 1 as const, revision: 4, artifacts: { 'poster.png': new Blob(['old']) } },
    }
    const edited = reducer(old, { type: 'edit', patch: { content: 'new' } })
    expect(edited.result).toBeNull()
    expect(reducer(edited, { type: 'result', data: old.result })).toEqual(edited)
  })

  it('treats a palette change like any settings edit: new revision, result cleared', () => {
    const colors = { pixel: '#0d47a1', marker: '#06305e', background: '#eef3fa' }
    const old = {
      ...initialState,
      revision: 7,
      result: { apiVersion: 1 as const, revision: 7, artifacts: { 'poster.png': new Blob(['old']) } },
    }
    const edited = reducer(old, {
      type: 'edit',
      patch: { settings: { ...old.settings, colors } },
    })
    expect(edited.revision).toBe(8)
    expect(edited.result).toBeNull()
    expect(edited.settings.colors).toEqual(colors)
  })
})
