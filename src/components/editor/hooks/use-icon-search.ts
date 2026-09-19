import { useState } from 'react'
import type { RefObject } from 'react'
import type { IconItem } from '../../../lib/editor/text-mask'

export interface IconSearch {
  results: IconItem[]
  total: number
  loading: boolean
  error: string | null
  fetchedQuery: string
  galleryMode: boolean
  handleSearchClick: (query: string, maskBusy: boolean) => Promise<void>
  closeGallery: () => void
}

/**
 * Owns the last-searched icon term, its results, and the gallery view state.
 * `activeQueryRef` points at the live search input so a response for an
 * abandoned term never opens a stale gallery.
 */
export function useIconSearch(activeQueryRef: RefObject<string>): IconSearch {
  const [iconResults, setIconResults] = useState<IconItem[]>([])
  const [iconTotal, setIconTotal] = useState(0)
  const [iconLoading, setIconLoading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)
  const [fetchedQuery, setFetchedQuery] = useState('')
  const [galleryMode, setGalleryMode] = useState(false)
  // One request per clicked term, cached for that term only. Returns whether icons came back.
  async function runSearch(query: string): Promise<boolean> {
    setIconLoading(true); setIconError(null)
    try {
      const res = await fetch(`/api/icons?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error('search failed')
      const data = await res.json() as { total:number; count:number; items: IconItem[] }
      const items = data.items ?? []
      setIconResults(items); setIconTotal(data.total ?? items.length); setFetchedQuery(query)
      return items.length > 0
    } catch {
      setIconError('Could not search icons.'); setIconResults([]); setIconTotal(0); setFetchedQuery(query)
      return false
    } finally { setIconLoading(false) }
  }
  // The combined search/more control: one click searches a new term and shows the
  // results, reopens the gallery for a cached term, and stays put on an empty input.
  async function handleSearchClick(query: string, maskBusy: boolean) {
    if (maskBusy || iconLoading) return
    if (!query) { setGalleryMode(false); return }
    if (fetchedQuery === query && iconResults.length > 0) { setGalleryMode(true); return }
    const found = await runSearch(query)
    // A response for an abandoned term never opens a stale gallery.
    if (found && activeQueryRef.current === query) setGalleryMode(true)
  }
  function closeGallery() { setGalleryMode(false) }
  return { results: iconResults, total: iconTotal, loading: iconLoading, error: iconError, fetchedQuery, galleryMode, handleSearchClick, closeGallery }
}
