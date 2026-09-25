'use client'
import { createContext, useContext, useState, type PropsWithChildren } from 'react'
import { useStore } from 'zustand'
import { createEditorStore, type EditorStore, type EditorStoreState } from '@/lib/editor/store'

const EditorStoreContext = createContext<EditorStore | null>(null)

export default function EditorStoreProvider({ children }: PropsWithChildren) {
  const [store] = useState(createEditorStore)
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error('useEditorStoreApi must be used inside EditorStoreProvider')
  return store
}

export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  return useStore(useEditorStoreApi(), selector)
}
