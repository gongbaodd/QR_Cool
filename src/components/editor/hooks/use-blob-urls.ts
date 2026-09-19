import { useEffect, useState } from 'react'

function blobFromBase64(value: string, type: string) { return new Blob([Uint8Array.from(atob(value), c => c.charCodeAt(0))], { type }) }

/** Turns a map of base64 payloads into object URLs, revoked when the map changes. */
export function useBlobUrls(values: Record<string, string>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = JSON.stringify(values)
  useEffect(() => { const next = Object.fromEntries(Object.entries(JSON.parse(key) as Record<string, string>).map(([name, bytes]) => [name, URL.createObjectURL(blobFromBase64(bytes, name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : 'image/png'))])); setUrls(next); return () => Object.values(next).forEach(URL.revokeObjectURL) }, [key])
  return urls
}
