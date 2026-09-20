import type { Imaging } from './types'

let active: Imaging | null = null

/** Installs one backend. Entry points only (test setup, scripts, route handlers, the worker). */
export function setImaging(backend: Imaging): void {
  active = backend
}

/** The installed backend. Core modules call this instead of importing sharp directly. */
export function imaging(): Imaging {
  if (!active) throw new Error('Imaging backend not installed: this entry point must call setImaging().')
  return active
}
