'use client'
import { createContext, useContext, useState, type PropsWithChildren } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { createEditorStore, type EditorStoreState } from '../../lib/editor/store'

const EditorStoreContext = createContext<StoreApi<EditorStoreState> | null>(null)

export default function EditorStoreProvider({ children }: PropsWithChildren) {
  const [store] = useState(createEditorStore)
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

export function useEditorStoreApi(): StoreApi<EditorStoreState> {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error('useEditorStoreApi must be used inside EditorStoreProvider')
  return store
}

export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  return useStore(useEditorStoreApi(), selector)
}
