import { useEffect, useRef, useState } from 'react'

/**
 * Turns a map of Blobs into object URLs, revoked when any Blob identity changes.
 * Keys are the artifact names; URLs live only at this UI boundary and are revoked
 * when the underlying Blob changes or on unmount.
 */
export function useBlobUrls(values: Record<string, Blob>) {
  const ids = useRef(new WeakMap<Blob, number>())
  const counter = useRef(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const identity = JSON.stringify(
    Object.keys(values)
      .sort()
      .map((name) => {
        const blob = values[name]!
        let id = ids.current.get(blob)
        if (id === undefined) {
          id = ++counter.current
          ids.current.set(blob, id)
        }
        return [name, id]
      }),
  )
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const name of Object.keys(values).sort()) next[name] = URL.createObjectURL(values[name]!)
    setUrls(next)
    return () => Object.values(next).forEach(URL.revokeObjectURL)
    // Blob identities are folded into `identity`; the map object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values identity is intentionally not a dep
  }, [identity])
  return urls
}
