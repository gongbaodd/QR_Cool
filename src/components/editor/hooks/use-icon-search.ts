import type { IconItem } from '../../../lib/editor/text-mask'
import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore, useEditorStoreApi } from '../EditorStoreProvider'

export interface IconSearch {
  results: IconItem[]
  total: number
  loading: boolean
  error: string | null
  fetchedQuery: string
  galleryMode: boolean
  handleSearchClick: () => Promise<void>
  closeGallery: () => void
}

/**
 * Owns the last-searched icon term, its results, and the gallery view state.
 * Search remains explicitly click-driven; request tokens prevent stale
 * completions from changing the current store state.
 */
export function useIconSearch(): IconSearch {
  const store = useEditorStoreApi()
  const iconResults = useEditorStore((state) => state.iconSearch.results)
  const iconTotal = useEditorStore((state) => state.iconSearch.total)
  const iconLoading = useEditorStore((state) => state.iconSearch.loading)
  const iconError = useEditorStore((state) => state.iconSearch.error)
  const fetchedQuery = useEditorStore((state) => state.iconSearch.fetchedQuery)
  const galleryMode = useEditorStore((state) => state.iconSearch.galleryMode)
  const requestToken = useRef(0)
  const abort = useRef<AbortController | null>(null)

  const closeGallery = useCallback(() => store.getState().actions.closeGallery(), [store])
  const handleSearchClick = useCallback(async () => {
    const current = store.getState()
    const query = current.maskSelection.text.trim()
    if (current.maskSelection.busy || current.iconSearch.loading) return
    if (!query) {
      current.actions.closeGallery()
      return
    }
    if (current.iconSearch.fetchedQuery === query && current.iconSearch.results.length > 0) {
      current.actions.finishSearch(query, current.iconSearch.results, current.iconSearch.total, true)
      return
    }

    const token = ++requestToken.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    current.actions.startSearch(query)
    try {
      const response = await fetch(`/api/icons?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      if (!response.ok) throw new Error('search failed')
      const data = (await response.json()) as { total: number; items: IconItem[] }
      if (token !== requestToken.current) return
      const items = data.items ?? []
      const latest = store.getState()
      latest.actions.finishSearch(
        query,
        items,
        data.total ?? items.length,
        items.length > 0 && latest.maskSelection.text.trim() === query,
      )
    } catch {
      if (token !== requestToken.current || controller.signal.aborted) return
      store.getState().actions.failSearch(query, 'Could not search icons.')
    }
  }, [store])

  useEffect(
    () => () => {
      requestToken.current += 1
      abort.current?.abort()
    },
    [],
  )

  return {
    results: iconResults,
    total: iconTotal,
    loading: iconLoading,
    error: iconError,
    fetchedQuery,
    galleryMode,
    handleSearchClick,
    closeGallery,
  }
}
