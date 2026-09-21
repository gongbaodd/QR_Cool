/**
 * Dedicated workers have no `window`, but the engine's QR decoder imports
 * ZXing, whose PDF417 tables touch `window.BigInt` at module scope. Aliasing
 * `window` to the worker global keeps that import alive in every bundler
 * (Turbopack shims `window` in worker output; Vite does not). Must be the
 * first import of the worker entry, before the engine evaluates. The check
 * reads the property off `globalThis` so minifiers cannot fold it away, and
 * it is a no-op on the main thread, where `window` already exists.
 */

const workerGlobal = globalThis as { window?: unknown }

if (workerGlobal.window === undefined) {
  workerGlobal.window = workerGlobal
}
