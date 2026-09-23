import { describe, it, expect } from 'vitest'
import { initialState, reducer } from '../src/lib/editor/state'

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
})
